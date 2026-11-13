// Compatibility layer for skills written for Claude (Claude Code, Claude apps).
// Honest and small: it tells the model which Fabro tool to use where the skill says "Bash" / "Read" / …,
// says plainly which referenced tools Fabro does not have, and rewrites /mnt/skills/... to the installed folder.
// Tool names below are the real ones registered in src/main/agent/*.js (checked by scripts/skills-test.js).

// Claude name → { to: Fabro tool(s) or null, note }
const MAP = {
  Bash: { to: 'run_command', note: 'runs a shell command (Python scripts: run_python)' },
  bash_tool: { to: 'run_command' },
  Read: { to: 'read_file' },
  view: { to: 'read_file', note: 'list_dir for a folder' },
  Write: { to: 'write_file' },
  create_file: { to: 'write_file' },
  Edit: { to: 'edit_file' },
  MultiEdit: { to: 'edit_file', note: 'one call per edit' },
  str_replace: { to: 'edit_file' },
  LS: { to: 'list_dir' },
  Glob: { to: 'list_dir', note: 'no pattern matching: list the folder, or use search_files to look inside files' },
  Grep: { to: 'search_files' },
  WebSearch: { to: 'web_search' },
  web_search: { to: 'web_search' },
  WebFetch: { to: 'fetch_url' },
  web_fetch: { to: 'fetch_url' },
  Task: { to: 'run_subagent' },
  TodoWrite: { to: 'update_plan' },
  AskUserQuestion: { to: 'ask_user' },
  Skill: { to: 'load_skill' },
  NotebookEdit: { to: null, note: 'Fabro cannot edit notebooks directly' },
  present_files: { to: null, note: 'Fabro has no file presenter: tell the user where the file was saved' },
};
const NAMES = Object.keys(MAP);
const ALT = NAMES.join('|');
const SNAKE = new Set(['bash_tool', 'create_file', 'str_replace', 'present_files', 'web_search', 'web_fetch', 'view']);

// Which Claude tool names does this text refer to? Only unambiguous spellings count
// (`Bash`, Bash(...) , "the Read tool", allowed-tools), so ordinary words like "read" or "task" do not trigger it.
function referencedTools(text, allowedTools) {
  const found = new Set();
  const s = String(text || '');
  const add = (n) => { if (MAP[n]) found.add(n); };
  for (const m of s.matchAll(new RegExp('`(' + ALT + ')(?:\\([^`]*\\))?`', 'g'))) { if (!SNAKE.has(m[1]) || m[1] !== 'view') add(m[1]); }
  for (const m of s.matchAll(new RegExp('\\b(' + ALT + ')\\s+tool\\b', 'g'))) add(m[1]);
  for (const m of s.matchAll(new RegExp('\\b(?:use|using|via|call|run with|with) (?:the )?(Bash|Read|Write|Edit|MultiEdit|Glob|Grep|WebSearch|WebFetch|NotebookEdit|TodoWrite|AskUserQuestion)\\b', 'g'))) add(m[1]);
  for (const m of s.matchAll(/\b(bash_tool|create_file|str_replace|present_files|web_fetch)\b/g)) add(m[1]);
  for (const tok of String(allowedTools || '').split(/[\s,]+/)) { const n = tok.replace(/\(.*$/, ''); if (n) add(n); }
  return [...found].sort();
}

// Fabro tools that exist for real (so the preview does not claim a mapping that is gone).
function fabroTools() { try { return new Set(require('./agent').all().map((t) => t.name)); } catch { return null; } }

function analyze(text, allowedTools) {
  const refs = referencedTools(text, allowedTools);
  const have = fabroTools();
  const mapped = []; const unmapped = [];
  for (const n of refs) {
    const m = MAP[n];
    const tos = m.to ? [m.to] : [];
    if (!tos.length || (have && !tos.every((x) => have.has(x) || ['web_search', 'fetch_url', 'ask_user'].includes(x)))) unmapped.push({ name: n, note: m.note || 'no equivalent in Fabro' });
    else mapped.push({ name: n, to: m.to, note: m.note || '' });
  }
  const mnt = /\/mnt\/(skills|user-data)\b/.test(String(text || ''));
  return { mapped, unmapped, mnt };
}

// Rewrite /mnt/skills/<public|user|examples>/<skill>/… → the installed folder; /mnt/user-data/outputs → Fabro's output folder.
function rewritePaths(text, skillDir, resolveSkill) {
  const outDir = (() => { try { return require('./paths').outputDir(); } catch { return ''; } })();
  const norm = (p) => p.replace(/\\/g, '/');
  return String(text)
    .replace(/\/mnt\/skills\/(?:public|user|examples|private)\/([A-Za-z0-9._-]+)/g, (_m, name) => norm((resolveSkill && resolveSkill(name)) || skillDir))
    .replace(/\/mnt\/skills\/([A-Za-z0-9._-]+)/g, (m, name) => ((resolveSkill && resolveSkill(name)) ? norm(resolveSkill(name)) : m))
    .replace(/\/mnt\/user-data\/outputs\b/g, outDir ? norm(outDir) : '/mnt/user-data/outputs');
}

// The note appended when a skill is loaded. '' when the skill is not Claude-flavoured.
function note(text, allowedTools) {
  const a = analyze(text, allowedTools);
  if (!a.mapped.length && !a.unmapped.length) return '';
  const lines = ['---', '[Fabro compatibility note] This skill was written for Claude. In Fabro, use these tools where it names Claude\'s:'];
  for (const m of a.mapped) lines.push(`- ${m.name} → ${m.to}${m.note ? ` (${m.note})` : ''}`);
  for (const u of a.unmapped) lines.push(`- ${u.name} → not available in Fabro (${u.note}); do the closest thing you can or tell the user`);
  lines.push('The Claude sandbox paths (in the text above) were replaced by the real folders. Do not assume tools or files that are not in your tool list.');
  return lines.join('\n');
}

module.exports = { MAP, referencedTools, analyze, rewritePaths, note };
