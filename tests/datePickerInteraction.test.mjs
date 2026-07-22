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

const helpers = Function(`
  ${extractFunction("parseDate")}
  ${extractFunction("formatDateInput")}
  ${extractFunction("dateToInput")}
  ${extractFunction("sameDate")}
  ${extractFunction("compareDates")}
  ${extractFunction("normalizeDateList")}
  ${extractFunction("datesBetween")}
  ${extractFunction("toggleDateSelection")}
  ${extractFunction("addDateRangeSelection")}
  return { toggleDateSelection, addDateRangeSelection };
`)();

const thirdToSeventh = ["03/07/2026", "04/07/2026", "05/07/2026", "06/07/2026", "07/07/2026"];

assert.deepEqual(helpers.addDateRangeSelection([], "03/07/2026", "07/07/2026"), thirdToSeventh);
assert.deepEqual(helpers.addDateRangeSelection([], "07/07/2026", "03/07/2026"), thirdToSeventh);
assert.deepEqual(
  helpers.toggleDateSelection(thirdToSeventh, "10/07/2026"),
  [...thirdToSeventh, "10/07/2026"]
);
assert.deepEqual(
  helpers.addDateRangeSelection(["01/07/2026"], "03/07/2026", "05/07/2026"),
  ["01/07/2026", "03/07/2026", "04/07/2026", "05/07/2026"]
);
assert.deepEqual(
  helpers.toggleDateSelection(thirdToSeventh, "05/07/2026"),
  ["03/07/2026", "04/07/2026", "06/07/2026", "07/07/2026"]
);
assert.deepEqual(
  helpers.addDateRangeSelection(["07/07/2026", "03/07/2026"], "03/07/2026", "05/07/2026"),
  ["03/07/2026", "04/07/2026", "05/07/2026", "07/07/2026"],
  "range merge removes duplicates and sorts chronologically"
);

assert.match(html, /Klik satu tanggal &middot; tahan dan geser untuk rentang/);
assert.match(html, /Geser ke tanggal akhir untuk membuat rentang/);
assert.match(html, /Lepas untuk menambahkan \$\{formatMultiDateRange\(previewDates\)\}/);
assert.match(html, /setPointerCapture\?\.\(event\.pointerId\)/);
assert.match(html, /document\.addEventListener\("pointercancel", handleDatePickerPointerCancel\)/);
assert.doesNotMatch(extractFunction("handleDatePickerPointerCancel"), /writeDateList/);
assert.match(html, /aria-pressed="\$\{selected\}"/);
assert.match(html, /datePickerState\.suppressDayClick/);
assert.match(html, /width:\s*min\(340px, calc\(100vw - 24px\)\)/);
assert.match(html, /window\.addEventListener\("resize", repositionOpenDatePicker\)/);
