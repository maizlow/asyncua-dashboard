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

// ---------------------------------------------------------------- highscore helpers (src/lib/highscore.ts)
const hsrc = readFileSync(new URL("../src/lib/highscore.ts", import.meta.url), "utf8").replace(/^import type .*$/m, "");
const hjs = ts.transpileModule(hsrc, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const hs = await import(`data:text/javascript;base64,${Buffer.from(hjs).toString("base64")}`);

test("highscore durations hh:mm:ss, also over 99 h", () => {
  assert.equal(hs.fmtDuration(18753), "05:12:33");
  assert.equal(hs.fmtDuration(999999), "277:46:39");
  assert.equal(hs.fmtDuration(59.9), "00:00:59");
  assert.equal(hs.fmtDuration(null), "–");
});

test("highscore stamp: d/m hh:mm, year only when not this year", () => {
  const now = new Date(2026, 9, 18, 12);
  assert.equal(hs.fmtStamp(new Date(2026, 9, 14, 6, 5).toISOString(), now), "14/10 06:05");
  assert.equal(hs.fmtStamp(new Date(2025, 11, 31, 22, 0).toISOString(), now), "31/12/25 22:00");
  assert.equal(hs.fmtStamp(null, now), "–");
});

test("highscore rows: ongoing run joins the list when long enough, ties earlier first, padded", () => {
  const rec = (d, start, cs = false) => ({ start, end: start, duration_s: d, team: "A", current_shift: cs });
  const data = {
    records: [rec(500, "2026-10-01T00:00:00Z"), rec(300, "2026-10-02T00:00:00Z"), rec(300, "2026-10-01T05:00:00Z")],
    current: { start: "2026-10-18T10:00:00Z", duration_s: 400, team: "B", running: true, current_shift: true },
    shift_start: null, min_stop_s: 0, updated: "",
  };
  const rows = hs.highscoreRows(data, 400, 5);
  assert.deepEqual(rows.map((r) => [r.rank, r.duration_s, r.live]), [[1, 500, false], [2, 400, true], [3, 300, false], [4, 300, false], [5, null, false]]);
  assert.equal(rows[2].start, "2026-10-01T05:00:00Z");
  assert.equal(hs.highscoreRows(data, 100, 3).some((r) => r.live), false);
  assert.deepEqual(hs.versusRecord(400, 500), { newRecord: false, left_s: 100 });
  assert.deepEqual(hs.versusRecord(501, 500), { newRecord: true, left_s: 0 });
});
