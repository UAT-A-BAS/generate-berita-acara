import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const output = new URL("berita-acara-generator-offline.html", root);

function replaceRequired(html, pattern, replacement, description) {
  if (!pattern.test(html)) throw new Error(`Cannot build offline HTML: ${description} not found in index.html`);
  return html.replace(pattern, () => replacement);
}

function inlineScript(source) {
  return `<script>\n${source.replace(/<\/script/gi, "<\\/script")}\n</script>`;
}

function iconMask(path) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${path}" fill="none" stroke="black" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const url = `url("data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}")`;
  return `-webkit-mask-image:${url};mask-image:${url};`;
}

try {
  let html = await readFile(new URL("index.html", root), "utf8");
  html = replaceRequired(html, /<meta name="ba-collab-worker-url" content="[^"]*">/, '<meta name="ba-collab-offline" content="true">', "collaboration Worker meta tag");
  html = replaceRequired(html, /const YJS_MODULE_URL = "https:\/\/esm\.sh\/yjs@13\.6\.27";/, 'const YJS_MODULE_URL = "";', "Yjs module URL");
  const sharedTag = /<script src="\.\/src\/sharedData\.js"><\/script>/;
  html = replaceRequired(html, sharedTag, '<script>window.BA_COLLAB_DISABLED = true;</script>\n  <script src="./src/sharedData.js"></script>', "shared data script tag");
  html = replaceRequired(html, sharedTag, inlineScript(await readFile(new URL("src/sharedData.js", root), "utf8")), "shared data script tag");
  let pdf;
  try {
    pdf = await readFile(new URL("node_modules/jspdf/dist/jspdf.umd.min.js", root), "utf8");
  } catch (error) {
    throw new Error("Missing jsPDF bundle. Run npm ci, then npm run build:offline.", { cause: error });
  }
  html = replaceRequired(html, /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/jspdf@2\.5\.1\/dist\/jspdf\.umd\.min\.js"><\/script>/, inlineScript(pdf.replace(/\/\/# sourceMappingURL=.*$/gm, "")), "jsPDF CDN script tag");
  const iconStyle = `<style>\n.ph{display:inline-block;width:1em;height:1em;vertical-align:-0.125em;background-color:currentColor;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;-webkit-mask-size:contain;mask-size:contain}\n.ph-chat{${iconMask("M5 3h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H8l-5 3V5a2 2 0 0 1 2-2Z")}}\n.ph-trash{${iconMask("M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7")}}\n</style>`;
  html = replaceRequired(html, /<link rel="stylesheet" href="https:\/\/cdn\.jsdelivr\.net\/npm\/@phosphor-icons\/web@2\.1\.2\/src\/regular\/style\.css">/, iconStyle, "Phosphor CDN stylesheet");
  await writeFile(output, html);
  const urls = html.match(/https?:\/\/[^\s"'<>\\)]+/g) || [];
  console.log(`Offline HTML: ${fileURLToPath(output)}`);
  console.log(`Bytes: ${Buffer.byteLength(html)}`);
  console.log(`Remaining http(s) occurrences: ${urls.length}`);
  console.log("Unique URL strings (including bundle comments and SVG namespaces):");
  for (const url of [...new Set(urls)].sort()) console.log(`  ${url}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
