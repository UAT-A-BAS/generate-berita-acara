// Guards the cost/durability contract of the collab Durable Object:
// - it must use the WebSocket Hibernation API, so an idle room is evicted from memory
//   instead of being billed for duration while a socket stays open;
// - it must hold no timers, because a pending setTimeout keeps the object alive and is
//   lost on eviction;
// - it must persist every accepted update before acknowledging it, because hibernation
//   discards in-memory Y.Doc state and a wake rebuilds the doc from storage.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as Y from "yjs";

import { BeritaAcaraRoom } from "../src/worker.js";

const source = await readFile(new URL("../src/worker.js", import.meta.url), "utf8");

// --- Source-level guarantees about the execution model ------------------------------

assert.match(source, /this\.state\.acceptWebSocket\(server\)/, "must accept sockets through the hibernation API");
assert.doesNotMatch(source, /socket\.accept\(\)/, "must not use the non-hibernating accept() path");
assert.doesNotMatch(source, /\bsetTimeout\(/, "a pending setTimeout would block hibernation");
assert.doesNotMatch(source, /\bsetInterval\(/, "a pending setInterval would block hibernation");
assert.match(source, /async webSocketMessage\(/, "hibernation delivers messages through webSocketMessage");
assert.match(source, /webSocketClose\(/, "hibernation reports disconnects through webSocketClose");
assert.match(source, /serializeAttachment/, "per-socket presence must survive hibernation as an attachment");
assert.doesNotMatch(source, /\bthis\.sessions\b/, "no in-memory session map may outlive hibernation");

// --- Behavioural checks with a fake Durable Object runtime ---------------------------

function createFakeSocket() {
  const sent = [];
  let attachment = null;
  return {
    sent,
    get attachment() {
      return attachment;
    },
    send(data) {
      if (this.closed) throw new Error("socket closed");
      // Mirror the platform contract: a WebSocket frame is a string or binary, never an
      // object. Sending an object would fail in production, so fail loudly here too.
      const isBinary = data instanceof ArrayBuffer || ArrayBuffer.isView(data);
      if (typeof data !== "string" && !isBinary) {
        throw new TypeError(`WebSocket frame must be a string or binary, got ${Object.prototype.toString.call(data)}`);
      }
      sent.push(data);
    },
    close() {
      this.closed = true;
    },
    serializeAttachment(value) {
      attachment = value;
    },
    deserializeAttachment() {
      return attachment;
    }
  };
}

function createFakeState(storage) {
  const sockets = [];
  return {
    sockets,
    storage,
    acceptWebSocket(socket) {
      sockets.push(socket);
    },
    getWebSockets() {
      return [...sockets];
    },
    dropSocket(socket) {
      const index = sockets.indexOf(socket);
      if (index >= 0) sockets.splice(index, 1);
    }
  };
}

function createFakeStorage(rows = new Map()) {
  return {
    rows,
    reads: 0,
    writes: 0,
    async get(key) {
      this.reads += 1;
      return rows.get(key);
    },
    async put(key, value) {
      this.writes += 1;
      rows.set(key, value);
    }
  };
}

// Node's Response rejects status 101 ("must be in the range of 200 to 599"), while workerd
// allows it for WebSocket upgrades. Shim exactly that one case so the real room code runs
// unmodified here.
const RealResponse = globalThis.Response;
globalThis.Response = class extends RealResponse {
  constructor(body, init) {
    if (init?.status === 101) {
      return { status: 101, webSocket: init.webSocket, headers: new Headers(init.headers), isUpgrade: true };
    }
    super(body, init);
  }
};

let createdPairs = [];
globalThis.WebSocketPair = class {
  constructor() {
    const client = createFakeSocket();
    const server = createFakeSocket();
    createdPairs.push({ client, server });
    this[0] = client;
    this[1] = server;
  }
};

function resetPairs() {
  createdPairs = [];
}

function lastPair() {
  return createdPairs[createdPairs.length - 1];
}

const upgradeRequest = (docId) => new Request(`https://room.example/collab/${docId}`, {
  headers: { Upgrade: "websocket" }
});

function seedUpdate(docId, data) {
  const doc = new Y.Doc();
  const state = doc.getMap("form");
  Object.entries(data).forEach(([key, value]) => state.set(key, value));
  return { update: Y.encodeStateAsUpdate(doc), doc };
}

// A room accepts a socket, hands over the current state, and persists each update.
{
  resetPairs();
  const storage = createFakeStorage();
  const state = createFakeState(storage);
  const room = new BeritaAcaraRoom(state, {});

  const response = await room.fetch(upgradeRequest("room-a"));
  assert.equal(response.status, 101, "websocket upgrade must return 101");
  assert.equal(state.getWebSockets().length, 1, "the socket is registered with the runtime");
  const server = lastPair().server;
  assert.ok(server.sent.length >= 1, "the joiner receives the current room state");
  assert.equal(storage.writes, 0, "an empty room writes nothing on connect");

  const { update } = seedUpdate("room-a", { featureName: "Proyek A", branchName: "Cabang A" });
  await room.webSocketMessage(server, update);
  assert.equal(storage.writes, 1, "each accepted update is persisted");
  const saved = server.sent.map((item) => (typeof item === "string" ? item : "")).join("");
  assert.match(saved, /"type":"saved"/, "the sender is acknowledged only after the write");

  // Exactly one storage read for the whole life of this instance, not one per message.
  assert.equal(storage.reads, 1, "the document is loaded once per instance");
}

// Hibernation sweep: a brand-new instance sharing the same storage must see the edit.
{
  resetPairs();
  const storage = createFakeStorage();
  const stateA = createFakeState(storage);
  const roomA = new BeritaAcaraRoom(stateA, {});
  await roomA.fetch(upgradeRequest("room-b"));
  const { update, doc } = seedUpdate("room-b", { featureName: "Sebelum Hibernasi", branchName: "Cabang B" });
  await roomA.webSocketMessage(lastPair().server, update);

  // Simulate hibernation: the object is discarded and rebuilt from storage alone.
  const stateB = createFakeState(storage);
  const roomB = new BeritaAcaraRoom(stateB, {});
  resetPairs();
  await roomB.fetch(upgradeRequest("room-b"));

  const handedOver = lastPair().server.sent[0];
  const bytes = handedOver instanceof ArrayBuffer
    ? new Uint8Array(handedOver)
    : handedOver instanceof Uint8Array
      ? handedOver
      : null;
  assert.ok(bytes, `a woken room replays the stored state (got ${Object.prototype.toString.call(handedOver)})`);
  const rebuilt = new Y.Doc();
  Y.applyUpdate(rebuilt, bytes);
  assert.equal(rebuilt.getMap("form").get("featureName"), "Sebelum Hibernasi", "the edit survives eviction");
  assert.equal(rebuilt.getMap("form").get("branchName"), "Cabang B");
  assert.equal(doc.getMap("form").get("featureName"), "Sebelum Hibernasi");
}

// Presence lives in the socket attachment, so it is still correct after a wake.
{
  resetPairs();
  const storage = createFakeStorage();
  const state = createFakeState(storage);
  const room = new BeritaAcaraRoom(state, {});
  await room.fetch(upgradeRequest("room-c"));
  const a = lastPair().server;
  await room.webSocketMessage(a, JSON.stringify({ type: "presence", user: { id: "u1", name: "Peer A", color: "#1b4d78" } }));
  assert.deepEqual(a.attachment, { id: "u1", name: "Peer A", color: "#1b4d78" });

  const b = createFakeSocket();
  state.acceptWebSocket(b);
  await room.webSocketMessage(b, JSON.stringify({ type: "presence", user: { id: "u2", name: "Peer B", color: "#1f7a4d" } }));
  const presence = b.sent.map((item) => (typeof item === "string" ? item : "")).join("");
  assert.match(presence, /"users":\[/, "presence is broadcast to the room");
  assert.match(presence, /Peer A/, "the other peer is listed");

  // Rebuild from storage: attachments are carried by the runtime, not by this object.
  const woken = new BeritaAcaraRoom(state, {});
  woken.broadcastPresence();
  const afterWake = b.sent.map((item) => (typeof item === "string" ? item : "")).join("");
  assert.match(afterWake, /Peer A/, "presence survives hibernation");

  // A disconnect drops that socket from presence.
  state.dropSocket(a);
  woken.webSocketClose(a);
  const latest = b.sent.filter((item) => typeof item === "string").pop();
  assert.doesNotMatch(latest, /Peer A/, "a closed socket is removed from presence");
}

// A malformed frame must not throw, and must not leave the room unusable.
{
  resetPairs();
  const storage = createFakeStorage();
  const state = createFakeState(storage);
  const room = new BeritaAcaraRoom(state, {});
  await room.fetch(upgradeRequest("room-d"));
  const socket = lastPair().server;

  // The room logs and survives bad frames; that log is expected here, so keep the output quiet.
  const realError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args[0]);
  try {
    await room.webSocketMessage(socket, "{ not json");
    await room.webSocketMessage(socket, null);
    await room.webSocketMessage(socket, new ArrayBuffer(0));
  } finally {
    console.error = realError;
  }
  assert.ok(logged.length >= 1, "a corrupt frame is logged for operators");
  const { update } = seedUpdate("room-d", { featureName: "Masih Hidup" });
  await room.webSocketMessage(socket, update);
  assert.equal(storage.writes, 1, "a good frame still persists after bad frames");
}

// Ping/pong answers with the room version and live socket count.
{
  resetPairs();
  const state = createFakeState(createFakeStorage());
  const room = new BeritaAcaraRoom(state, {});
  await room.fetch(upgradeRequest("room-e"));
  const socket = lastPair().server;
  await room.webSocketMessage(socket, JSON.stringify({ type: "ping" }));
  const pong = socket.sent.map((item) => (typeof item === "string" ? item : "")).find((item) => item.includes("pong"));
  assert.ok(pong, "ping is answered");
  assert.match(pong, /"version":"3"/, "pong advertises the current room version");

  const health = await room.fetch(new Request("https://room.example/collab/room-e"));
  const body = await health.json();
  assert.equal(body.users, 1, "the health payload reports live sockets");
  assert.equal(body.version, "3");
}

console.log("workerHibernation: hibernation API, durability across eviction, and presence assertions passed");
