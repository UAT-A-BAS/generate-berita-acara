// Guards the anti-clobber collaboration contract in index.html: per-field logical
// stamps, deterministic tie-breaks, caret preservation, liveness pings, and the
// offline edition guards. Source-level checks live here because these helpers run
// against live DOM state inside the browser bundle.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

function extractFunction(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const paramsStart = html.indexOf("(", start);
  let paramsDepth = 0;
  let bodyStart = -1;
  for (let index = paramsStart; index < html.length; index += 1) {
    if (html[index] === "(") paramsDepth += 1;
    if (html[index] === ")") paramsDepth -= 1;
    if (paramsDepth === 0) {
      bodyStart = html.indexOf("{", index);
      break;
    }
  }
  assert.notEqual(bodyStart, -1, `${name} must have a body`);
  let depth = 0;
  for (let index = bodyStart; index < html.length; index += 1) {
    if (html[index] === "{") depth += 1;
    if (html[index] === "}") {
      depth -= 1;
      if (depth === 0) return html.slice(start, index + 1);
    }
  }
  throw new Error(`Unable to extract ${name}`);
}

const nodeStampStub = (node) => (node && typeof node.t === "number" ? node.t : 0);
const preferSharedNode = Function(
  "nodeStamp",
  `return (${extractFunction("preferSharedNode")});`
)(nodeStampStub);

// Newer logical stamp wins.
assert.equal(preferSharedNode({ v: "mine", t: 7000, by: "me" }, { v: "theirs", t: 6000, by: "peer" }), true);
assert.equal(preferSharedNode({ v: "mine", t: 5000, by: "me" }, { v: "theirs", t: 9000, by: "peer" }), false);

// Equal stamps resolve by author so both peers pick the same winner.
const tieMine = preferSharedNode({ v: "a", t: 5000, by: "zeta" }, { v: "b", t: 5000, by: "alpha" });
const tieTheirs = preferSharedNode({ v: "b", t: 5000, by: "alpha" }, { v: "a", t: 5000, by: "zeta" });
assert.equal(tieMine, true, "higher author id wins the tie");
assert.equal(tieTheirs, false, "lower author id loses the same tie");
assert.equal(tieMine, !tieTheirs, "tie-break is symmetric, so peers cannot disagree");

// Unstamped legacy nodes are treated as stamp 0, so any real edit replaces them.
assert.equal(preferSharedNode({ v: "new", t: 1, by: "me" }, { v: "legacy" }), true);
assert.equal(preferSharedNode({ v: "legacy" }, { v: "new", t: 1, by: "me" }), false);

// Logical clock must be strictly increasing and never behind wall time.
const clockSource = extractFunction("nextLogicalStamp");
assert.match(clockSource, /collaboration\.clock = Math\.max\(Date\.now\(\), collaboration\.clock \+ 1\)/);
const nextLogicalStamp = Function("collaboration", `return (${clockSource});`)({ clock: 0 });
const first = nextLogicalStamp();
const second = nextLogicalStamp();
assert.ok(second > first, "logical stamps strictly increase");
assert.ok(first >= Date.now() - 1000, "logical stamp is not behind wall time");

// The overwrite bug: a commit used to diff the DOM against the live shared map, so a
// field whose remote value had not rendered yet looked like "the user cleared it" and
// got written back. Commits must now diff against the last state this editor agreed on.
assert.match(html, /const localEdits = changedPaths\(options\.full \? null : collaboration\.localSnapshot, data\);/);
assert.match(html, /const changes = commitSharedChanges\(sharedState, localEdits, \{ timestamp: updatedAt, author: clientId \}\);/);
assert.match(html, /collaboration\.localSnapshot = cloneSharedData\(data\);/);
assert.match(html, /collaboration\.localSnapshot = cloneSharedData\(data\);\s*\n\s*persistAutosave/, "remote applies reset the baseline");
assert.match(html, /collaboration\.localSnapshot = cloneSharedData\(seedData \|\| collectData\(\)\);/);
assert.match(html, /commitSharedData\(pendingCollabSeed, \{ full: true \}\)/, "seeding a new room writes every path on purpose");

// Commits must carry a per-path patch so a peer can re-assert its own newer edits.
assert.match(html, /const patch = pendingNodePatch\(changes, sharedState, updatedAt, clientId\);/);
assert.match(html, /patch\.forEach\(\(node, key\) => collaboration\.pendingNodes\.set\(key, node\)\);/);
assert.match(html, /function reconcilePendingNodes\(\)/);
assert.match(html, /reassertSharedNodes\(sharedState, reassert, \{ author: clientId \}\)/);
assert.match(html, /collaboration\.pendingNodes\.delete\(key\)/);
assert.match(
  html,
  /reassert\.forEach\(\(_node, key\) => collaboration\.pendingNodes\.delete\(key\)\);/,
  "settled pending nodes are drained so the room stops re-asserting forever"
);

// Remote apply must not clobber the field the user is actively typing in.
assert.match(html, /const focus = captureEditorFocus\(\);/);
assert.match(html, /applyData\(data, \{ fromShared: true, focus \}\)/);
assert.match(html, /restoreEditorFocus\(focus\);/);
assert.match(html, /function captureEditorFocus\(\)/);
assert.match(html, /setSelectionRange\(focus\.start, focus\.end \?\? focus\.start, focus\.direction \|\| "none"\)/);

// Only re-render when the decoded payload actually changed, to avoid caret churn.
assert.match(html, /if \(signature === collaboration\.lastAppliedSignature\) \{/);
assert.match(html, /collaboration\.lastAppliedSignature = signature;/);

// Initial server sync must merge, not blindly overwrite either side.
assert.match(html, /function handleInitialServerSync\(\)/);
assert.match(html, /if \(pendingKeys\) \{/);
assert.match(html, /commitSharedData\(localData, \{ persist: false \}\);/);

// Liveness: a dead socket must be detected instead of silently showing "Connected".
const pingSource = extractFunction("startPingLoop");
assert.match(pingSource, /Date\.now\(\) - \(collaboration\.lastServerMessageAt \|\| 0\) > COLLAB_PING_INTERVAL_MS \* 2/);
assert.match(pingSource, /sharedSocket\.close\(4000, "stale"\)/);
assert.match(html, /function stopPingLoop\(\)/);
assert.match(html, /clearInterval\(collabPingTimer\)/);
assert.match(html, /startPingLoop\(\);/);

// Server messages are parsed defensively; a bad frame must not break the socket.
assert.match(html, /try \{\s*message = JSON\.parse\(event\.data \|\| "\{\}"\);\s*\} catch \{\s*message = \{\};/);
assert.match(html, /else if \(message\.type === "error"\)/);
assert.match(html, /collaboration\.lastServerMessageAt = Date\.now\(\);/);

// Offline edition guard: no collab without a worker URL, and the panel is hidden.
assert.match(html, /const COLLAB_DISABLED = window\.BA_COLLAB_DISABLED === true;/);
assert.match(html, /const YJS_MODULE_URL = "https:\/\/esm\.sh\/yjs@13\.6\.27";/);
assert.match(html, /Y = await import\(\/\* @vite-ignore \*\/ YJS_MODULE_URL\);/);
assert.doesNotMatch(html, /await import\("https:\/\/esm\.sh/, "the Yjs URL must not be hardcoded in the import call");
assert.match(html, /if \(!YJS_MODULE_URL\) throw new Error\(/);
assert.match(html, /function applyCollaborationAvailability\(\)/);
assert.match(html, /if \(!COLLAB_DISABLED && collaboration\.docId\) \{/);
assert.match(html, /if \(COLLAB_DISABLED\) \{\s*setStatus\("Kolaborasi tidak tersedia pada versi offline\."\);/);

// Deploy wiring: the published page must point at the deployed collab Worker.
const meta = html.match(/<meta name="ba-collab-worker-url" content="([^"]+)"/);
assert.ok(meta, "ba-collab-worker-url meta tag must exist for the Pages build");
assert.match(meta[1], /^https:\/\/[a-z0-9.-]+\.workers\.dev$/, "worker URL must be an https workers.dev origin");

console.log("collabSync: anti-clobber, caret, liveness, and offline-guard assertions passed");
