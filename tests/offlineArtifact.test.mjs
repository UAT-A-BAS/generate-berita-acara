import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const artifact = new URL("../berita-acara-generator-offline.html", import.meta.url);
assert.ok(existsSync(artifact), "Offline artifact is missing; run npm run build:offline");
const html = readFileSync(artifact, "utf8");
assert.doesNotMatch(html, /<script\b[^>]*\bsrc\s*=\s*["']https?:/i);
assert.doesNotMatch(html, /<link\b[^>]*\bhref\s*=\s*["']https?:/i);
assert.doesNotMatch(html, /esm\.sh|workers\.dev|jsdelivr/i);
assert.ok(html.includes("window.BA_COLLAB_DISABLED = true;"));
assert.ok(html.includes('<meta name="ba-collab-offline" content="true">'));
assert.match(html, /jsPDF - PDF Document creation from JavaScript/);
assert.match(html, /\.jspdf=\{\}/);
for (const script of html.matchAll(/<script\b([^>]*)>[\s\S]*?<\/script>/gi)) {
  assert.doesNotMatch(script[1], /\bsrc\s*=/i, "Every loaded script must be inline");
}
console.log("Offline artifact: self-contained scripts/styles, collaboration disabled, jsPDF embedded");
