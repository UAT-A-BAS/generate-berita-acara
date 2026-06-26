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

const canReconnectCollaboration = Function(`return (${extractFunction("canReconnectCollaboration")});`)();
assert.equal(
  canReconnectCollaboration({ active: true, ready: true, idle: false, hidden: false, socketReadyState: 3 }),
  true,
  "visible active collaboration reconnects after a closed socket"
);
assert.equal(
  canReconnectCollaboration({ active: true, ready: true, idle: true, hidden: false, socketReadyState: 3 }),
  false,
  "idle collaboration does not reconnect in the background"
);
assert.equal(
  canReconnectCollaboration({ active: true, ready: true, idle: false, hidden: true, socketReadyState: 3 }),
  false,
  "hidden tabs do not reconnect in the background"
);
assert.equal(
  canReconnectCollaboration({ active: true, ready: true, idle: false, hidden: false, socketReadyState: 1 }),
  false,
  "open sockets do not start duplicate reconnects"
);

const getCollaborationReconnectDelay = Function(`return (${extractFunction("getCollaborationReconnectDelay")});`)();
assert.equal(getCollaborationReconnectDelay(0, 1200, 15000), 1200);
assert.equal(getCollaborationReconnectDelay(2, 1200, 15000), 4800);
assert.equal(getCollaborationReconnectDelay(8, 1200, 15000), 15000);

assert.match(html, /const COLLAB_IDLE_TIMEOUT_MS = 5 \* 60 \* 1000;/);
assert.match(html, /const COLLAB_HIDDEN_TIMEOUT_MS = 60 \* 1000;/);
assert.match(html, /const COLLAB_AUTOSAVE_DELAY_MS = 2500;/);
assert.match(html, /const COLLAB_ACTIVITY_EVENTS = \["keydown", "input", "click", "mousemove", "scroll", "touchstart"\];/);
assert.match(html, /setTimeout\(\(\) => pauseCollaborationForIdle\("idle"\), COLLAB_IDLE_TIMEOUT_MS\)/);
assert.match(html, /setTimeout\(\(\) => pauseCollaborationForIdle\("hidden"\), COLLAB_HIDDEN_TIMEOUT_MS\)/);
assert.match(html, /autosaveTimer = setTimeout\(\(\) => \{/);
assert.match(html, /}, COLLAB_AUTOSAVE_DELAY_MS\);/);
assert.match(html, /document\.addEventListener\("visibilitychange", handleCollaborationVisibilityChange\);/);
assert.match(html, /window\.addEventListener\("pagehide", handleCollaborationPageExit\);/);
assert.match(html, /window\.addEventListener\("beforeunload", handleCollaborationPageExit\);/);
assert.doesNotMatch(html, /setTimeout\(connectCollaborationSocket, 1800\)/);
