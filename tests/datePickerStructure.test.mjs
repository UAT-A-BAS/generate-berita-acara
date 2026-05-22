import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

assert.match(html, /\.date-field-wrapper\s*{[\s\S]*?position:\s*relative;/);
assert.match(html, /\.date-range-picker\s*{[\s\S]*?position:\s*absolute !important;/);
assert.match(html, /\.date-range-picker\s*{[\s\S]*?top:\s*calc\(100% \+ 6px\);/);
assert.match(html, /\.date-range-picker\s*{[\s\S]*?left:\s*0;/);
assert.match(html, /\.date-range-picker\s*{[\s\S]*?z-index:\s*9999;/);
assert.match(html, /function attachDatePicker\(input\)/);
assert.match(html, /host\.appendChild\(els\.datePicker\)/);
assert.match(html, /function hasClippedOverflow\(element\)/);
assert.doesNotMatch(html, /document\.body\.appendChild\(els\.datePicker\)/);
assert.doesNotMatch(html, /function positionDatePicker/);
assert.doesNotMatch(html, /addEventListener\("scroll"[\s\S]*datePicker/);

const datePickerBlock = html.slice(
  html.indexOf("function findDatePickerHost"),
  html.indexOf("function renderDatePicker")
);

assert.doesNotMatch(datePickerBlock, /getBoundingClientRect/);
assert.doesNotMatch(datePickerBlock, /els\.datePicker\.style\.(left|top|position|visibility)/);
assert.doesNotMatch(datePickerBlock, /is-sticky/);

const wrapperCount = (html.match(/class="[^"]*date-field-wrapper/g) || []).length;
assert.equal(wrapperCount, 3);

const pickerCount = (html.match(/id="datePicker"/g) || []).length;
assert.equal(pickerCount, 1);
