// Unit tests for status/threshold logic (src/lib/status.ts): colours and PÅ/UNDER MÅL must
// follow the value as displayed (rounded). Same no-framework setup as test-format.mjs.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const src = readFileSync(new URL("../src/lib/status.ts", import.meta.url), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const s = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

test("OEE shown as 85,0 % is on target (rounded value, not 84,96)", () => {
  assert.equal(s.oeeStatus(0.8496), "good");
  assert.equal(s.oeeStatus(0.8494), "warn"); // shown 84,9 %
  assert.equal(s.oeeStatus(0.82), "warn");
  assert.equal(s.oeeStatus(0.7496), "warn"); // shown 75,0 %
  assert.equal(s.oeeStatus(0.7494), "bad");
  assert.equal(s.oeeStatus(null), null);
});

test("OEE goal from the PLC (OeeTarget), amber band 10 points below", () => {
  assert.equal(s.oeeStatus(0.82, 80), "good");
  assert.equal(s.oeeStatus(0.72, 80), "warn");
  assert.equal(s.oeeStatus(0.69, 80), "bad");
  assert.equal(s.DEFAULT_OEE_TARGET_PCT, 85);
});

test("A/P/Q and Kassation % use the displayed value", () => {
  assert.equal(s.factorStatus(0.89996), "good"); // 90,0 %
  assert.equal(s.factorStatus(0.89), "warn");
  assert.equal(s.factorStatus(0.7996), "warn"); // 80,0 %
  assert.equal(s.scrapStatus(2.04), "good"); // shown 2,0 %
  assert.equal(s.scrapStatus(2.06), "warn"); // shown 2,1 %
  assert.equal(s.scrapStatus(3.04), "warn");
  assert.equal(s.scrapStatus(3.06), "bad");
  assert.equal(s.scrapStatus(null), null);
});

test("grid thresholds compare the value rounded to its decimals", () => {
  assert.equal(s.thresholdStatus(84.96, [75, 85], "high", 1), "good");
  assert.equal(s.thresholdStatus(84.94, [75, 85], "high", 1), "warn");
  assert.equal(s.thresholdStatus(84.6, [75, 85], "high", 0), "good"); // shown 85
  assert.equal(s.thresholdStatus(2.04, [2, 3], "low", 1), "good");
  assert.equal(s.thresholdStatus(3.06, [2, 3], "low", 1), "bad");
  assert.equal(s.thresholdStatus(50, undefined, "high", 1), null);
});

test("Produktion PÅ MÅL needs a PLC target; no badge without one", () => {
  assert.equal(s.productionOnTarget(34440, 42000), false);
  assert.equal(s.productionOnTarget(36000, 35700), true);
  assert.equal(s.productionOnTarget(35700, 35700), true);
  assert.equal(s.productionOnTarget(34440, null), null);
  assert.equal(s.productionOnTarget(null, 35700), null);
});

test("shift length label for the shift pattern", () => {
  assert.equal(s.shiftHoursLabel(480), "8");
  assert.equal(s.shiftHoursLabel(510), "8,5");
  assert.equal(s.shiftHoursLabel(720), "12");
});
