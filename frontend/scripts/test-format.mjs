// Unit tests for the number formatters (src/lib/format.ts). No test framework needed:
// the module is transpiled with the TypeScript compiler and run with node:test.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const src = readFileSync(new URL("../src/lib/format.ts", import.meta.url), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const f = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

// sv-SE Intl output uses U+00A0 / U+2212; compare with plain spaces/minus
const plain = (s) => s.replace(/[\u00a0\u202f]/g, " ").replace(/\u2212/g, "-");

test("fmtFixed: always the fixed number of decimals, Swedish comma", () => {
  assert.equal(f.fmtFixed(82, 1), "82,0");
  assert.equal(f.fmtFixed(3, 1), "3,0");
  assert.equal(f.fmtFixed(140, 1), "140,0");
  assert.equal(f.fmtFixed(81.46, 1), "81,5");
  assert.equal(f.fmtFixed(0.5, 2), "0,50");
  assert.equal(f.fmtFixed(-99999.94, 1), "-99999,9");
  assert.equal(f.fmtFixed(999999, 0), "999999");
  assert.equal(f.fmtFixed(41531.4, 0), "41531");
});

test("fmtFixed: no '-0,0', dash for missing values", () => {
  assert.equal(f.fmtFixed(-0.04, 1), "0,0");
  assert.equal(f.fmtFixed(-0, 0), "0");
  assert.equal(f.fmtFixed(null, 1), f.DASH);
  assert.equal(f.fmtFixed(undefined, 1), f.DASH);
  assert.equal(f.fmtFixed(NaN, 1), f.DASH);
});

test("itemDecimals: YAML decimals win, percent 1, counter 0, number sticky", () => {
  assert.equal(f.itemDecimals("percent", undefined, false), 1);
  assert.equal(f.itemDecimals("percent", 2, false), 2);
  assert.equal(f.itemDecimals("number", 1, false), 1);
  assert.equal(f.itemDecimals("number", 0, true), 0);
  assert.equal(f.itemDecimals("number", undefined, false), 0); // integer tag stays integer
  assert.equal(f.itemDecimals("number", undefined, true), 1); // once a decimal, always a decimal
  assert.equal(f.itemDecimals("counter", 2, true), 0);
});

test("OEE screen formatters keep the decimal comma for whole numbers", () => {
  assert.equal(plain(f.fmtPct(0.82)), "82,0"); // OEE / A / P / Q
  assert.equal(plain(f.fmtPct(1)), "100,0");
  assert.equal(plain(f.fmtDec1(3)), "3,0"); // Kassation %
  assert.equal(plain(f.fmtDec1(140)), "140,0"); // Takt
  assert.equal(plain(f.fmtInt(41531)), "41 531"); // counts stay integers
  assert.equal(f.fmtPct(null), f.DASH);
});
