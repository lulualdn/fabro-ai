// Minimal GGUF metadata reader: reads the header key/values (skipping big arrays
// like the tokenizer vocabulary) without loading the model.
const fs = require('fs');

const T = { U8: 0, I8: 1, U16: 2, I16: 3, U32: 4, I32: 5, F32: 6, BOOL: 7, STRING: 8, ARRAY: 9, U64: 10, I64: 11, F64: 12 };
const SIZE = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 };

class Reader {
  constructor(fd) { this.fd = fd; this.buf = Buffer.alloc(0); this.pos = 0; this.filePos = 0; this.eof = false; }
  ensure(n) {
    while (this.buf.length - this.pos < n) {
      if (this.eof) throw new Error('GGUF: unexpected end of file');
      const chunk = Buffer.alloc(Math.max(1 << 20, n));
      const read = fs.readSync(this.fd, chunk, 0, chunk.length, this.filePos);
      if (!read) { this.eof = true; continue; }
      this.filePos += read;
      this.buf = Buffer.concat([this.buf.subarray(this.pos), chunk.subarray(0, read)]);
      this.pos = 0;
    }
  }
  skip(n) {
    const avail = this.buf.length - this.pos;
    if (n <= avail) { this.pos += n; return; }
    this.filePos += n - avail; this.buf = Buffer.alloc(0); this.pos = 0;
  }
  u32() { this.ensure(4); const v = this.buf.readUInt32LE(this.pos); this.pos += 4; return v; }
  u64() { this.ensure(8); const v = this.buf.readBigUInt64LE(this.pos); this.pos += 8; return Number(v); }
  str() { const n = this.u64(); if (n > 1 << 24) throw new Error('GGUF: string too long'); this.ensure(n); const s = this.buf.toString('utf8', this.pos, this.pos + n); this.pos += n; return s; }
  scalar(t) {
    this.ensure(SIZE[t] || 8);
    const b = this.buf, p = this.pos; this.pos += SIZE[t];
    switch (t) {
      case T.U8: return b.readUInt8(p); case T.I8: return b.readInt8(p);
      case T.U16: return b.readUInt16LE(p); case T.I16: return b.readInt16LE(p);
      case T.U32: return b.readUInt32LE(p); case T.I32: return b.readInt32LE(p);
      case T.F32: return b.readFloatLE(p); case T.BOOL: return !!b.readUInt8(p);
      case T.U64: return Number(b.readBigUInt64LE(p)); case T.I64: return Number(b.readBigInt64LE(p));
      case T.F64: return b.readDoubleLE(p);
    }
    throw new Error(`GGUF: bad type ${t}`);
  }
  value(t, keepArray) {
    if (t === T.STRING) return this.str();
    if (t !== T.ARRAY) return this.scalar(t);
    const et = this.u32(), n = this.u64();
    if (!keepArray || n > 4096) { // skip efficiently
      if (et === T.STRING) { for (let i = 0; i < n; i++) { const len = this.u64(); this.skip(len); } }
      else this.skip(n * (SIZE[et] || 8));
      return { array: true, length: n };
    }
    const out = []; for (let i = 0; i < n; i++) out.push(this.value(et, false)); return out;
  }
}

function readMeta(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const r = new Reader(fd);
    r.ensure(4);
    if (r.buf.toString('ascii', 0, 4) !== 'GGUF') throw new Error('Not a GGUF file');
    r.pos = 4;
    const version = r.u32();
    const tensors = r.u64();
    const kvs = r.u64();
    const kv = {};
    for (let i = 0; i < kvs; i++) {
      const key = r.str();
      const t = r.u32();
      kv[key] = r.value(t, /head_count|layer|window|pattern/.test(key));
    }
    return { version, tensors, kv };
  } finally { fs.closeSync(fd); }
}

const FILE_TYPES = { 0: 'F32', 1: 'F16', 2: 'Q4_0', 3: 'Q4_1', 7: 'Q8_0', 8: 'Q5_0', 9: 'Q5_1', 10: 'Q2_K', 11: 'Q3_K_S', 12: 'Q3_K_M', 13: 'Q3_K_L', 14: 'Q4_K_S', 15: 'Q4_K_M', 16: 'Q5_K_S', 17: 'Q5_K_M', 18: 'Q6_K', 19: 'IQ2_XXS', 20: 'IQ2_XS', 21: 'Q2_K_S', 22: 'IQ3_XS', 23: 'IQ3_XXS', 24: 'IQ1_S', 25: 'IQ4_NL', 26: 'IQ3_S', 27: 'IQ3_M', 28: 'IQ2_S', 29: 'IQ2_M', 30: 'IQ4_XS', 31: 'IQ1_M', 32: 'BF16', 36: 'TQ1_0', 37: 'TQ2_0', 38: 'MXFP4' };

// The few facts Fabro needs: shape for KV-cache estimation, MoE, context.
function summarize(file) {
  const { kv } = readMeta(file);
  const arch = kv['general.architecture'] || 'llama';
  const g = (k) => kv[`${arch}.${k}`];
  const num = (v) => (Array.isArray(v) ? Math.max(...v) : typeof v === 'number' ? v : null);
  const layers = g('block_count') || 0;
  const heads = num(g('attention.head_count')) || 0;
  const headsKv = Array.isArray(g('attention.head_count_kv'))
    ? g('attention.head_count_kv').reduce((a, b) => a + b, 0) / g('attention.head_count_kv').length
    : num(g('attention.head_count_kv')) || heads;
  const emb = g('embedding_length') || 0;
  const keyLen = g('attention.key_length') || (heads ? emb / heads : 0);
  const valLen = g('attention.value_length') || keyLen;
  const experts = g('expert_count') || 0;
  return {
    arch, name: kv['general.name'] || '', layers, heads, headsKv, emb, keyLen, valLen,
    ctxTrain: g('context_length') || 0,
    window: g('attention.sliding_window') || 0,
    experts, expertsUsed: g('expert_used_count') || 0, moe: experts > 1,
    fileType: FILE_TYPES[kv['general.file_type']] || '',
    chatTemplate: typeof kv['tokenizer.chat_template'] === 'string',
  };
}

module.exports = { readMeta, summarize };
