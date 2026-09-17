import * as Y from "yjs";

const ROOM_VERSION = "2";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type"
};

const PERSIST_DEBOUNCE_MS = 400;

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
    this.sessions = new Map();
    this.loaded = false;
    this.persistTimer = null;
    this.persistDirty = false;
  }

  async load() {
    if (this.loaded) return;
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
      return Response.json({ ok: true, users: this.sessions.size }, { headers: CORS_HEADERS });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.handleSession(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  handleSession(socket) {
    socket.accept();
    const sessionId = crypto.randomUUID();
    this.sessions.set(sessionId, { socket, user: null });

    socket.send(Y.encodeStateAsUpdate(this.doc));

    socket.addEventListener("message", async (event) => {
      try {
        if (typeof event.data === "string") {
          this.handleTextMessage(sessionId, event.data);
          return;
        }

        const update = await toUint8Array(event.data);
        if (!update) return;
        Y.applyUpdate(this.doc, update);
        this.schedulePersist();
        this.broadcast(update, sessionId);
        socket.send(JSON.stringify({ type: "saved" }));
      } catch (error) {
        // One malformed frame must never take down the room for everyone else.
        console.error("room message failed", error);
        try {
          socket.send(JSON.stringify({ type: "error", message: "Perubahan gagal diproses di server." }));
        } catch {
          this.closeSession(sessionId);
        }
      }
    });

    socket.addEventListener("close", () => this.closeSession(sessionId));
    socket.addEventListener("error", () => this.closeSession(sessionId));
  }

  schedulePersist() {
    this.persistDirty = true;
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.flushPersist();
    }, PERSIST_DEBOUNCE_MS);
  }

  async flushPersist() {
    if (!this.persistDirty) return;
    this.persistDirty = false;
    try {
      await this.state.storage.put("ydoc", Y.encodeStateAsUpdate(this.doc).buffer);
    } catch (error) {
      console.error("room persist failed", error);
      this.persistDirty = true;
    }
  }

  handleTextMessage(sessionId, rawMessage) {
    const message = safeJsonParse(rawMessage);
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (message?.type === "ping") {
      try {
        session.socket.send(JSON.stringify({ type: "pong", users: this.sessions.size, version: ROOM_VERSION }));
      } catch {
        this.closeSession(sessionId);
      }
      return;
    }

    if (message?.type === "sync") {
      try {
        session.socket.send(Y.encodeStateAsUpdate(this.doc));
        this.broadcastPresence();
      } catch {
        this.closeSession(sessionId);
      }
      return;
    }

    if (message?.type !== "presence" || !message.user) return;

    session.user = {
      id: String(message.user.id || sessionId),
      name: String(message.user.name || "User").slice(0, 32),
      color: /^#[0-9a-f]{6}$/i.test(message.user.color) ? message.user.color : "#1b4d78"
    };
    this.broadcastPresence();
  }

  broadcast(message, exceptSessionId = "") {
    for (const [sessionId, session] of this.sessions) {
      if (sessionId === exceptSessionId) continue;
      try {
        session.socket.send(message);
      } catch {
        this.closeSession(sessionId);
      }
    }
  }

  broadcastPresence() {
    const users = [...this.sessions.values()]
      .map((session) => session.user)
      .filter(Boolean);
    const payload = JSON.stringify({ type: "presence", users });
    this.broadcast(payload);
  }

  closeSession(sessionId) {
    if (!this.sessions.delete(sessionId)) return;
    this.broadcastPresence();
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
