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

const getPdfMaxLinesPerRow = Function(
  "drawPdfPageHeaderHeight",
  "splitPdfRichText",
  `return (${extractFunction("getPdfMaxLinesPerRow")});`
)(() => 126, (_pdf, value) => Array(value === "long result" ? 32 : 1).fill([]));
const layout = {
  bottomLimit: 769.89,
  tableHeaderHeight: 24,
  dateHeight: 24,
  padY: 6,
  bodyLine: 13,
  columns: [28, 201, 182, 67],
  padX: 5
};
assert.equal(
  getPdfMaxLinesPerRow({}, layout, { activity: "activity", result: "long result", pic: "pic" }),
  17,
  "rows taller than half a page split into balanced continuations without a one-line orphan"
);

const maxLinesSeen = [];
const splitPdfRows = Function(
  "getPdfMaxLinesPerRow",
  "splitPdfRichChunks",
  `return (${extractFunction("splitPdfRows")});`
)(getPdfMaxLinesPerRow, (_pdf, _layout, value, formats, _width, maxLines) => {
  maxLinesSeen.push(maxLines);
  if (value === "long result") {
    return [
      { text: "first half", formats },
      { text: "second half", formats: [] }
    ];
  }
  return [{ text: value, formats }];
});

const rows = splitPdfRows({}, layout, [{ activity: "activity", result: "long result", pic: "pic" }]);
assert.equal(rows.length, 2);
assert.equal(rows[0].continued, false);
assert.equal(rows[1].continued, true);
assert.deepEqual(maxLinesSeen, [17, 17, 17]);

const getPdfRowNumber = Function(
  `return (${extractFunction("getPdfRowNumber")});`
)();
assert.equal(
  getPdfRowNumber({ originalIndex: 2, continued: true }, 0),
  3,
  "continuation chunks repeat the original activity number"
);

const compactPdfPageRows = Function(
  `return (${extractFunction("compactPdfPageRows")});`
)();
const compacted = compactPdfPageRows([
  {
    activity: "activity",
    activityFormats: [],
    result: "first half",
    resultFormats: [{ start: 0, end: 5, bold: true }],
    pic: "pic",
    picFormats: [],
    originalIndex: 0,
    continued: false
  },
  {
    activity: "",
    activityFormats: [],
    result: "second half",
    resultFormats: [{ start: 0, end: 6, italic: true }],
    pic: "",
    picFormats: [],
    originalIndex: 0,
    continued: true
  }
], [100, 110]);
assert.equal(compacted.rows.length, 1, "chunks of one activity on the same page render as one table row");
assert.equal(compacted.rows[0].result, "first half\nsecond half");
assert.deepEqual(compacted.rowHeights, [210]);
assert.deepEqual(compacted.rows[0].resultFormats, [
  { start: 0, end: 5, bold: true },
  { start: 11, end: 17, italic: true }
]);
assert.match(
  html,
  /const compactedPageRows = compactPdfPageRows\(pageRows, pageRowHeights\);/,
  "pagination must compact same-page chunks before rendering"
);
