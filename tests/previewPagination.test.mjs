import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

function extractFunction(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const bodyStart = html.indexOf("{", start);
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

const previewRenderer = Function(`
  const previewWrapChars = { activity: 39, result: 37, pic: 10 };
  ${["normalizeText", "escapeHtml", "richSliceToHtml", "wrapPreviewRanges", "richTextToPreviewHtml"].map(extractFunction).join("\n")}
  return richTextToPreviewHtml;
`)();
const receiverName = "- Nama penerima kuasa: Agustina Rosi Divina";
assert.equal(
  previewRenderer(receiverName, [], "result"),
  "<ul><li>Nama penerima kuasa: Agustina Rosi Divina</li></ul>",
  "preview must leave proportional-font wrapping to CSS instead of injecting a character-count break"
);

const previewBlock = html.slice(
  html.indexOf("function splitPreviewRows"),
  html.indexOf("function escapeHtml")
);

assert.match(html, /const PREVIEW_MAX_LINES_PER_PAGE_ROW = 44;/);
assert.match(previewBlock, /splitPreviewCell\(row\.activity, row\.activityFormats, "activity"\)/);
assert.match(previewBlock, /splitPreviewCell\(row\.result, row\.resultFormats, "result"\)/);
assert.match(previewBlock, /splitPreviewCell\(row\.pic, row\.picFormats, "pic"\)/);
assert.match(previewBlock, /function previewLineRanges/);
assert.match(previewBlock, /wrapPreviewRanges\(text, start, end, previewWrapChars\[key\]/);
assert.match(previewBlock, /function splitLongPreviewLine/);
assert.match(previewBlock, /PREVIEW_MAX_LINES_PER_PAGE_ROW/);
assert.doesNotMatch(previewBlock, /const maxChars = 850/);
assert.doesNotMatch(previewBlock, /legacySplitPreviewCell/);
