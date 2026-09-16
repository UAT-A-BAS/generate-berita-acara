import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

// Read the switch from the app instead of hardcoding it, so the harness can never drift from index.html.
function autoHangValue() {
  const match = html.match(/const AUTO_HANG_LIST_CONTINUATIONS = (true|false);/);
  assert.ok(match, "AUTO_HANG_LIST_CONTINUATIONS must be declared in index.html");
  return match[1];
}
assert.equal(autoHangValue(), "false", "plain lines must not auto-align unless explicitly indented");

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

const helpers = Function(`
  const AUTO_HANG_LIST_CONTINUATIONS = ${autoHangValue()};
  const INDENT_STEP_SPACES = 2;
  const MAX_INDENT_SPACES = 8;
  ${[
    "parseListLine",
    "listPrefix",
    "listContentColumn",
    "indentTargetSpaces",
    "buildIndentEdits",
    "buildListEdits",
    "buildIndentCommandEdits",
    "layoutCellLines",
    "normalizeCellText",
    "sanitizeRichFormats",
    "sliceRichFormats",
    "pdfSegmentsForRange",
    "pdfFontStyle",
    "measurePdfSegments",
    "splitPdfRichText",
    "escapeHtml",
    "richSliceToHtml",
    "richTextToPreviewHtml"
  ].map(extractFunction).join("\n")}
  return { parseListLine, buildListEdits, buildIndentEdits, buildIndentCommandEdits, layoutCellLines, normalizeCellText, richTextToPreviewHtml, splitPdfRichText, listContentColumn, indentTargetSpaces };
`)();

// Helvetica-like metrics: digits/letters 0.55em, dot/space 0.28em at 10.5pt.
const glyphWidth = (char) => (char === " " || char === "." ? 2.94 : 5.775);
const measure = (value) => [...String(value)].reduce((sum, char) => sum + glyphWidth(char), 0);
const pdf = {
  setFont() {},
  setFontSize() {},
  rect() {},
  line() {},
  getTextWidth: measure,
  text() {}
};
const layout = { fontFamily: "helvetica", bodySize: 10.5, padX: 5, padY: 6, bodyLine: 13 };
const apply = (text, edits) => {
  let value = text;
  [...edits].sort((left, right) => right.start - left.start).forEach((edit) => {
    value = value.slice(0, edit.start) + edit.text + value.slice(edit.end);
  });
  return value;
};

// 1. No numbering, no tab -> flush left in preview and PDF.
const flush = helpers.layoutCellLines("Pembukaan Rekening Giro Badan");
assert.equal(flush.length, 1);
assert.equal(flush[0].kind, "plain");
assert.equal(flush[0].contentColumn, 0, "an unnumbered line with no tab stays flush left");
assert.equal(flush[0].contentStart, 0, "no characters are skipped for a flush-left line");
assert.doesNotMatch(helpers.richTextToPreviewHtml("Pembukaan Rekening Giro Badan", [], "activity", pdf, layout), /doc-cell-list/);

// 2. An unindented line inside a list block stays flush left; it only aligns when the user tabs it.
const unindented = helpers.layoutCellLines("1. Test Berita acara\n\naaaa");
assert.equal(unindented[0].kind, "list");
assert.equal(unindented[2].kind, "plain", "an unindented line carries no list marker and no list indent");
assert.equal(unindented[2].contentColumn, 0, "an unindented line does not inherit the numbering column");
assert.equal(unindented[2].contentStart, unindented[2].start, "the whole line renders from its first character");

const tabbedHang = helpers.layoutCellLines("1. Test Berita acara\n\naaaa\n    aaaa", measure);
assert.equal(tabbedHang[2].contentColumn, 0, "the unindented line stays flush left even when a later line is tabbed");
assert.ok(tabbedHang[3].contentColumn > 0, "the tabbed line is the only one that aligns");

// 3. Explicit leading spaces drive the content column and match in preview and PDF.
const tabbed = "1. Test Berita acara\n  aaaa";
const tabbedLines = helpers.layoutCellLines(tabbed, measure);
const target = helpers.indentTargetSpaces(helpers.parseListLine("1. Test Berita acara"), measure);
assert.equal(target, 4, "a depth-1 '1.' marker needs 4 measured spaces");
assert.equal(tabbedLines[1].kind, "plain", "an explicitly tabbed line carries no marker");
assert.equal(
  tabbedLines[1].contentStart,
  tabbed.indexOf("aaaa"),
  "the tab spaces are consumed by the indent, not rendered as text"
);
assert.equal(tabbedLines[1].contentColumn, measure("  "), "explicit indent drives the content column");
const previewTabbed = helpers.richTextToPreviewHtml(tabbed, [], "activity", pdf, layout);
assert.match(previewTabbed, /--list-content:5\.88pt/, "preview uses the measured space width");
const pdfTabbed = helpers.splitPdfRichText(pdf, tabbed, 120, layout, []);
assert.equal(pdfTabbed[1][0].width, measure("  "), "PDF continuation uses the same measured offset");

// 4. The Tab button lands a plain line on the numbering column.
const numbered = "1. Test Berita acara\nPembukaan Rekening";
const tabbedText = apply(numbered, helpers.buildIndentCommandEdits(numbered, numbered.length, numbered.length, "in", measure));
assert.equal(tabbedText, "1. Test Berita acara\n    Pembukaan Rekening", "Tab snaps to the '1.' content column");
// Stored indentation is whole spaces, so the best possible snap is within half a space.
const snappedColumn = helpers.layoutCellLines(tabbedText, measure)[1].contentColumn;
const markerColumn = helpers.listContentColumn(helpers.parseListLine("1. Test Berita acara"), measure);
assert.ok(
  Math.abs(snappedColumn - markerColumn) <= measure(" ") / 2,
  `tabbed plain line snaps onto the numbering column (${snappedColumn} vs ${markerColumn})`
);
assert.ok(
  Math.abs(snappedColumn - markerColumn) < Math.abs(measure("  ") - markerColumn),
  "snapping is closer than a bare two-space step would be"
);

// 5. Shift+Tab steps back by one indent step, floor at zero.
const untabbed = apply(tabbedText, helpers.buildIndentCommandEdits(tabbedText, tabbedText.length, tabbedText.length, "out", measure));
assert.equal(untabbed, "1. Test Berita acara\n  Pembukaan Rekening");
const untabbedTwice = apply(untabbed, helpers.buildIndentCommandEdits(untabbed, untabbed.length, untabbed.length, "out", measure));
assert.equal(untabbedTwice, "1. Test Berita acara\nPembukaan Rekening", "outdent never removes characters other than spaces");
assert.deepEqual(helpers.buildIndentEdits("teks", 0, 0, "out", measure), [], "outdent on a flush-left line is a no-op");

// 6. Without a list scope Tab uses one fixed step, and the cap is respected.
assert.equal(apply("teks", helpers.buildIndentCommandEdits("teks", 4, 4, "in", measure)), "  teks");
let capped = "teks";
for (let index = 0; index < 12; index += 1) capped = apply(capped, helpers.buildIndentCommandEdits(capped, capped.length, capped.length, "in", measure));
assert.equal(capped.match(/^ */)[0].length, 8, "indent stops at MAX_INDENT_SPACES");

// 7. List lines delegate to buildListEdits, so the shipped nested-numbering behaviour is untouched.
const listInput = "1. Satu\n2. Dua\n3. Tiga\n4. Empat";
const nestedStart = listInput.indexOf("3. Tiga");
assert.equal(
  apply(listInput, helpers.buildIndentCommandEdits(listInput, nestedStart, listInput.length, "in", measure)),
  apply(listInput, helpers.buildListEdits(listInput, nestedStart, listInput.length, "indent")),
  "Tab on list lines delegates to the existing indent command"
);
assert.equal(
  apply(listInput, helpers.buildIndentCommandEdits(listInput, nestedStart, listInput.length, "in", measure)),
  "1. Satu\n2. Dua\n  1. Tiga\n  2. Empat"
);

// 8. Stored text keeps plain leading spaces and still trims trailing whitespace.
assert.equal(helpers.normalizeCellText("  teks  "), "  teks");
assert.equal(helpers.normalizeCellText("1. Satu\n  lanjutan   "), "1. Satu\n  lanjutan");
assert.equal(helpers.normalizeCellText("teks\n\n\nlain"), "teks\n\nlain");

// 9. The auto-hang default is a single documented switch.
assert.match(html, /const AUTO_HANG_LIST_CONTINUATIONS = (true|false);/);
const layoutSource = extractFunction("layoutCellLines");
assert.match(layoutSource, /AUTO_HANG_LIST_CONTINUATIONS/, "layoutCellLines must read the switch");
assert.equal((html.match(/AUTO_HANG_LIST_CONTINUATIONS/g) || []).length, 2, "the switch is declared once and read once");

console.log("tabIndent: ok");
