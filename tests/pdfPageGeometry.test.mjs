import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

function numberFrom(source, pattern, label) {
  const match = source.match(pattern);
  assert.ok(match, `${label} must be present in index.html`);
  return Number(match[1]);
}

const docStyle = html.slice(html.indexOf("const DOC_STYLE = {"), html.indexOf("const roleOptions"));
const bodySizePt = numberFrom(docStyle, /bodySizePt:\s*([\d.]+)/, "DOC_STYLE.bodySizePt");
const bodyLinePt = numberFrom(docStyle, /bodyLinePt:\s*([\d.]+)/, "DOC_STYLE.bodyLinePt");

const layoutSource = html.slice(
  html.indexOf("function createPdfLayout(pdf"),
  html.indexOf("function setPdfPageHeaderMetrics")
);
const layout = {
  left: numberFrom(layoutSource, /left:\s*([\d.]+)/, "layout.left"),
  right: numberFrom(layoutSource, /right:\s*([\d.]+)/, "layout.right"),
  top: numberFrom(layoutSource, /top:\s*([\d.]+)/, "layout.top"),
  tableHeaderHeight: numberFrom(layoutSource, /tableHeaderHeight:\s*([\d.]+)/, "layout.tableHeaderHeight"),
  dateHeight: numberFrom(layoutSource, /dateHeight:\s*([\d.]+)/, "layout.dateHeight"),
  padX: numberFrom(layoutSource, /padX:\s*([\d.]+)/, "layout.padX"),
  padY: numberFrom(layoutSource, /padY:\s*([\d.]+)/, "layout.padY")
};

assert.equal(bodySizePt, 10.5);
assert.equal(bodyLinePt, 13);

const cssBlock = (selector) => {
  const start = html.indexOf(`\n    ${selector} {`);
  assert.notEqual(start, -1, `${selector} rule must exist`);
  const end = html.indexOf("}", start);
  return html.slice(start, end);
};

// The preview page must be the same A4 sheet the PDF writes into.
const paper = cssBlock(".paper");
assert.match(paper, /width:\s*595\.28pt/);
assert.match(paper, /height:\s*841\.89pt/);
assert.match(paper, new RegExp(`padding:\\s*${layout.top}pt ${layout.right}pt [\\d.]+pt ${layout.left}pt`));

// Row heights and padding must reproduce the PDF cell metrics instead of the old 5px/6px browser defaults.
const table = cssBlock(".doc-table");
assert.match(table, new RegExp(`line-height:\\s*${bodyLinePt}pt`));
const cells = cssBlock(".doc-table th,\n    .doc-table td");
const cellPadding = cells.match(/padding:\s*([\d.]+)pt ([\d.]+)pt ([\d.]+)pt/);
assert.ok(cellPadding, "table cells must use point padding");
assert.equal(Number(cellPadding[2]), layout.padX, "cell padding must use the PDF padX");
assert.equal(
  Number(cellPadding[1]) + Number(cellPadding[3]) + bodySizePt,
  2 * layout.padY + bodySizePt - bodyLinePt + bodySizePt,
  "cell padding must keep the PDF top+bottom padding budget"
);
assert.match(cssBlock(".doc-table thead tr"), new RegExp(`height:\\s*${layout.tableHeaderHeight}pt`));
assert.match(cssBlock(".doc-table tbody tr"), /height:\s*28pt/);
assert.match(cssBlock(".doc-table tbody tr.date-row"), new RegExp(`height:\\s*${layout.dateHeight}pt`));
assert.match(cssBlock(".doc-table .date-row td"), new RegExp(`padding-left:\\s*${layout.padX}pt`));

// The preview header must reserve exactly the PDF pageHeaderBottom offset.
const header = cssBlock(".doc-header");
const headerHeight = Number(header.match(/height:\s*([\d.]+)pt/)[1]);
assert.match(header, /margin-bottom:\s*0/);
assert.match(html, /pageHeaderBottom - pdfLayout\.top/);
assert.equal(headerHeight, 57, "two-line PDF header uses layout.top + 57");

// Closing block and footer must use the PDF line step of 15pt and the same baseline offsets.
assert.match(cssBlock(".doc-body"), new RegExp(`line-height:\\s*15pt`));
assert.match(cssBlock(".doc-body:first-child"), /margin-top:\s*13\.3pt/);
assert.match(cssBlock(".doc-body \+ .doc-body"), /margin-top:\s*19pt/);
assert.match(cssBlock(".signature"), /margin-top:\s*29pt/);
assert.match(cssBlock(".signature .role"), /margin-top:\s*18pt/);
assert.match(cssBlock(".signature .role:first-child"), /margin-top:\s*0/);
const footer = cssBlock(".doc-footer");
assert.match(footer, new RegExp(`right:\\s*${layout.right}pt`));
assert.match(footer, /bottom:\s*33\.73pt/);

// The JS drawing code must keep producing those same numbers.
const closing = html.slice(html.indexOf("function drawPdfClosingLead"), html.indexOf("function drawPdfFooters"));
assert.match(closing, /y \+= 34;/);
assert.match(closing, /y \+= 15;\n\s*pdf\.text\(data\.applicationLine/, "closing lines step by 15pt");
assert.match(closing, /y \+= 15;\n\s*pdf\.setFont\(layout\.fontFamily, "normal"\);\n\s*pdf\.text\(`\$\{data\.city\}/, "city line steps by 15pt");
const signature = html.slice(html.indexOf("function drawPdfSignature"), html.indexOf("function drawPdfFooters"));
assert.match(signature, /pdf\.text\("Pembuat :", layout\.left, y\);\n\s*y \+= 15;/, "Pembuat line steps by 15pt");
assert.match(signature, /pdf\.text\(formatPersonText\(maker\), layout\.left, y\);\n\s*y \+= 15;/, "maker lines step by 15pt");
assert.match(signature, /y \+= 18;/, "Menyetujui keeps its extra 18pt lead");
assert.match(html, /drawPdfSignature\(pdf, data, layout, y \+ 44\)/, "Pembuat block starts 44pt after the city line");
assert.match(html, /pdf\.text\(`Halaman \$\{page\}\/\$\{total\}`[\s\S]*?layout\.footerY/);

console.log("pdfPageGeometry: ok");
