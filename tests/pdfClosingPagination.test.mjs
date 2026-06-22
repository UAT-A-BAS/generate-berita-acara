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
    if (html[index] === "{") {
      depth += 1;
    } else if (html[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return Function(`return (${html.slice(start, index + 1)});`)();
      }
    }
  }

  throw new Error(`Unable to extract ${name}`);
}

const getPdfClosingHeight = extractFunction("getPdfClosingHeight");
const shouldStartFinalPdfRowOnNewPage = extractFunction("shouldStartFinalPdfRowOnNewPage");
globalThis.compactPdfPageRows = extractFunction("compactPdfPageRows");
const buildPdfPaginationPlan = extractFunction("buildPdfPaginationPlan");

const layout = { bodyLine: 13 };
assert.equal(
  getPdfClosingHeight({ makers: [{ name: "A", role: "Maker" }] }, layout),
  184
);
assert.equal(
  getPdfClosingHeight({
    makers: [
      { name: "A", role: "Maker" },
      { name: "B", role: "Maker" },
      { name: "C", role: "Maker" }
    ]
  }, layout),
  214
);

const common = {
  finalRow: true,
  queuedHeight: 0,
  rowHeight: 40,
  closingGap: 13,
  closingHeight: 184,
  bottomLimit: 720,
  freshY: 174
};

assert.equal(
  shouldStartFinalPdfRowOnNewPage({ ...common, currentY: 500 }),
  true,
  "final activity row moves when the closing block does not fit"
);
assert.equal(
  shouldStartFinalPdfRowOnNewPage({ ...common, currentY: 450 }),
  false,
  "final activity row stays when the closing block fits"
);
assert.equal(
  shouldStartFinalPdfRowOnNewPage({ ...common, finalRow: false, currentY: 500 }),
  false,
  "non-final rows do not reserve closing space"
);
assert.equal(
  shouldStartFinalPdfRowOnNewPage({
    ...common,
    currentY: 500,
    freshY: 500
  }),
  false,
  "extreme closing blocks fall back instead of repeatedly adding pages"
);

assert.match(html, /const closingGap = layout\.bodyLine;/);
assert.match(html, /drawPdfClosing\(pdf, data, layout, page\.closingY\)/);

const paginationLayout = {
  top: 69,
  pageHeaderBottom: 142.2,
  tableHeaderHeight: 24,
  dateHeight: 24,
  bodyLine: 13,
  bottomLimit: 720
};
const closingPlan = buildPdfPaginationPlan([
  {
    dateText: "Senin, 22 Juni 2026",
    rows: [{ originalIndex: 0 }],
    rowHeights: [450]
  }
], paginationLayout, 214, 77);
assert.equal(closingPlan.length, 2);
assert.equal(closingPlan[0].closing, "", "closing lead must not be left behind without signatures");
assert.equal(closingPlan[1].closing, "full", "the complete closing block moves together to the next page");
assert.equal(
  closingPlan.some((page) => page.closing === "lead" || page.closing === "signature"),
  false,
  "closing content is never split across pages"
);
