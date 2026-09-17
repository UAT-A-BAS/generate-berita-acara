// Assembles the static Cloudflare Pages bundle for generate-berita-acara.pages.dev.
// Only the files the browser actually loads are copied, so tests and tooling stay private.
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(repoRoot, "dist-pages");

const STATIC_FILES = [
  ["index.html", "index.html"],
  ["src/sharedData.js", "src/sharedData.js"]
];

async function main() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  for (const [from, to] of STATIC_FILES) {
    const target = path.join(outDir, to);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.join(repoRoot, from), target);
  }

  await cp(
    path.join(repoRoot, "Panduan menggunakan Berita Acara Generator.docx"),
    path.join(outDir, "panduan-berita-acara-generator.docx")
  );

  await writeFile(path.join(outDir, "_headers"), [
    "/index.html",
    "  Cache-Control: no-cache",
    "",
    "/*",
    "  X-Content-Type-Options: nosniff",
    ""
  ].join("\n"));

  const html = await readFile(path.join(outDir, "index.html"), "utf8");
  const workerUrl = (html.match(/<meta name="ba-collab-worker-url" content="([^"]+)"/) || [])[1] || "";
  if (!workerUrl) {
    throw new Error("ba-collab-worker-url meta tag missing from index.html; the collab Worker would be unreachable from Pages.");
  }

  console.log(`dist-pages ready: ${STATIC_FILES.length} static files + panduan, index.html ${Buffer.byteLength(html)} bytes`);
  console.log(`collab worker: ${workerUrl}`);
}

await main();
