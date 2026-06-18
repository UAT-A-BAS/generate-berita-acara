import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../src/piiMasking.js", import.meta.url), "utf8");
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: "src/piiMasking.js" });

const { inferMaskType, maskByType, maskName } = sandbox.PiiMasking;

const cases = [
  ["li", "*i"],
  ["aan", "*an"],
  ["andi", "**di"],
  ["cindy", "**ndy"],
  ["andrea", "***rea"],
  ["abimana", "****ana"],
  ["Agustina rosi divina", "Agus**na **si ***ina"],
  ["margaretha", "marg****ha"],
  ["alex surya marcelo", "**ex **rya ****elo"],
  ["margaretha cindy", "marg****ha **ndy"],
  ["Dr. Ir. Prof. Floretta Maria", "*r. *r. **of. Flor**ta **ria"]
];

for (const [input, expected] of cases) {
  const masked = maskName(input);
  assert.equal(masked, expected, input);
  assert.equal(Array.from(masked).length, Array.from(input).length, `length: ${input}`);
}

assert.equal(maskName(null), "");
assert.equal(maskName(undefined), "");
assert.equal(maskName(""), "");
assert.equal(maskName("margaretha   cindy"), "marg****ha   **ndy");

const ruleCases = [
  ["name", "margaretha cindy", "marg****ha **ndy"],
  ["titledName", "Dr. Ir. Prof. Floretta Maria", "*r. *r. **of. Flor**ta **ria"],
  ["date", "01-12-2023", "**-**-****"],
  ["identityNumber", "3313091704330000", "3313**********00"],
  ["passport", "X 7895521", "* ****521"],
  ["phone", "081210001294", "0812******94"],
  ["phone", "+6281210001294", "+628121*****94"],
  ["address", "Jl. Gading Kirana Barat 1 Blok E8 No. 29", "Jl. Gading Kirana Barat * Blok E* No. **"],
  ["email", "joa@yahoo.com", "*oa@yahoo.com"],
  ["email", "margaretha_gammadita@bca.co.id", "marg**************ta@bca.co.id"],
  ["npwpNitku", "3313091704330000890098", "3313****************98"],
  ["fatcaCrs", "XA123456789", "********789"],
  ["all", "532", "***"],
  ["riskCategory", "002", "***"],
  ["bcaUserId", "JOAQUI", "JO***I"],
  ["bcaUserId", "JOAQUIN", "JOA**IN"],
  ["bcaUserId", "JOAQUINMIRACL", "JOAQ*******CL"],
  ["balance", "Rp. 60,000,123.52", "Rp. **,***,123.52"],
  ["accountNumber", "1234", "1**4"],
  ["accountNumber", "6043237584", "6043****84"],
  ["accountNumber", "60432375843", "6043*****43"],
  ["cardNumber", "5289 1900 0155 6972", "5289 **** **** **72"],
  ["cardNumber", "5289 1900 0155 6972", "5289 19** **** 6972 (PCI DSS)", { cardPolicy: "pciDss" }],
  ["cardNumber", "5289 1900 0155 6972", "**** **** **** 6972 (Visa)", { cardPolicy: "visa" }],
  ["cardExpiry", "09/20", "**/**"],
  ["cvv", "532", "***"],
  ["customerNumber", "0000 0000 0000 1234", "0000 0000 0000 1**4"],
  ["customerNumber", "0000 0000 1234 5678", "0000 0000 12** **78"],
  ["serialNumber", "1234567890", "*******890"]
];

for (const [type, input, expected, options] of ruleCases) {
  assert.equal(maskByType(type, input, options), expected, `${type}: ${input}`);
}

const inferenceCases = [
  ["joa@yahoo.com", "email"],
  ["01-12-2023", "date"],
  ["09/20", "cardExpiry"],
  ["5289 1900 0155 6972", "cardNumber"],
  ["081210001294", "phone"],
  ["Rp. 60,000,123.52", "balance"],
  ["532", "cvv"],
  ["margaretha cindy", "name"],
  ["Dr. Ir. Prof. Floretta Maria", "titledName"],
  ["Jl. Gading Kirana Barat 1 Blok E8 No. 29", "address"]
];

for (const [input, expected] of inferenceCases) {
  assert.equal(inferMaskType(input).type, expected, `infer: ${input}`);
}
