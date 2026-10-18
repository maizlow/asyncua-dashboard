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

// ---------------------------------------------------------------- aggregation over shifts (src/lib/shifts.ts)
const ssrc = readFileSync(new URL("../src/lib/shifts.ts", import.meta.url), "utf8");
const sjs = ts.transpileModule(ssrc, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const s = await import(`data:text/javascript;base64,${Buffer.from(sjs).toString("base64")}`);
const H = 3600_000;
const D0 = Date.UTC(2026, 9, 15); // a "local midnight" for the test
const shift = (startH, hours, o = {}) => ({
  start: D0 + startH * H, end: D0 + (startH + hours) * H, closed: D0 + (startH + hours) * H, team: null,
  target: null, oeeTarget: null, plannedS: hours * 3600, plannedSource: "schedule", good: 0, reject: 0, total: 0,
  runS: hours * 3600, stopS: 0, stopCount: 0, ...o,
});

test("night shift split at midnight by time share (same as backend)", () => {
  const night = shift(22, 8, { good: 48000, total: 49000, target: 57000 });
  const d1 = s.aggregateShifts([night], D0 + 24 * H, D0 + 48 * H, D0 + 60 * H, 140);
  assert.equal(d1.good, 36000);
  assert.equal(d1.target, 42750);
  assert.equal(d1.planned_s, 6 * 3600);
});

test("day OEE recomputed from sums, goal weighted by planned time", () => {
  const a = shift(6, 8, { good: 50000, total: 51000, runS: 7 * 3600, oeeTarget: 85, team: "A", target: 54000 });
  const b = shift(14, 8, { good: 40000, total: 42000, runS: 6 * 3600, plannedS: 7 * 3600, plannedSource: "PlannedTime", oeeTarget: 80, team: "B", target: 46000 });
  const d = s.aggregateShifts([a, b], D0, D0 + 24 * H, D0 + 36 * H, 140);
  const planned = 15 * 3600;
  assert.ok(Math.abs(d.oee.oee - 90000 / ((planned / 60) * 140)) < 1e-12);
  assert.ok(Math.abs(d.oee.availability - 13 / 15) < 1e-12);
  assert.ok(Math.abs(d.oee_target - (85 * 8 + 80 * 7) / 15) < 1e-12);
  assert.deepEqual(d.teams, ["A", "B"]);
  assert.equal(d.target, 100000);
});

test("idle shift is unplanned unless PlannedTime; no shifts -> no data", () => {
  const idle = shift(6, 8, { runS: 0 });
  assert.equal(s.aggregateShifts([idle], D0, D0 + 24 * H, D0 + 30 * H, 140).planned_s, 0);
  assert.equal(s.aggregateShifts([{ ...idle, plannedSource: "PlannedTime" }], D0, D0 + 24 * H, D0 + 30 * H, 140).planned_s, 8 * 3600);
  assert.equal(s.aggregateShifts([], D0, D0 + 24 * H, D0 + 30 * H, 140).has_data, false);
});
