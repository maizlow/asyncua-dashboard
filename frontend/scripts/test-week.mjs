// Unit tests for the 7-day screen helpers (src/lib/week.ts). Same setup as test-format.mjs.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const src = readFileSync(new URL("../src/lib/week.ts", import.meta.url), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const w = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

test("day labels: sv-SE weekday + day/month, today = Idag, independent of the browser zone", () => {
  assert.deepEqual(w.dayLabel("2026-10-12", false), { weekday: "Mån", date: "12/10" });
  assert.deepEqual(w.dayLabel("2026-10-17", false), { weekday: "Lör", date: "17/10" });
  assert.deepEqual(w.dayLabel("2026-10-18", true), { weekday: "Idag", date: "18/10" });
  assert.deepEqual(w.dayLabel("2026-10-25", false), { weekday: "Sön", date: "25/10" }); // DST day
  assert.deepEqual(w.dayLabel("2027-01-01", false), { weekday: "Fre", date: "1/1" });
});

test("bar colour vs day target (rounded like the display), neutral without target", () => {
  assert.equal(w.barStatus(71500, 71400), "good");
  assert.equal(w.barStatus(71399.6, 71400), "good");
  assert.equal(w.barStatus(70591, 71400), "warn");
  assert.equal(w.barStatus(70591, null), null);
  assert.equal(w.barStatus(null, 71400), null);
  assert.equal(w.barStatus(5, 0), null);
});

test("common bar scale and heights", () => {
  const days = [{ good: 70000, target: 71400 }, { good: 75000, target: 71400 }, { good: null, target: null }];
  assert.equal(w.barScale(days), 75000);
  assert.equal(w.barScale([{ good: null, target: null }]), 1);
  assert.equal(w.barPct(37500, 75000), 50);
  assert.equal(w.barPct(90000, 75000), 100);
  assert.equal(w.barPct(null, 75000), 0);
});
