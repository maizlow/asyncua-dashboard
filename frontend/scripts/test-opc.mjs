// OPC UA browsing in the editor (src/editor/opc): data type vs element type, tag name suggestions
// and the demo build's fake S7-1500 address space (same shapes and caps as /api/editor/opcua).
// Same setup as test-format.mjs.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const load = (rel) =>
  ts.transpileModule(readFileSync(new URL(rel, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const toUrl = (js) => `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`;
const t = await import(toUrl(load("../src/editor/opc/types.ts")));
const f = await import(toUrl(load("../src/editor/opc/fake.ts")));

test("data type fits the element type", () => {
  const lvl = (kind, dt, array) => t.typeFit(kind, dt, array).level;
  assert.equal(lvl("percent", "Float"), "ok");
  assert.equal(lvl("percent", "String"), "error");
  assert.equal(lvl("percent", "Boolean"), "error");
  assert.equal(lvl("counter", "UInt32"), "ok");
  assert.equal(lvl("counter", "Boolean"), "error");
  assert.equal(lvl("counter", "Double"), "warn");
  assert.equal(lvl("number", "Int16"), "ok");
  assert.equal(lvl("number", "Boolean"), "warn");
  assert.equal(lvl("time", "UInt32"), "ok");
  assert.equal(lvl("time", "Float"), "error");
  assert.equal(lvl("status", "Boolean"), "ok");
  assert.equal(lvl("status", "Int16"), "ok");
  assert.equal(lvl("status", "Float"), "warn");
  assert.equal(lvl("status", "String"), "warn");
  assert.equal(lvl("number", "DTL"), "warn");
  assert.equal(lvl("number", "Float", true), "error");
  assert.match(t.typeFit("percent", "String").text, /En text \(String\) kan inte visas som Procent/);
  assert.equal(t.suggestKind("Boolean"), "status");
  assert.equal(t.suggestKind("Int32"), "counter");
  assert.equal(t.suggestKind("Float"), "number");
  assert.equal(t.suggestKind("String"), null);
});

test("tag name from the browse name, unique in the PLC", () => {
  assert.equal(t.suggestAlias("oee", []), "OEE");
  assert.equal(t.suggestAlias("prodState", []), "ProdState");
  assert.equal(t.suggestAlias("actual", []), "Actual");
  assert.equal(t.suggestAlias('"DB Pack"."count"', []), "Count");
  assert.equal(t.suggestAlias("Level 1", []), "Level1");
  assert.equal(t.suggestAlias("kassationPct", []), "KassationPct");
  assert.equal(t.suggestAlias("nivå", []), "Niva");
  assert.equal(t.suggestAlias("1st", []), "T1st");
  assert.equal(t.suggestAlias("kor", []), "Kor");
  assert.equal(t.suggestAlias("oeeMal", []), "OEEMal");
  assert.equal(t.suggestAlias("oee", ["OEE"]), "OEE2");
  assert.equal(t.suggestAlias("oee", ["OEE", "OEE2"]), "OEE3");
  for (const n of ["oee", "a b c", "ÅÄÖ", "x".repeat(80), "---"]) assert.match(t.suggestAlias(n, []), t.TAG_NAME);
  assert.ok(t.suggestAlias("x".repeat(80), []).length <= t.MAX_TAG_NAME);
});

const space = f.buildSpace("plc2", { name: "Glasyr", tags: { GlazeLevel: "ns=1;s=Demo.plc2.GlazeLevel", GlazeState: "ns=1;s=Demo.plc2.GlazeState" } });

test("fake address space looks like an S7-1500, one level at a time", () => {
  const root = f.fakeBrowse(space, "plc2");
  const names = root.children.map((c) => c.browse_name);
  assert.deepEqual(names, ["DeviceSet", "PLC_plc2", "ServerInterfaces", "Server"]); // the server's diagnostics last
  const plc = f.fakeBrowse(space, "plc2", "ns=3;s=PLC_plc2").children.map((c) => c.browse_name);
  assert.deepEqual(plc, ["DataBlocksGlobal", "DataBlocksInstance", "Inputs", "Memory", "Outputs"]);
  const dbs = f.fakeBrowse(space, "plc2", "ns=3;s=DataBlocksGlobal").children;
  assert.deepEqual(dbs.map((c) => c.browse_name), ["DB Demo", "DB Glasyr", "DB Produktion", "DB Recept"]);
  assert.ok(dbs.every((c) => c.has_children && c.node_class === "Object"));
  const demo = f.fakeBrowse(space, "plc2", "ns=1;s=Demo.plc2").children;
  assert.deepEqual(demo.map((c) => c.node_id), ["ns=1;s=Demo.plc2.GlazeLevel", "ns=1;s=Demo.plc2.GlazeState"]);
  const data = f.fakeBrowse(space, "plc2", 'ns=3;s="DB Produktion"."data"').children;
  const oee = data.find((c) => c.browse_name === "oee");
  assert.deepEqual(oee, { node_id: 'ns=3;s="DB Produktion"."data"."oee"', browse_name: "oee", display_name: "oee", node_class: "Variable", has_children: false, data_type: "Float", readable: true, writable: false, array: false });
  assert.equal(data.find((c) => c.browse_name === "senasteTakter").array, true);
  assert.equal(data.find((c) => c.browse_name === "borvarde").writable, true);
});

test("fake: caps, read, search and errors like the backend", () => {
  const big = f.fakeBrowse(space, "plc2", 'ns=3;s="DB Recept"');
  assert.equal(big.children.length, 200);
  assert.equal(big.truncated, true);
  assert.equal(f.fakeBrowse(space, "plc2", 'ns=3;s="DB Recept"', 5000).children.length, 300);
  const r = f.fakeRead(space, "plc2", 'ns=3;s="DB Produktion"."data"."oee"', 0);
  assert.equal(r.data_type, "Float");
  assert.equal(typeof r.value, "number");
  assert.equal(r.status, "Good");
  assert.equal(f.fakeRead(space, "plc2", 'ns=3;s="DB Produktion"."data"."recept"').value, "Platta 30x60 grå");
  assert.throws(() => f.fakeRead(space, "plc2", "ns=3;s=PLC_plc2"), /inte en variabel/);
  assert.throws(() => f.fakeBrowse(space, "plc2", "ns=3;s=nope"), /Noden finns inte i PLC:n/);
  const s = f.fakeSearch(space, "plc2", "OEE");
  const hit = s.results.find((x) => x.node_id === 'ns=3;s="DB Produktion"."data"."oee"');
  assert.deepEqual(hit.path, ["PLC_plc2", "DataBlocksGlobal", "DB Produktion", "data"]);
  assert.ok(s.results.every((x) => !x.node_id.startsWith("i=")));
  assert.equal(f.fakeSearch(space, "plc2", "param", "i=85", 2).complete, false);
  assert.throws(() => f.fakeSearch(space, "plc2", "x"), /minst 2 tecken/);
});

test("fake: no real plant names, only demo values", () => {
  const ids = [...space.keys()].join("\n");
  assert.doesNotMatch(ids, /DB Production TV|dashboardData/);
});
