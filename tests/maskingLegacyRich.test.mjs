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

const rich = Function(`
  ${extractFunction("normalizeCellText")}
  ${extractFunction("sanitizeRichFormats")}
  ${extractFunction("readRichFormats")}
  ${extractFunction("writeRichFormats")}
  ${extractFunction("legacyRichPattern")}
  ${extractFunction("shouldSkipLegacyRichMigration")}
  ${extractFunction("legacyRichToPlainAndFormats")}
  ${extractFunction("readRichCell")}
  return { readRichCell, shouldSkipLegacyRichMigration, legacyRichToPlainAndFormats };
`)();

const masking = Function(`
  ${extractFunction("maskNameCore")}
  ${extractFunction("maskName")}
  ${extractFunction("maskDateAllDigits")}
  return { maskName, maskDateAllDigits };
`)();

function fakeTextarea(value, dataset = {}) {
  return { value, dataset: { ...dataset } };
}

// Reported bug: masking "BDS WEB PILOT" with the Nama masker must keep every asterisk.
const masked = masking.maskName("BDS WEB PILOT");
assert.equal(masked, "*DS *EB **LOT", "maskName must mask the first character of each word");

const migrated = rich.legacyRichToPlainAndFormats(masked);
assert.equal(migrated.text, masked, "masked asterisks must survive legacy rich text migration");
assert.deepEqual(migrated.formats, []);

// The same assertion for the full cell text produced by the Aktivitas table.
const cell = fakeTextarea("Verifikasi Nama Usaha: *DS *EB **LOT");
assert.equal(rich.readRichCell(cell).text, "Verifikasi Nama Usaha: *DS *EB **LOT");
assert.deepEqual(rich.readRichCell(cell).formats, []);

// A cell that was just masked is flagged literal before the next collect/autosave pass.
const maskedCell = fakeTextarea("BDS WEB PILOT BDS WEB PILOT");
maskedCell.value = masking.maskName("BDS WEB PILOT");
maskedCell.dataset.literalRich = "1";
const afterMask = rich.readRichCell(maskedCell);
assert.equal(afterMask.text, "*DS *EB **LOT", "masked value must not be rewritten by the legacy parser");
assert.equal(maskedCell.value, "*DS *EB **LOT", "masked textarea value must stay intact");

// Any masking output that still looks like markup (for example a masked date) is protected too.
const maskedDate = fakeTextarea(masking.maskDateAllDigits("12/03/1990"), { literalRich: "1" });
assert.equal(maskedDate.value, "**/**/****");
assert.equal(rich.readRichCell(maskedDate).text, "**/**/****");

// Rows restored from a draft or a collaboration update carry their formats list, so they are
// treated as literal text as well, while real legacy markup keeps migrating once.
const legacyDraft = fakeTextarea("**Alamat**");
const legacyResult = rich.readRichCell(legacyDraft);
assert.equal(legacyResult.text, "Alamat");
assert.equal(legacyDraft.value, "Alamat");
assert.deepEqual(legacyResult.formats, [{ start: 0, end: 6, bold: true, italic: false, underline: false }]);

const italic = rich.readRichCell(fakeTextarea("*catatan*"));
assert.equal(italic.text, "catatan");
assert.equal(italic.formats[0].italic, true);

const underline = rich.readRichCell(fakeTextarea("<u>teks</u>"));
assert.equal(underline.text, "teks");
assert.equal(underline.formats[0].underline, true);

// Multi-word legacy markup keeps working.
const multiWord = rich.readRichCell(fakeTextarea("**Nama Lengkap** dan *isi catatan*"));
assert.equal(multiWord.text, "Nama Lengkap dan isi catatan");
assert.deepEqual(
  multiWord.formats.map(({ start, end, bold, italic }) => ({ start, end, bold, italic })),
  [
    { start: 0, end: 12, bold: true, italic: false },
    { start: 17, end: 28, bold: false, italic: true }
  ]
);

// Escape hatches that predate this fix keep working.
assert.equal(rich.shouldSkipLegacyRichMigration(fakeTextarea("", { skipLegacyRichMigration: "1" }), "plain"), true);
assert.equal(rich.shouldSkipLegacyRichMigration(fakeTextarea(""), "***"), true);
assert.equal(rich.shouldSkipLegacyRichMigration(fakeTextarea("", { literalRich: "1" }), "**x**"), true);

console.log("maskingLegacyRich: masked asterisks survive while legacy markup still migrates");
