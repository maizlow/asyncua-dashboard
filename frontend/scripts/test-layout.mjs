// Layout document (src/layout/doc.ts) and its normalisation (src/layout/layout.ts): the TS migration
// of dashboard.yaml must give the same view as the backend (shared fixtures, also checked by
// backend/tests/test_layout_doc.py). Same setup as test-format.mjs.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { parse } from "yaml";

const load = async (rel) => {
  const src = readFileSync(new URL(rel, import.meta.url), "utf8").replace(/from "\.\/doc"/g, 'from "DOC"');
  return ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
};
const toUrl = (js) => `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`;
const docUrl = toUrl(await load("../src/layout/doc.ts"));
const d = await import(docUrl);
const l = await import(toUrl((await load("../src/layout/layout.ts")).replace('"DOC"', JSON.stringify(docUrl))));

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const yaml = (rel) => parse(read(rel));
const fixture = (name) => JSON.parse(read(`../src/layout/fixtures/${name}.view.json`));

test("grid placement: 1 item full size, else 2 columns", () => {
  assert.deepEqual(d.gridPlacement(1), [[0, 0, 24, 12]]);
  assert.deepEqual(d.gridPlacement(3), [[0, 0, 12, 6], [12, 0, 12, 6], [0, 6, 12, 6]]);
  assert.deepEqual(d.gridPlacement(6).at(-1), [12, 8, 12, 4]);
});

for (const [name, file] of [["dashboard", "../../dashboard.yaml"], ["stress", "../../docs/examples/stress.yaml"]])
  test(`dashboard.yaml v1 -> view identical to the backend (${name})`, () => {
    assert.deepEqual(d.displayViews(yaml(file)).tv1, fixture(name));
  });

test("v2 file: overlapping displays, qualified references, no node ids or URLs", () => {
  const views = d.displayViews(yaml("../../docs/examples/flera-displayer.yaml"));
  assert.deepEqual(Object.keys(views), ["tv1", "tv2"]);
  assert.deepEqual(views.tv2.display.header, { left: "none", right: "vendor" });
  assert.deepEqual(views.tv1.display.header, { left: "customer", right: "vendor" });
  // tv1 reads plc1, plc2, plc3; tv2 only plc2 and plc3
  assert.deepEqual(Object.keys(views.tv1.connections), ["plc1", "plc2", "plc3"]);
  assert.deepEqual(Object.keys(views.tv2.connections), ["plc2", "plc3"]);
  assert.deepEqual(views.tv1.screens["2"].items.map((w) => w.tag), ["plc1.ProductionCount", "plc1.OEE", "plc2.GlazeLevel", "plc3.PackCount"]);
  assert.equal(views.tv1.screens["2"].items[0].target, "plc1.TargetCount");
  assert.ok(!Object.keys(views.tv2.tags).some((k) => k.startsWith("plc1.")));
  assert.equal(views.tv2.screens["2"].items[0].connection, "plc3");
  const json = JSON.stringify(views);
  assert.ok(!json.includes("ns=3") && !json.includes("opc.tcp"), json);
});

test("normaliseLayout: screen type from its items, positions kept", () => {
  const layout = l.normaliseLayout(fixture("dashboard"));
  assert.deepEqual(layout.screens.map((s) => [s.nr, s.type]), [[1, "alarms"], [2, "grid"], [3, "shift"], [4, "oee"], [5, "week"], [6, "highscore"]]);
  const first = layout.screens[1].items[0];
  assert.equal(first.type, "counter");
  assert.deepEqual([first.x, first.y, first.w, first.h], [0, 0, 12, 4]);
  assert.equal(first.tag, "plc1.ProductionCount");
  assert.equal(layout.screens[5].connection, "plc1");
  assert.equal(layout.display.id, "tv1");
  assert.deepEqual(l.demoScreenOrder(layout), [2, 4, 5, 6, 3, 1]);
});

// ---------------------------------------------------------------- one PLC down (src/lib/connection.ts)
const c = await import(toUrl((await load("../src/lib/connection.ts"))));

test("one PLC down: only its elements lose their value, the others keep updating", () => {
  const metrics = { "plc2.GlazeLevel": 41.5, "plc3.PackCount": 1200, "plc1.OEE": 82 };
  const connected = { plc1: true, plc2: false };
  assert.deepEqual(c.bound(metrics, connected, "plc2.GlazeLevel"), { value: undefined, down: true });
  assert.deepEqual(c.bound(metrics, connected, "plc3.PackCount"), { value: 1200, down: false }); // status unknown = up
  assert.deepEqual(c.bound(metrics, connected, "plc1.OEE"), { value: 82, down: false });
  assert.equal(c.qualifiedKey("plc1", "OEE"), "plc1.OEE");
  assert.equal(c.qualifiedKey(undefined, "plc2.X"), "plc2.X");
  assert.equal(c.connectionOf("plc3.PackCount"), "plc3");
});
