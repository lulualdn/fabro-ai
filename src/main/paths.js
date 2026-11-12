// Where Fabro keeps its data.
//   sharedDir()  — the same for every account on this computer (engine, model files, the account list,
//                  machine-wide settings). It is Electron's userData folder.
//   dataDir()    — the open account's own folder: <userData>/accounts/<id> (conversations, memory, settings,
//                  skills, secrets, Anywhere pairing…). Before an account is open (and in the plain-node tests,
//                  which never open one) it falls back to userData, which is also where a pre-accounts install
//                  kept everything.
// New per-user features must use dataDir() / inData(), never app.getPath('userData'). See docs/v02/accounts.md.
const { app } = require('electron');
const path = require('path');
const sharedDir = () => app.getPath('userData');
let current = null;     // folder of the open account (set by accounts/)
let account = null;     // { id, legacyPartitions }
const dataDir = () => current || sharedDir();
const setDataDir = (dir, acc) => { current = dir || null; account = acc || null; };
const inData = (...p) => path.join(dataDir(), ...p);
const inShared = (...p) => path.join(sharedDir(), ...p);
const accountId = () => (account ? account.id : null);
// Electron session partitions (saved web sign-ins of mods, the agent's browser) are per account.
// The account made from a pre-accounts install keeps the old names so its sign-ins survive the move.
const partitionName = (name, acc = account) => (acc && !acc.legacyPartitions ? `a-${acc.id}-${name}` : name);
const partition = (name) => 'persist:' + partitionName(name);
// Where the agent and the image maker save what they make: ~/Documents/Fabro, or a sibling folder per account
// ("Fabro - Emma") so that one account's default folder never contains another's.
const outputDir = () => (account && account.outDir) || path.join(require('os').homedir(), 'Documents', 'Fabro');
module.exports = { sharedDir, dataDir, setDataDir, inData, inShared, accountId, partition, partitionName, outputDir };
