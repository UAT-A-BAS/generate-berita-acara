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

const functionSource = [
  "parseListLine",
  "normalizeCellText",
  "sanitizeRichFormats",
  "pdfSegmentsForRange",
  "pdfFontStyle",
  "measurePdfSegments",
  "splitPdfRichText"
].map(extractFunction).join("\n");

const splitPdfRichText = Function(`${functionSource}; return splitPdfRichText;`)();
const pdf = {
  setFont() {},
  setFontSize() {},
  getTextWidth(text) { return String(text).length; }
};
const layout = { fontFamily: "helvetica", bodySize: 10.5 };
const lines = splitPdfRichText(
  pdf,
  "- Berhasil melakukan transaksi dengan keterangan yang sangat panjang dan harus turun baris",
  28,
  layout,
  []
).map((segments) => segments.map((segment) => segment.text).join(""));

assert.ok(lines.length > 1, "fixture must wrap to multiple PDF lines");
assert.ok(lines[0].startsWith("- "), "first line keeps the manually entered marker");
assert.equal(lines.filter((line) => line.startsWith("- ")).length, 1, "wrapped continuation must not create another marker");

const nestedBullet = splitPdfRichText(pdf, "  o Sub kedua", 80, layout, [])
  .map((segments) => segments.map((segment) => segment.text).join(""));
assert.ok(nestedBullet[0].startsWith("  o "), "legacy nested bullets keep their input marker");

const memoStyleNestedNumber = splitPdfRichText(pdf, "    1. Sub ketiga", 80, layout, [])
  .map((segments) => segments.map((segment) => segment.text).join(""));
assert.ok(memoStyleNestedNumber[0].startsWith("    1. "), "third-level numbering keeps its local marker and indent");

const compactNestedBlock = splitPdfRichText(pdf, "1. Satu\n  1. Dua\n    1. Tiga\n    \u2022 Bullet", 80, layout, [])
  .map((segments) => segments.map((segment) => segment.text).join(""));
assert.equal(compactNestedBlock.length, 4, "PDF produces exactly one row per unwrapped list item without spacer rows");

const nestedNumber = splitPdfRichText(pdf, "    1.1.1. Sub ketiga", 80, layout, [])
  .map((segments) => segments.map((segment) => segment.text).join(""));
assert.ok(nestedNumber[0].startsWith("    1.1.1. "), "third-level numbering keeps its prescribed marker and indent");

const doubleDigitNumber = splitPdfRichText(pdf, "  1.10. Nomor dua digit", 80, layout, [])
  .map((segments) => segments.map((segment) => segment.text).join(""));
assert.equal(doubleDigitNumber.length, 1, "a two-digit nested marker stays on one PDF line when content fits");
assert.ok(doubleDigitNumber[0].startsWith("  1.10. "), "PDF keeps the complete two-digit marker intact");
