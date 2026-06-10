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
      if (depth === 0) return Function(`return (${html.slice(start, index + 1)});`)();
    }
  }
  throw new Error(`Unable to extract ${name}`);
}

const buildPdfPaginationPlan = extractFunction("buildPdfPaginationPlan");
const layout = {
  top: 69,
  tableHeaderHeight: 24,
  dateHeight: 24,
  bodyLine: 13,
  bottomLimit: 720
};
const groups = [
  {
    dateText: "Kamis, 21 Mei 2026",
    rows: [{ originalIndex: 0 }],
    rowHeights: [450]
  },
  {
    dateText: "Jumat, 5 Juni 2026",
    rows: [{ originalIndex: 0 }],
    rowHeights: [40]
  }
];

const plan = buildPdfPaginationPlan(groups, layout, 184, 77);
assert.equal(plan.length, 2);
assert.deepEqual(plan[0].segments.map((segment) => segment.dateText), ["Kamis, 21 Mei 2026"]);
assert.deepEqual(plan[1].segments.map((segment) => segment.dateText), ["Jumat, 5 Juni 2026"]);
assert.equal(plan[1].segments[0].rows.length, 1);
assert.equal(plan[1].closing, "full");

const previewBlock = html.slice(
  html.indexOf("function renderPreview"),
  html.indexOf("function splitPreviewRows")
);
const pdfBlock = html.slice(
  html.indexOf("function buildSelectablePdf"),
  html.indexOf("function setPdfBaseStyle")
);
assert.match(previewBlock, /buildPdfPaginationPlan\(/);
assert.match(pdfBlock, /buildPdfPaginationPlan\(/);
