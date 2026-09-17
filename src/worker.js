import * as Y from "yjs";

const ROOM_VERSION = "3";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type"
};

async function toUint8Array(data) {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (data?.arrayBuffer) return new Uint8Array(await data.arrayBuffer());
  return null;
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export class BeritaAcaraRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.doc = new Y.Doc();
    this.loaded = false;
    this.loadPromise = null;
  }

  async load() {
    if (this.loaded) return;
    // Hibernation evicts this object from memory, so every wake rebuilds the Y.Doc from
    // storage. Share one load promise so concurrent events do not read it twice.
    if (!this.loadPromise) this.loadPromise = this.loadFromStorage();
    await this.loadPromise;
  }

  async loadFromStorage() {
    try {
      const stored = await this.state.storage.get("ydoc");
      if (stored) Y.applyUpdate(this.doc, await toUint8Array(stored));
    } catch (error) {
      console.error("room load failed", error);
    }
    this.loaded = true;
  }

  async fetch(request) {
    await this.load();

    if (request.headers.get("Upgrade") !== "websocket") {
      return Response.json(
        { ok: true, users: this.state.getWebSockets().length, version: ROOM_VERSION },
        { headers: CORS_HEADERS }
      );
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    // acceptWebSocket (not socket.accept) is what lets the object hibernate: the edge keeps
    // the connection open while this object is evicted from memory and stops being billed
    // for duration. Messages wake it again through webSocketMessage.
    this.state.acceptWebSocket(server);
    server.send(Y.encodeStateAsUpdate(this.doc));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket, message) {
    await this.load();
    try {
      if (typeof message === "string") {
        this.handleTextMessage(socket, message);
        return;
      }

      const update = await toUint8Array(message);
      if (!update) return;
      Y.applyUpdate(this.doc, update);
      // Persist before acknowledging. A debounce timer would hold the object in memory,
      // block hibernation, and lose the edit if the object is evicted before it fires.
      // The client coalesces keystrokes instead, so this is one write per burst.
      await this.state.storage.put("ydoc", Y.encodeStateAsUpdate(this.doc).buffer);
      this.broadcast(update, socket);
      socket.send(JSON.stringify({ type: "saved" }));
    } catch (error) {
      // One malformed frame must never take down the room for everyone else.
      console.error("room message failed", error);
      try {
        socket.send(JSON.stringify({ type: "error", message: "Perubahan gagal diproses di server." }));
      } catch {
        // Socket already gone; nothing else to clean up.
      }
    }
  }

  webSocketClose(socket) {
    this.forgetUser(socket);
  }

  webSocketError(socket) {
    this.forgetUser(socket);
  }

  forgetUser(socket) {
    try {
      socket.serializeAttachment(null);
    } catch {
      // Socket already torn down.
    }
    this.broadcastPresence();
  }

  handleTextMessage(socket, rawMessage) {
    const message = safeJsonParse(rawMessage);
    if (!message) return;

    if (message.type === "ping") {
      this.send(socket, JSON.stringify({
        type: "pong",
        users: Math.max(1, this.state.getWebSockets().length),
        version: ROOM_VERSION
      }));
      return;
    }

    if (message.type === "sync") {
      this.send(socket, Y.encodeStateAsUpdate(this.doc));
      this.broadcastPresence();
      return;
    }

    if (message.type !== "presence" || !message.user) return;

    const user = {
      id: String(message.user.id || "").slice(0, 64),
      name: String(message.user.name || "User").slice(0, 32),
      color: /^#[0-9a-f]{6}$/i.test(message.user.color) ? message.user.color : "#1b4d78"
    };
    // Attachments are the only per-socket state that survives hibernation.
    socket.serializeAttachment(user);
    this.broadcastPresence();
  }

  send(socket, payload) {
    try {
      socket.send(payload);
      return true;
    } catch {
      return false;
    }
  }

  broadcast(message, exceptSocket = null) {
    this.state.getWebSockets().forEach((socket) => {
      if (socket === exceptSocket) return;
      if (!this.send(socket, message)) this.forgetUser(socket);
    });
  }

  broadcastPresence() {
    const users = this.state.getWebSockets()
      .map((socket) => {
        try {
          return socket.deserializeAttachment();
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    this.broadcast(JSON.stringify({ type: "presence", users }));
  }
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ ok: true, version: ROOM_VERSION, service: "generate-berita-acara-collab" }, { headers: CORS_HEADERS });
    }

    const match = url.pathname.match(/^\/collab\/([^/]+)$/);
    if (!match) {
      return Response.json(
        { ok: false, error: "Use /collab/:docId for websocket sync." },
        { status: 404, headers: CORS_HEADERS }
      );
    }

    let docId;
    try {
      docId = decodeURIComponent(match[1]).slice(0, 128);
    } catch {
      return Response.json(
        { ok: false, error: "Invalid document id." },
        { status: 400, headers: CORS_HEADERS }
      );
    }
    if (!docId) {
      return Response.json(
        { ok: false, error: "Document id is required." },
        { status: 400, headers: CORS_HEADERS }
      );
    }
    const objectId = env.BA_ROOMS.idFromName(docId);
    return env.BA_ROOMS.get(objectId).fetch(request);
  }
};
