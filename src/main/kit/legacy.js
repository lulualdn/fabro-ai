// Which artifact versions were written for the old Fabro Kit (and still need it to render), and which are plain,
// self-contained HTML the model designed itself. Versions saved since v0.2 carry `plain: true`; older versions have
// no flag and keep the exact old behaviour (kit injected when the page uses it). No Electron here: db.js uses it.

const FRESH_MS = 120000;

// Called by db.saveArtifact: a version that was just written gets its flag once.
// - the AI wrote it (chat answer, create_artifact…) → plain
// - the user edited it → same as the version it came from (editing an old kit page keeps the kit)
function stamp(a) {
  const vs = a && Array.isArray(a.versions) ? a.versions : null; if (!vs || !vs.length) return a;
  const last = vs[vs.length - 1];
  if (!last || last.plain !== undefined || !(Date.now() - (+last.at || 0) < FRESH_MS)) return a;
  if (last.by === 'user') {
    const same = vs.slice(0, -1).reverse().find((v) => v.content === last.content); // "restore this version"
    const from = same || vs[vs.length - 2];
    last.plain = from ? from.plain === true : true;
  } else last.plain = true;
  return a;
}

// Does this version still need the old kit? (no flag = written before v0.2)
const isLegacy = (ver) => !!ver && ver.plain !== true;
const versionOf = (a, v) => (a && a.versions ? a.versions[v == null ? a.versions.length - 1 : Math.max(0, Math.min(a.versions.length - 1, +v || 0))] : null);
const legacyArt = (a, v) => isLegacy(versionOf(a, v));

module.exports = { stamp, isLegacy, legacyArt, versionOf };
