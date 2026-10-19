// Chart/KPI elements: value resolution and formatting (src/charts/metrics.ts), the simulated history
// (src/lib/history.ts, demo + editor), the built-in presets vs the example layouts, normalisation.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { loadTs } from "./load-ts.mjs";

const m = await loadTs("charts/metrics.ts");
const h = await loadTs("lib/history.ts");
const p = await loadTs("charts/presets.ts");
const l = await loadTs("layout/layout.ts");
const catalog = JSON.parse(readFileSync(new URL("../../backend/chart_catalog.json", import.meta.url), "utf8"));

const NOW = new Date(2026, 9, 14, 12, 0).getTime(); // Wed 14 Oct 2026 12:00 local
const sample = h.sampleChartData(NOW);
const data = { metrics: { "plc1.OEE": 82, "plc2.X": 5 }, connected: { plc2: false }, histories: {}, details: sample.details, aggregates: sample.aggregates };

test("fixed decimals with Swedish comma, 6-digit counts grouped", () => {
  assert.equal(m.formatMetric("oee", 0.82), "82,0");
  assert.equal(m.formatMetric("scrap_pct", 2), "2,0");
  assert.equal(m.formatMetric("speed", 140), "140,0");
  assert.equal(m.formatMetric("good", 999999).replace(/\s/g, " "), "999 999");
  assert.equal(m.formatMetric("stop_time", 3900), "1 h 05 min");
  assert.equal(m.formatMetric("remaining", 4 * 3600 + 30 * 60), "4:30");
  assert.equal(m.formatMetric("oee", null), "–");
});

test("calculated values come from the backend payloads (shift = OEE details, periods = aggregates)", () => {
  assert.equal(m.calcMetric(data, "good"), sample.details.counts.good);
  assert.equal(m.calcMetric(data, "oee", "shift"), sample.details.oee.oee);
  assert.equal(m.calcMetric(data, "good", "today"), sample.aggregates.today.good);
  assert.equal(m.calcMetric(data, "oee", "7d"), sample.aggregates.sums["7"].oee.oee);
  assert.equal(m.calcMetric(data, "stop_time", "30d"), sample.aggregates.sums["30"].stop_s);
  assert.equal(m.calcMetric(data, "prognosis", "7d"), null); // shift only
  assert.equal(m.calcMetric({ ...data, details: null }, "oee"), null);
  assert.equal(m.calcMetric(data, "oee_target", "today"), 85);
});

test("tags: live value, '–' while the PLC is down", () => {
  assert.deepEqual(m.tagValue(data, "plc1.OEE"), { value: 82, down: false });
  assert.deepEqual(m.tagValue(data, "plc2.X"), { value: null, down: true });
  assert.deepEqual(m.tagValue(data, "plc1.Missing"), { value: null, down: false });
});

test("status: metric rules on the shown value, thresholds win, targets", () => {
  assert.equal(m.metricStatus("oee", 0.8496), "good"); // shown 85,0 vs goal 85
  assert.equal(m.metricStatus("oee", 0.82, { oeeGoal: 80 }), "good");
  assert.equal(m.metricStatus("availability", 0.85), "warn");
  assert.equal(m.metricStatus("scrap_pct", 3.5), "bad");
  assert.equal(m.metricStatus("good", 100, { target: 120 }), "warn");
  assert.equal(m.metricStatus("good", 100), null);
  assert.equal(m.metricStatus("oee", 0.7, { thresholds: [60, 70] }), "good");
  assert.equal(m.metricStatus(null, 4, { target: 5, better: "low" }), "good");
});

test("targets: fixed number, tag or calculated metric (in the shown unit)", () => {
  assert.equal(m.resolveTarget(data, { target: 85 }), 85);
  assert.equal(m.resolveTarget(data, { target: "plc1.OEE" }), 82);
  assert.equal(m.resolveTarget(data, { target_metric: "oee_target" }), 85);
  assert.equal(m.resolveTarget(data, { target_metric: "target", period: "today" }), sample.aggregates.today.target);
});

test("series: days (Idag last) and shifts (open shift current), whole hours shortened", () => {
  const days = m.seriesRows(sample.aggregates, "days", 7);
  assert.equal(days.length, 7);
  assert.equal(days[6].label, "Idag");
  assert.equal(days[6].current, true);
  assert.equal(days[0].label, "Tor"); // 8 Oct 2026
  assert.equal(days[0].sub, "8/10");
  const shifts = m.seriesRows(sample.aggregates, "shifts", 3);
  assert.equal(shifts.length, 3);
  assert.equal(shifts[2].current, true);
  assert.match(shifts[0].label, /^Skift [ABC]$/);
  assert.equal(m.shortSpan("2026-10-14T04:00:00.000Z", "2026-10-14T12:00:00.000Z").length, 5);
});

test("simulated history: 30 days, sums aggregated from the shift rows, night shift split at midnight", () => {
  const a = sample.aggregates;
  assert.equal(a.days.length, 30);
  assert.equal(a.days.at(-1).today, true);
  // Sunday 11 Oct: no production
  assert.equal(a.days.find((d) => d.date === "2026-10-11").has_data, false);
  // 7-day sum = sum of the 7 day rows' good counts (rounding per row aside)
  const sum7 = a.days.slice(-7).reduce((s, d) => s + (d.good ?? 0), 0);
  assert.ok(Math.abs(a.sums["7"].good - sum7) <= 7);
  assert.equal(a.sums["7"].days, a.days.slice(-7).filter((d) => d.has_data).length);
  assert.ok(a.sums["30"].oee.oee > 0.7 && a.sums["30"].oee.oee < 1);
  assert.equal(a.shifts.length, 14);
  assert.equal(a.current_shift.status, "open");
  // a 22-06 shift is one row in `shifts` but split 2/8 + 6/8 over the days
  const night = a.shifts.find((s) => new Date(s.start).getHours() === 22 && s.status === "closed");
  const d0 = new Date(night.start);
  const day = (dt) => a.days.find((d) => d.date === h.isoDate(dt));
  const before = day(d0);
  assert.ok(before.good >= Math.round(night.good * 0.25) - 1);
  assert.ok(a.segments.length > 1 && a.segments[0].running === true);
});

test("worst case: 6-digit counts, 100,0 %, 3-digit stops everywhere with data", () => {
  const w = h.worstAggregates(sample.aggregates);
  for (const d of w.days.filter((d) => d.has_data)) assert.equal(d.good, 999999);
  assert.equal(w.sums["7"].oee.oee, 1);
  assert.equal(w.current_shift.stop_count, 999);
  const wd = h.worstDetails(sample.details);
  assert.equal(wd.counts.good, 999999);
  assert.equal(wd.stops.running, false);
});

test("the built-in OEE and 7-day screens are the elements in docs/examples", () => {
  const items = (file) => Object.values(parse(readFileSync(new URL(`../../docs/examples/${file}`, import.meta.url), "utf8")).displays.tv1.screens)[0].items;
  const strip = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== "id"));
  assert.deepEqual(items("oee-element.yaml").map(strip), Object.values(p.OEE_SCREEN).map(strip));
  assert.deepEqual(items("7dagar-element.yaml").map(strip), [strip(p.WEEK_SCREEN)]);
});

test("catalogue: every kind has a name, min <= default, fields known to the normaliser", () => {
  for (const [kind, spec] of Object.entries(catalog.kinds)) {
    assert.ok(spec.name && spec.min[0] <= spec.default[0] && spec.min[1] <= spec.default[1], kind);
    assert.deepEqual(m.minSize(kind), spec.min);
  }
  assert.deepEqual(m.CHART_KINDS, Object.keys(catalog.kinds));
});

test("layout normalisation keeps the chart fields", () => {
  const view = {
    display: { id: "tv1", header: {} },
    screens: { 1: { items: [{ id: "k", kind: "kpi", x: 0, y: 0, w: 6, h: 4, label: "OEE", metric: "oee", period: "7d", thresholds: [75, 85] }] } },
  };
  const [item] = l.normaliseLayout(view).screens[0].items;
  assert.equal(item.type, "kpi");
  assert.deepEqual(item.chart, { id: "k", kind: "kpi", x: 0, y: 0, w: 6, h: 4, label: "OEE", metric: "oee", period: "7d", thresholds: [75, 85] });
});
