// Read and write ZIP packages (OOXML and OpenDocument are ZIP files of XML parts).
const zlib = require('zlib');

function unzip(buf) {
  const out = {};
  let e = buf.length - 22; while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('Not a ZIP file');
  const n = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16);
  for (let i = 0; i < n; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    const lnl = buf.readUInt16LE(off + 26), lxl = buf.readUInt16LE(off + 28), start = off + 30 + lnl + lxl;
    const raw = buf.subarray(start, start + csize);
    if (!name.endsWith('/')) out[name] = method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw);
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
// files: { name: string|Buffer } in order. OpenDocument wants "mimetype" first and stored (not compressed).
function zip(files) {
  const locals = [], centrals = []; let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content), store = name === 'mimetype' || /\.(png|jpe?g|gif|webp)$/i.test(name);
    const comp = store ? data : zlib.deflateRawSync(data), nameB = Buffer.from(name), crc = crc32(data), m = store ? 0 : 8;
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(m, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameB.length, 26);
    locals.push(lh, nameB, comp);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(m, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nameB.length, 28); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameB);
    offset += 30 + nameB.length + comp.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22), n = Object.keys(files).length;
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(n, 8); end.writeUInt16LE(n, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

// Tiny XML helpers (the parts we read are machine-written and regular).
const esc = (s) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const unesc = (s) => String(s ?? '').replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e) => ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[e.toLowerCase()] ?? (e[1].toLowerCase() === 'x' ? String.fromCodePoint(parseInt(e.slice(2), 16)) : String.fromCodePoint(+e.slice(1)))));
const attr = (tag, name) => { const m = String(tag).match(new RegExp(`\\s${name.replace(':', '\\:')}="([^"]*)"`)); return m ? unesc(m[1]) : null; };
// Elements by qualified name (non-nested occurrences of the same name), with their full XML.
function elements(xml, qn) {
  const out = [], open = new RegExp(`<${qn}(?=[\\s/>])`, 'g'); let m;
  while ((m = open.exec(xml))) {
    const s = m.index, gt = xml.indexOf('>', s);
    if (xml[gt - 1] === '/') { out.push(xml.slice(s, gt + 1)); continue; }
    let depth = 1, i = gt + 1; const re = new RegExp(`<(/?)${qn}(?=[\\s/>])[^>]*?(/?)>`, 'g'); re.lastIndex = i; let t;
    while (depth && (t = re.exec(xml))) { if (t[1]) depth--; else if (!t[2]) depth++; i = re.lastIndex; }
    out.push(xml.slice(s, i)); open.lastIndex = i;
  }
  return out;
}
const first = (xml, qn) => elements(xml, qn)[0] || null;

module.exports = { unzip, zip, esc, unesc, attr, elements, first };
