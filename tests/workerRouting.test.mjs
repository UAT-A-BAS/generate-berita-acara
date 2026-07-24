import assert from "node:assert/strict";
import worker from "../src/worker.js";

const env = {
  BA_ROOMS: {
    idFromName(value) {
      return value;
    },
    get() {
      return { fetch: () => new Response("ok") };
    }
  }
};

const malformed = await worker.fetch(new Request("https://example.com/collab/%"), env);
assert.equal(malformed.status, 400);
assert.deepEqual(await malformed.json(), { ok: false, error: "Invalid document id." });

const missing = await worker.fetch(new Request("https://example.com/unknown"), env);
assert.equal(missing.status, 404);
