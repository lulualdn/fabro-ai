// Second look: once an agent turn that changed or ran something says it is done, Fabro asks the model to hunt
// for what is wrong in its own work. A found problem is said out loud and fixed in the same answer; "nothing
// wrong" leaves the answer as it was. Once per user message. Off with settings.selfCheck === false.
const ACTING = /^(write_file|edit_file|create_file|run_command|run_python|run_javascript|create_artifact|edit_artifact|make_document|git_|move_|delete_|rename_|computer_|install_|overlay_show)/;
const CLEAN = /^[\s"'`*.]*(\[\[ok\]\]|ok|okay|✓|✔|rien|ras|nothing|none|no (issue|problem|error)s?|aucun(e)? (erreur|probl[èe]me)|all good|tout est bon|lgtm)[\s"'`*.!]*$/i;

const ASK = `[Fabro — second look, the user does not see this message]
Before this answer is final, act as a strict reviewer who EXPECTS to find a mistake in what you just did and said.
1. Re-read the user's request word by word: is every part done, exactly as asked (names, paths, numbers, language, format)?
2. For each thing you claimed (created, fixed, works, passes, found): which tool result proves it? If none does, check it NOW with a tool (re-read the file, run it, open it, list the folder).
3. Look for the usual misses: an error or warning in an output you skimmed, a command that exited 0 but printed nothing useful, a file written in the wrong place, a step of the plan left undone, a value you assumed instead of read, a result that contradicts another one.
Then:
- You find something wrong or unproven → start your reply with a plain admission in the user's language ("Correction: I was wrong about …"), fix it now with your tools, and say what is now true. Never defend the earlier answer.
- Everything holds after really checking → reply with exactly: [[OK]]`;

function enabled() { try { return require('../store').getSettings().selfCheck !== false; } catch { return true; } }

// → the review message to send, or null
function ask({ acc, text, turnTools = [], agentMode, bare, aborted, steps = 0, max = 0, unattended }) {
  if (!agentMode || bare || aborted || acc.doubtDone || unattended || !enabled()) return null;
  if (!text || (max && steps >= max - 1)) return null;
  if (!turnTools.some((x) => x.ok && ACTING.test(x.name))) return null;
  acc.doubtDone = true;
  return ASK;
}
const clean = (text) => CLEAN.test(String(text || '').slice(0, 60)) && String(text || '').trim().length < 40;

module.exports = { ask, clean, ASK };
