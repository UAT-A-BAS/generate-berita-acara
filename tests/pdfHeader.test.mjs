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

const buildHeaderLineOne = Function(
  "toUpper",
  `return (${extractFunction("buildHeaderLineOne")});`
)((value) => String(value || "").toUpperCase());

assert.equal(
  buildHeaderLineOne({ baType: "pilot", featureName: "Pilot Implementasi BDS Web" }),
  "BERITA ACARA VERIFIKASI PILOT IMPLEMENTASI BDS WEB",
  "the generated title must not duplicate a prefix already present in the project name"
);

const setPdfPageHeaderMetrics = Function(
  "buildHeaderLineOne",
  "buildHeaderLineTwo",
  `return (${extractFunction("setPdfPageHeaderMetrics")});`
)(() => "LONG TITLE", () => "DATE LINE");
const drawPdfPageHeader = Function(
  "setPdfPageHeaderMetrics",
  `return (${extractFunction("drawPdfPageHeader")});`
)(setPdfPageHeaderMetrics);
const textCalls = [];
const pdf = {
  setFont() {},
  setFontSize() {},
  splitTextToSize(text) {
    return text === "LONG TITLE" ? ["LONG", "TITLE"] : [text];
  },
  text(text, x, y, options) {
    textCalls.push({ text, x, y, options });
  }
};
const layout = {
  fontFamily: "helvetica",
  headerSize: 13.5,
  headerLine: 16.2,
  contentWidth: 480.28,
  pageWidth: 595.28,
  top: 69
};
const headerBottom = drawPdfPageHeader(pdf, {}, layout);
assert.deepEqual(textCalls.map((call) => call.text), ["LONG", "TITLE", "DATE LINE"]);
assert.equal(headerBottom, 142.2, "table starts lower when the title wraps to an extra line");

const drawPdfPageHeaderHeight = Function(`return (${extractFunction("drawPdfPageHeaderHeight")});`)();
assert.equal(
  drawPdfPageHeaderHeight({ top: 69, pageHeaderBottom: 142.2 }),
  142.2,
  "pagination must reserve the same dynamic header height used by the PDF renderer"
);
