import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

assert.match(html, /fontFamilyPdf:\s*"helvetica"/);
assert.match(html, /function registerPdfFonts\(\)/);
assert.match(html, /return DOC_STYLE\.fontFamilyPdf/);
assert.doesNotMatch(html, /Carlito/);
assert.doesNotMatch(html, /raw\.githubusercontent\.com\/googlefonts\/carlito/);
assert.doesNotMatch(html, /addFileToVFS/);
assert.doesNotMatch(html, /addFont\(/);
assert.doesNotMatch(html, /fetchFontAsBase64/);
