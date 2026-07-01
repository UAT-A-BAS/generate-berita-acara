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

const listHelpers = Function(`
  ${extractFunction("parseListLine")}
  ${extractFunction("listPrefix")}
  ${extractFunction("buildListEdits")}
  ${extractFunction("buildListEnterEdit")}
  return { parseListLine, listPrefix, buildListEdits, buildListEnterEdit };
`)();

const isSelectionFormatted = Function(
  "readRichFormats",
  `${extractFunction("isSelectionFormatted")} return isSelectionFormatted;`
)((textarea) => textarea.formats || []);

const renderEditorRichText = Function(`
  ${extractFunction("escapeHtml")}
  ${extractFunction("richSliceToHtml")}
  ${extractFunction("richTextToEditorHtml")}
  return richTextToEditorHtml;
`)();

function applyEdits(value, edits) {
  return [...edits]
    .sort((left, right) => right.start - left.start)
    .reduce((text, edit) => text.slice(0, edit.start) + edit.text + text.slice(edit.end), value);
}

assert.deepEqual(
  listHelpers.parseListLine("  o Sub kedua"),
  {
    kind: "bullet",
    depth: 2,
    marker: "o",
    content: "Sub kedua",
    prefixLength: 4,
    numberParts: []
  }
);
assert.equal(
  applyEdits("Alpha\nBeta", listHelpers.buildListEdits("Alpha\nBeta", 0, 10, "bullet")),
  "\u2022 Alpha\n\u2022 Beta",
  "bullet button formats all selected lines"
);
assert.equal(
  applyEdits("Alpha\nBeta", listHelpers.buildListEdits("Alpha\nBeta", 0, 10, "number")),
  "1. Alpha\n2. Beta",
  "number button formats all selected lines"
);
assert.equal(
  applyEdits("", listHelpers.buildListEdits("", 0, 0, "bullet")),
  "\u2022 ",
  "bullet button starts a list on an empty line"
);
assert.equal(
  applyEdits("\u2022 Alpha", listHelpers.buildListEdits("\u2022 Alpha", 0, 7, "bullet")),
  "Alpha",
  "pressing an active list button toggles the list off"
);
const numberedBlock = "1. Satu\n2. Dua\n3. Tiga\n4. Empat";
const numberedNestedStart = numberedBlock.indexOf("3. Tiga");
assert.equal(
  applyEdits(numberedBlock, listHelpers.buildListEdits(numberedBlock, numberedNestedStart, numberedBlock.length, "indent")),
  "1. Satu\n2. Dua\n  1. Tiga\n  2. Empat",
  "Tab starts a local nested numbering sequence like Generate Memo"
);
assert.equal(
  applyEdits("\u2022 Satu\n\u2022 Dua", listHelpers.buildListEdits("\u2022 Satu\n\u2022 Dua", 0, 13, "indent")),
  "  \u2022 Satu\n  \u2022 Dua",
  "Tab keeps round bullets at the second level like Generate Memo"
);
assert.equal(
  applyEdits("  \u2022 Dua", listHelpers.buildListEdits("  \u2022 Dua", 0, 8, "indent")),
  "    \u2022 Dua",
  "Tab keeps round bullets at the third level like Generate Memo"
);
assert.equal(
  applyEdits("    \u2022 Tiga", listHelpers.buildListEdits("    \u2022 Tiga", 0, 11, "indent")),
  "    \u2022 Tiga",
  "Tab cannot indent beyond three levels"
);
assert.equal(
  applyEdits("  1. Tiga\n  2. Empat", listHelpers.buildListEdits("  1. Tiga\n  2. Empat", 0, 21, "outdent")),
  "1. Tiga\n2. Empat",
  "Shift+Tab promotes a local nested numbering block"
);
assert.equal(listHelpers.listPrefix("number", 3, 1), "    1. ");
assert.equal(listHelpers.listPrefix("bullet", 3), "    \u2022 ");
assert.equal(
  applyEdits("\u2022 Alpha", [listHelpers.buildListEnterEdit("\u2022 Alpha", 7)]),
  "\u2022 Alpha\n\u2022 ",
  "Enter continues a bullet list"
);
assert.equal(
  applyEdits("3. Alpha", [listHelpers.buildListEnterEdit("3. Alpha", 8)]),
  "3. Alpha\n4. ",
  "Enter continues numbered lists with the next number"
);
assert.equal(
  applyEdits("\u2022 ", [listHelpers.buildListEnterEdit("\u2022 ", 2)]),
  "",
  "Enter on an empty list item exits the list"
);
assert.equal(
  applyEdits("1. Root\n  1. Child\n    1. ", [listHelpers.buildListEnterEdit("1. Root\n  1. Child\n    1. ", 28)]),
  "1. Root\n  1. Child\n  2. ",
  "Enter on an empty third-level item lifts it one level like Generate Memo"
);
assert.equal(
  applyEdits("\u2022 Root\n  \u2022 Child\n    \u2022 ", [listHelpers.buildListEnterEdit("\u2022 Root\n  \u2022 Child\n    \u2022 ", 24)]),
  "\u2022 Root\n  \u2022 Child\n  \u2022 ",
  "Enter on an empty nested bullet lifts it one level like Generate Memo"
);
assert.equal(
  isSelectionFormatted({
    value: "Alpha",
    selectionStart: 3,
    selectionEnd: 3,
    formats: [{ start: 0, end: 5, bold: true }]
  }, "bold"),
  false,
  "a caret without selected text must not activate formatting controls"
);
assert.equal(
  isSelectionFormatted({
    value: "Alpha",
    selectionStart: 0,
    selectionEnd: 5,
    formats: [{ start: 0, end: 5, bold: true }]
  }, "bold"),
  true,
  "a fully formatted selection activates its formatting control"
);
assert.equal(
  renderEditorRichText("\u2022 Relasi CIN\n1. Relasi ke = Pengurus", []),
  "\u2022 Relasi CIN<br>1. Relasi ke = Pengurus",
  "the editor mirror preserves list prefixes and exact character geometry"
);
assert.equal(
  renderEditorRichText("1. Alpha", [{ start: 3, end: 8, bold: true }]),
  "1. <strong>Alpha</strong>",
  "the editor mirror preserves inline formatting without changing list layout"
);

const draftFilename = Function(
  "sanitizeFilename",
  `return (${extractFunction("draftFilename")});`
)(Function(`return (${extractFunction("sanitizeFilename")});`)());
assert.equal(draftFilename("Project BDS 4.4.0"), "Project BDS 4 4 0_berita_acara.json");
assert.equal(draftFilename(""), "draft_berita_acara.json");

assert.match(html, /data-rich-command="bullet"/);
assert.match(html, /data-rich-command="number"/);
assert.doesNotMatch(html, /data-rich-command="outdent"/);
assert.doesNotMatch(html, /data-rich-command="indent"/);
assert.match(html, /event\.key === "Tab"/);
assert.match(html, /event\.shiftKey \? "outdent" : "indent"/);
assert.match(html, /aria-label="Bullet list"/);
assert.match(html, /aria-label="Numbered list"/);
assert.match(html, /lucide-list/);
assert.match(html, /lucide-list-ordered/);
assert.match(html, /\.rich-toolbar\s*\{[\s\S]*?flex-wrap:\s*nowrap/);
assert.doesNotMatch(html, /\.rich-tool:hover,\s*\.rich-tool\[aria-pressed="true"\]/);
assert.match(html, /\.rich-tool:hover\s*\{[\s\S]*?background:\s*#eef3f8/);
assert.match(html, /\.rich-tool\[aria-pressed="true"\]\s*\{[\s\S]*?background:\s*var\(--brand\)/);
assert.match(html, /function syncRichTextareaVisual/);
assert.doesNotMatch(extractFunction("syncRichTextareaVisual"), /#groups textarea/);
assert.match(extractFunction("syncRichTextareaVisual"), /matches\?\.\("textarea"\)/);
assert.match(extractFunction("syncRichTextareaVisual"), /richTextToEditorHtml/);
assert.match(html, /function autoResizeTextarea/);
const createActivityRowSource = extractFunction("createActivityRow");
assert.ok(
  createActivityRowSource.indexOf('appendChild(node)') < createActivityRowSource.indexOf('forEach(enhanceRichTextarea)'),
  "imported textareas must be attached before their auto-height is measured"
);
assert.match(html, /resize:\s*none/);
assert.match(html, /class="readonly-display"/);
assert.match(html, /\.rich-text-mirror\s*\{[\s\S]*?font-weight:\s*400/);
assert.match(html, /\.rich-text-mirror strong\s*\{[\s\S]*?font-weight:\s*800/);
