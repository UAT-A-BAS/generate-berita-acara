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
  return { parseListLine, buildListEdits, buildListEnterEdit };
`)();

const isSelectionFormatted = Function(
  "readRichFormats",
  `${extractFunction("isSelectionFormatted")} return isSelectionFormatted;`
)((textarea) => textarea.formats || []);

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
assert.match(html, /aria-label="Bullet list"/);
assert.match(html, /aria-label="Numbered list"/);
assert.match(html, /lucide-list/);
assert.match(html, /lucide-list-ordered/);
assert.match(html, /\.rich-toolbar\s*\{[\s\S]*?flex-wrap:\s*nowrap/);
assert.match(html, /function syncRichTextareaVisual/);
assert.doesNotMatch(extractFunction("syncRichTextareaVisual"), /#groups textarea/);
assert.match(extractFunction("syncRichTextareaVisual"), /matches\?\.\("textarea"\)/);
assert.match(html, /function autoResizeTextarea/);
assert.match(html, /resize:\s*none/);
assert.match(html, /class="readonly-display"/);
assert.match(html, /\.rich-text-mirror\s*\{[\s\S]*?font-weight:\s*400/);
assert.match(html, /\.rich-text-mirror strong\s*\{[\s\S]*?font-weight:\s*800/);
