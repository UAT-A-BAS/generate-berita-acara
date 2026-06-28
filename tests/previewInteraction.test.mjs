import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

assert.match(html, /layout\.pageHeaderEntries/);
assert.match(html, /pdf\.splitTextToSize\(buildHeaderLineOne\(data\), layout\.contentWidth\)/);
assert.match(html, /data-preview-target-id/);
assert.match(html, /data-preview-group-index/);
assert.match(html, /function resolvePreviewLinkedInput/);
assert.match(html, /function focusInputFromPreview/);
assert.match(html, /scrollIntoView\(\{ behavior, block: "center", inline: "nearest" \}\)/);
assert.match(html, /preview-input-hit/);
assert.match(html, /const closingGap = layout\.bodyLine \* 2/);
assert.match(html, /\.preview-wrap[\s\S]*height:\s*calc\(100vh - 36px\)/);
assert.match(html, /\.preview-wrap > \.panel-body[\s\S]*overflow-y:\s*auto/);

assert.match(html, /commentRenderSignature/);
assert.match(html, /if \(appState\.commentRenderSignature === renderSignature\) return/);
assert.match(html, /maskTypeShowAll/);
assert.match(html, /matchingMaskingTypes\(showAll = appState\.maskTypeShowAll\)/);
assert.match(html, /appState\.maskTypeShowAll = true/);

const outputSection = html.slice(
  html.indexOf('<section class="section" aria-labelledby="output-section">'),
  html.indexOf('<button class="splitter"')
);
assert.equal(outputSection, "", "the old non-floating PDF output section is removed");
assert.match(html, /floating-tools-right[\s\S]*id="generateBtn"[\s\S]*id="floatingCommentBtn"/);
assert.match(html, /#commentModeBtn\.is-active/);

