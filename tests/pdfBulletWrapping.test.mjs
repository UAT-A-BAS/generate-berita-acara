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
  "layoutCellLines",
  "normalizeCellText",
  "sanitizeRichFormats",
  "sliceRichFormats",
  "pdfSegmentsForRange",
  "pdfFontStyle",
  "measurePdfSegments",
  "splitPdfRichText",
  "splitPdfRichChunks",
  "drawPdfCell",
  "escapeHtml",
  "richSliceToHtml",
  "richTextToPreviewHtml"
].map(extractFunction).join("\n");

const { splitPdfRichText, splitPdfRichChunks, drawPdfCell, richTextToPreviewHtml, layoutCellLines } = Function(`
  const AUTO_HANG_LIST_CONTINUATIONS = ${html.match(/const AUTO_HANG_LIST_CONTINUATIONS = (true|false);/)[1]};
  ${functionSource}
  return { splitPdfRichText, splitPdfRichChunks, drawPdfCell, richTextToPreviewHtml, layoutCellLines };
`)();
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

const continuation = splitPdfRichText(pdf, "1. Test Berita acara\n\naaaa", 80, layout, []);
assert.equal(continuation.length, 3, "an explicit blank line is retained");
assert.equal(continuation[1].map((segment) => segment.text).join("").trim(), "");
const flushPrefix = continuation[2].slice(0, -1).reduce((sum, segment) => sum + (segment.width ?? pdf.getTextWidth(segment.text)), 0);
assert.equal(flushPrefix, 0, "an unindented line stays flush left even after a numbered item");

const indentedContinuation = splitPdfRichText(pdf, "1. Test Berita acara\n\naaaa\n    aaaa", 80, layout, []);
const indentedPrefix = indentedContinuation[3].slice(0, -1).reduce((sum, segment) => sum + (segment.width ?? pdf.getTextWidth(segment.text)), 0);
assert.equal(indentedPrefix, pdf.getTextWidth("    "), "an explicitly tabbed line hangs by its own measured indent");

const draws = [];
const proportionalPdf = {
  ...pdf,
  getTextWidth(value) { return [...value].reduce((sum, char) => sum + (char === " " ? 0.7 : char === "." ? 0.4 : 1.1), 0); },
  rect() {},
  text(text, x, y) { if (text.trim()) draws.push({ text, x, y }); },
  line() {}
};
const renderLayout = { ...layout, padX: 5, padY: 6, bodyLine: 13 };
const nested = "  12. Nama panjang untuk menguji baris lanjutan dan indentasi di dalam sel";
drawPdfCell(proportionalPdf, renderLayout, 0, 0, 42, 150, nested);
const contentDraws = draws.filter((draw) => draw.text.trim() !== "12.");
const firstXByRow = [...new Map(contentDraws.map((draw) => [draw.y, contentDraws.find((first) => first.y === draw.y).x])).values()];
const expectedColumn = proportionalPdf.getTextWidth("  12. ");
assert.ok(firstXByRow.length > 1, "fixture wraps the list item onto several PDF lines");
assert.ok(firstXByRow.every((x) => Math.abs(x - (5 + expectedColumn)) < 1e-9), "every wrapped line of a list item hangs at that item's exact content column");
const preview = richTextToPreviewHtml(nested, [], "activity", proportionalPdf, renderLayout);
const previewColumns = [...preview.matchAll(/--list-content:([\d.]+)pt/g)].map((match) => Number(match[1]));
assert.ok(previewColumns.length === 1 && Math.abs(previewColumns[0] - expectedColumn) < 1e-9, "preview and PDF use identical item-specific content columns");
assert.match(preview, /--list-indent:1.4pt/, "nested preview indentation is the PDF two-space width");
assert.match(preview, /class="doc-list-content"/, "list content owns a block for hanging automatic wraps");
assert.match(html, /padding-left:\s*var\(--list-content/);
assert.match(html, /\.doc-list-marker\s*\{[^}]*position:\s*absolute/);
assert.match(html, /\.doc-list-content,[\s\S]*?display:\s*block/);

// A plain line inside a list block is flush left unless the user tabbed it.
draws.length = 0;
drawPdfCell(proportionalPdf, renderLayout, 0, 0, 42, 150, "  12. Judul\nlanjutan tanpa tab\n  lanjutan dengan tab");
const rowStarts = [];
draws.forEach((draw) => {
  if (!rowStarts.some((row) => row.y === draw.y)) rowStarts.push({ y: draw.y, x: draw.x, text: draw.text });
});
assert.equal(rowStarts.length, 3, "marker row plus one unindented and one tabbed continuation");
assert.equal(rowStarts[0].x, renderLayout.padX, "the list marker renders from the cell content edge");
assert.equal(rowStarts[1].x, renderLayout.padX, "an unindented line renders from the cell content edge");
assert.equal(rowStarts[2].x, renderLayout.padX + proportionalPdf.getTextWidth("  "), "a tabbed line renders from its own measured indent");
const mixedPreview = richTextToPreviewHtml("  12. Judul\nlanjutan tanpa tab\n  lanjutan dengan tab", [], "activity", proportionalPdf, renderLayout);
assert.equal(
  [...mixedPreview.matchAll(/--list-content:([\d.]+)pt/g)].map((match) => Number(match[1])).join(","),
  `${expectedColumn},${proportionalPdf.getTextWidth("  ")}`,
  "preview only indents the tabbed line, matching the PDF"
);

const kinds = layoutCellLines("plain\n\n1. first\n\ncontinuation\nnext continuation\n  20. next\nlast");
assert.deepEqual(kinds.map((line) => line.kind), ["plain", "blank", "list", "blank", "plain", "plain", "list", "plain"]);
assert.equal(kinds[1].contentColumn, 0, "blank lines never gain indentation");
assert.equal(kinds[3].contentColumn, 0, "blank lines after a list stay blank");
assert.equal(kinds[4].contentColumn, 0, "an unindented line inside a list block stays flush left");
assert.equal(kinds[6].markerText, "20.", "a nested list item keeps its own marker");
assert.equal(kinds[7].contentColumn, 0, "a trailing unindented line stays flush left");

const chunkText = "  12. first\n  second\n  third\n  fourth";
const chunks = splitPdfRichChunks(proportionalPdf, renderLayout, chunkText, [], 50, 2);
assert.equal(chunks.length, 2);
assert.equal(chunks[1].text, "  third\n  fourth", "pagination does not inject a new marker into source text");
assert.equal(chunks[1].listContext.marker, "12");
const pageContinuation = splitPdfRichText(proportionalPdf, chunks[1].text, 50, renderLayout, [], chunks[1].listContext);
assert.ok(pageContinuation.every((segments) => Math.abs(segments[0].width - proportionalPdf.getTextWidth("  ")) < 1e-9), "a tabbed continuation keeps its column across pages");

const longText = "  12. " + "formatted content ".repeat(20).trimEnd();
const longChunks = splitPdfRichChunks(proportionalPdf, renderLayout, longText, [{ start: 6, end: longText.length, bold: true }], 35, 2);
assert.ok(longChunks.length > 1);
assert.ok(longChunks.every((chunk) => chunk.formats.some((format) => format.bold)), "splitting a long list item retains rich formats");
assert.ok(longChunks.slice(1).every((chunk) => chunk.listContext.marker === "12"), "automatic wraps retain list context across oversized chunks");

draws.length = 0;
const picList = "Intro\n1. PIC name\ncontinued";
drawPdfCell(proportionalPdf, renderLayout, 0, 0, 60, 100, picList, "center");
assert.equal(draws.find((draw) => draw.text === "Intro").x, renderLayout.padX, "plain introduction of a list-bearing PIC cell is also left-aligned");
assert.equal(draws.find((draw) => draw.text === "PIC").x, renderLayout.padX + proportionalPdf.getTextWidth("1. "), "the list item's content hangs under its own marker");
assert.equal(draws.find((draw) => draw.text === "continued").x, renderLayout.padX, "an unindented line after a list item stays flush left inside PIC too");
assert.ok(draws.every((draw) => draw.x >= renderLayout.padX && draw.x < 30), "a list-bearing PIC cell is left-aligned as a whole, never centered");
assert.match(richTextToPreviewHtml(picList, [], "pic", proportionalPdf, renderLayout), /^<span class="doc-cell-list"><span class="doc-text-line">Intro/);
assert.match(html, /\.doc-cell-list\s*\{[^}]*text-align:\s*left/);
draws.length = 0;
drawPdfCell(proportionalPdf, renderLayout, 0, 0, 60, 100, "PIC", "center");
assert.equal(draws[0].x, 30 - proportionalPdf.getTextWidth("PIC") / 2, "plain-only PIC remains centered");
assert.doesNotMatch(richTextToPreviewHtml("PIC", [], "pic", proportionalPdf, renderLayout), /doc-cell-list/);
