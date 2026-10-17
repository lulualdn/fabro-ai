// Image generation end to end (CI): install stable-diffusion.cpp for this computer + SD Turbo, make one image.
const Module = require('module'); const os = require('os'); const path = require('path'); const fs = require('fs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-img-'));
const orig = Module._load;
Module._load = function (req, ...r) { if (req === 'electron') return { app: { getPath: () => tmp, isPackaged: false } }; return orig.call(this, req, ...r); };
process.env.HOME = tmp; process.env.USERPROFILE = tmp;
const store = require('../src/main/store'); store.init();
const images = require('../src/main/images');
const note = (m) => console.log(`::notice title=images-smoke ${process.platform}::${m}`);
(async () => {
  let t0 = Date.now(), last = -1;
  const st = await images.install((p) => { const k = Math.floor(p * 10); if (k !== last) { last = k; console.log(`install ${k * 10}%`); } }, 'sd-turbo');
  note(`installed ${st.build} + SD Turbo in ${((Date.now() - t0) / 1000).toFixed(0)} s (recommended here: ${st.recommended})`);
  t0 = Date.now();
  const r = await images.generate({ prompt: 'a red apple on a wooden table, studio photo', aspect: 'square', seed: 42 }, { onProgress: (p) => process.stdout.write(`\rstep ${Math.round(p * 100)}%`) });
  const size = fs.statSync(r.path).size;
  note(`image ${r.width}x${r.height} in ${(r.ms / 1000).toFixed(1)} s, ${Math.round(size / 1024)} KB`);
  if (size < 50000 || !fs.readFileSync(r.path).subarray(1, 4).equals(Buffer.from('PNG'))) throw new Error('not a real PNG');
  if (process.env.SHOTS) fs.copyFileSync(r.path, path.join(process.env.SHOTS, 'generated.png'));
  console.log('\nimages-smoke: all passed');
})().catch((e) => { console.log(`::error title=images-smoke ${process.platform}::${e.message}`); process.exit(1); });
