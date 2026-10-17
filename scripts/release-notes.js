// Release notes from a commit message: "vX.Y.Z: summary [release]" + bullet list → markdown for GitHub Releases.
// Trailers (Co-Authored-By, Claude-Session…) are dropped and wrapped bullet lines are joined.
// Usage: node scripts/release-notes.js [commit]   (default HEAD)
const { execFileSync } = require('child_process');
const msg = execFileSync('git', ['log', '-1', '--format=%B', process.argv[2] || 'HEAD'], { encoding: 'utf8' });
const lines = msg.replace(/\r/g, '').split('\n');
const summary = lines[0].replace(/^v?\d+\.\d+\.\d+\s*:\s*/, '').replace(/\s*\[release\]\s*/i, '').trim();
const body = lines.slice(1).filter((l) => !/^(Co-Authored-By|Claude-Session|Signed-off-by|Change-Id):/i.test(l));
const out = [];
for (const l of body) {
  if (/^\s{2,}\S/.test(l) && out.length && /^- /.test(out[out.length - 1])) out[out.length - 1] += ' ' + l.trim();
  else if (l.trim()) out.push(l.trim());
}
process.stdout.write([summary.charAt(0).toUpperCase() + summary.slice(1), '', ...out].join('\n').trim() + '\n');
