// Where Fabro keeps its data.
//   sharedDir()  — the same for every account on this computer (engine, model files, app-wide settings)
//   dataDir()    — the current account's own data (conversations, memory, settings, skills, prompts…)
// Until accounts land, both are userData. New per-user features must use dataDir(), never app.getPath('userData').
const { app } = require('electron');
const path = require('path');
const sharedDir = () => app.getPath('userData');
let current = null; // set by accounts.js
const dataDir = () => current || sharedDir();
const setDataDir = (dir) => { current = dir || null; };
const inData = (...p) => path.join(dataDir(), ...p);
const inShared = (...p) => path.join(sharedDir(), ...p);
module.exports = { sharedDir, dataDir, setDataDir, inData, inShared };
