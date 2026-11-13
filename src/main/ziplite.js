// Tiny zip reader/writer on top of node:zlib (no dependency). Made for untrusted archives:
// the reader never writes to disk, enforces hard limits and reports what it refused.
//   readZip(buf, limits) → { entries: [{ path, size, data(Buffer) }], skipped: [{ path, reason }] }  (throws ZipError on hostile archives)
//   writeZip([{ path, data }]) → Buffer
// Zip64 and encrypted entries are refused (a skill never needs them).
const zlib = require('zlib');

class ZipError extends Error { constructor(msg, code) { super(msg); this.code = code || 'ZIP_INVALID'; } }

const DEFAULTS = { maxArchive: 25 * 1024 * 1024, maxTotal: 40 * 1024 * 1024, maxFile: 12 * 1024 * 1024, maxFiles: 600, maxRatio: 200, maxPath: 220, maxDepth: 10 };

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

// Why a stored path is not acceptable, or '' when it is fine.
function badPath(p, lim) {
  if (!p) return 'empty path';
  if (/[\0]/.test(p)) return 'NUL in path';
  if (p.length > lim.maxPath) return 'path too long';
  if (/^[\\/]/.test(p) || /^[a-zA-Z]:/.test(p)) return 'absolute path';
  const parts = p.split(/[\\/]/).filter((x) => x !== '');
  if (parts.some((x) => x === '..')) return 'path traversal (..)';
  if (parts.length > lim.maxDepth) return 'nested too deep';
  return '';
}

function readZip(buf, opts = {}) {
  const lim = { ...DEFAULTS, ...opts };
  if (!Buffer.isBuffer(buf)) throw new ZipError('Not a buffer');
  if (buf.length > lim.maxArchive) throw new ZipError(`Archive is larger than ${Math.round(lim.maxArchive / 1048576)} MB`, 'ZIP_TOO_BIG');
  if (buf.length < 22) throw new ZipError('Not a zip file');
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new ZipError('Not a zip file (no end-of-archive record)');
  const count = buf.readUInt16LE(eocd + 10); const cdSize = buf.readUInt32LE(eocd + 12); let off = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdSize === 0xffffffff || off === 0xffffffff) throw new ZipError('Zip64 archives are not supported', 'ZIP_UNSUPPORTED');
  if (count > lim.maxFiles * 2) throw new ZipError(`Too many entries (${count})`, 'ZIP_TOO_MANY');
  const entries = []; const skipped = []; let total = 0; let files = 0;
  for (let n = 0; n < count; n++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) throw new ZipError('Damaged zip directory');
    const madeBy = buf.readUInt16LE(off + 4); const flags = buf.readUInt16LE(off + 8); const method = buf.readUInt16LE(off + 10);
    const crc = buf.readUInt32LE(off + 16); const csize = buf.readUInt32LE(off + 20); const usize = buf.readUInt32LE(off + 24);
    const nlen = buf.readUInt16LE(off + 28); const elen = buf.readUInt16LE(off + 30); const clen = buf.readUInt16LE(off + 32);
    const ext = buf.readUInt32LE(off + 38); const lho = buf.readUInt32LE(off + 42);
    const name = buf.slice(off + 46, off + 46 + nlen).toString(flags & 0x800 ? 'utf8' : 'latin1');
    off += 46 + nlen + elen + clen;
    const isDir = /[\\/]$/.test(name);
    const unixMode = (madeBy >> 8) === 3 ? (ext >>> 16) : 0;
    if ((unixMode & 0o170000) === 0o120000) { skipped.push({ path: name, reason: 'symbolic link' }); continue; }
    if (unixMode && (unixMode & 0o170000) !== 0o100000 && (unixMode & 0o170000) !== 0o040000) { skipped.push({ path: name, reason: 'special file' }); continue; }
    const bp = badPath(name, lim);
    if (bp) { if (!isDir || /\.\./.test(name)) throw new ZipError(`Refused: "${name.slice(0, 80)}" (${bp})`, 'ZIP_UNSAFE'); continue; }
    if (isDir) continue;
    if (flags & 1) throw new ZipError('Encrypted zip entries are not supported', 'ZIP_UNSUPPORTED');
    if (++files > lim.maxFiles) throw new ZipError(`More than ${lim.maxFiles} files`, 'ZIP_TOO_MANY');
    if (usize > lim.maxFile) throw new ZipError(`"${name.slice(0, 60)}" is larger than ${Math.round(lim.maxFile / 1048576)} MB`, 'ZIP_TOO_BIG');
    total += usize;
    if (total > lim.maxTotal) throw new ZipError(`Unpacked size is larger than ${Math.round(lim.maxTotal / 1048576)} MB`, 'ZIP_TOO_BIG');
    if (csize > 0 && usize / csize > lim.maxRatio && usize > 1024 * 1024) throw new ZipError(`"${name.slice(0, 60)}" is suspiciously compressible (zip bomb?)`, 'ZIP_BOMB');
    if (lho + 30 > buf.length || buf.readUInt32LE(lho) !== 0x04034b50) throw new ZipError('Damaged zip entry');
    const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    if (start + csize > buf.length) throw new ZipError('Truncated zip');
    const raw = buf.slice(start, start + csize);
    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) { try { data = zlib.inflateRawSync(raw, { maxOutputLength: Math.max(usize, 1) + 1 }); } catch (e) { throw new ZipError(`"${name.slice(0, 60)}" is corrupt or larger than declared`, 'ZIP_BOMB'); } }
    else throw new ZipError(`Unsupported compression in "${name.slice(0, 60)}"`, 'ZIP_UNSUPPORTED');
    if (data.length !== usize) throw new ZipError(`"${name.slice(0, 60)}" has the wrong size`);
    if (crc32(data) !== crc) throw new ZipError(`"${name.slice(0, 60)}" is corrupt (checksum)`);
    entries.push({ path: name.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/{2,}/g, '/'), size: data.length, data });
  }
  return { entries, skipped };
}

function writeZip(files) {
  const parts = []; const cd = []; let off = 0;
  const dos = (() => { const d = new Date(); return { t: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), d: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() }; })();
  for (const f of files) {
    const name = Buffer.from(f.path.replace(/\\/g, '/'), 'utf8'); const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data);
    const comp = zlib.deflateRawSync(data); const useComp = comp.length < data.length; const body = useComp ? comp : data; const method = useComp ? 8 : 0; const crc = crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800, 6); lh.writeUInt16LE(method, 8); lh.writeUInt16LE(dos.t, 10); lh.writeUInt16LE(dos.d, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26);
    parts.push(lh, name, body);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE((3 << 8) | 20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x800, 8); ch.writeUInt16LE(method, 10); ch.writeUInt16LE(dos.t, 12); ch.writeUInt16LE(dos.d, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(((f.mode || 0o100644) << 16) >>> 0, 38); ch.writeUInt32LE(off, 42);
    cd.push(ch, name);
    off += 30 + name.length + body.length;
  }
  const cdBuf = Buffer.concat(cd); const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cdBuf, end]);
}

module.exports = { readZip, writeZip, ZipError, crc32, DEFAULTS };
