// Fabro Code: a new project without choosing a folder. The folder is made in Documents/Fabro Code (or the folder set
// in settings.code.projectsDir), named after what the user typed; a name already taken gets a number.
const fs = require('fs'); const path = require('path');
const { app } = require('electron');
const store = require('./store');

const baseDir = () => ((store.getSettings().code || {}).projectsDir) || path.join(app.getPath('documents'), 'Fabro Code');
// "Un site pour ma boulangerie !" → "un-site-pour-ma-boulangerie"
function slug(name) {
  const s = String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const cut = s.split('-').slice(0, 5).join('-').slice(0, 40).replace(/-+$/, '');
  return cut || `projet-${new Date().toISOString().slice(0, 10)}`;
}
function create({ name } = {}, base = baseDir()) {
  fs.mkdirSync(base, { recursive: true });
  const s = slug(name); let dir = path.join(base, s);
  for (let n = 2; fs.existsSync(dir); n++) dir = path.join(base, `${s}-${n}`);
  fs.mkdirSync(dir);
  return dir;
}
module.exports = { create, slug, baseDir };
