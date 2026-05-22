import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../src/piiMasking.js", import.meta.url), "utf8");
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: "src/piiMasking.js" });

const { maskName } = sandbox.PiiMasking;

const cases = [
  ["li", "*i"],
  ["aan", "*an"],
  ["andi", "**di"],
  ["cindy", "**ndy"],
  ["andrea", "***rea"],
  ["abimana", "****ana"],
  ["margaretha", "marg****ha"],
  ["alex surya marcelo", "**ex **rya ****elo"],
  ["margaretha cindy", "marg****ha **ndy"],
  ["Dr. Ir. Prof. Floretta Maria", "*r. *r. **of. Flor***ta **ria"]
];

for (const [input, expected] of cases) {
  assert.equal(maskName(input), expected, input);
}

assert.equal(maskName(null), "");
assert.equal(maskName(undefined), "");
assert.equal(maskName(""), "");
assert.equal(maskName("margaretha   cindy"), "marg****ha   **ndy");
