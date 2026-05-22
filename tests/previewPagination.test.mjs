import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
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
