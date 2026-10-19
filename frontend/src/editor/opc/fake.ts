/**
 * A fake S7-1500-like address space per demo PLC, for the editor on GitHub Pages (no backend, no
 * network). Same shapes and caps as /api/editor/opcua; values are simulated from the clock. The
 * names are made up (nothing from a real plant) apart from the demo document's own fake tag ids,
 * which appear under "DB Demo" so picking one of them shows the existing tag.
 */
import type { BrowseResult, OpcNode, ReadResult, SearchResult } from "./types";

interface FakeNode {
  node: OpcNode;
  children: string[];
  value?: (t: number) => unknown;
  writable?: boolean;
}

export interface FakeConnection {
  name?: string;
  tags?: Record<string, unknown>;
}

const MAX_CHILDREN = 500;
const SEARCH_MAX_NODES = 3000;
const SEARCH_MAX_RESULTS = 100;
const SEARCH_MAX_DEPTH = 8;

const s7 = (path: string[]) => `ns=3;s=${path.map((p) => `"${p}"`).join(".")}`;

type Spec = [name: string, type: string, value: (t: number) => unknown, writable?: boolean];

const wave = (base: number, amp: number, period: number) => (t: number) => Math.round((base + amp * Math.sin((t / 1000 / period) * 2 * Math.PI)) * 10) / 10;
const count = (start: number, perMin: number) => (t: number) => Math.floor(start + ((t / 60000) % 1440) * perMin);
const fixed = (v: unknown) => () => v;
const blink = (period: number) => (t: number) => Math.floor(t / 1000 / period) % 2 === 0;

function demoType(name: string): [string, (t: number) => unknown] {
  if (/state/i.test(name)) return ["Int16", fixed(2)];
  if (/screen/i.test(name)) return ["Int16", fixed(2)];
  if (/count|target|good|scrap/i.test(name)) return ["UInt32", count(1200, 140)];
  if (/shift(start|end)|runtime|stoptime|time/i.test(name)) return ["UInt32", (t) => Math.floor(t % 86_400_000)];
  if (/team/i.test(name)) return ["Int16", fixed(2)];
  return ["Float", wave(80, 6, 47)];
}

export function buildSpace(cid: string, conn: FakeConnection): Map<string, FakeNode> {
  const nodes = new Map<string, FakeNode>();
  const add = (parent: string | null, id: string, browse: string, cls: "Object" | "Variable", extra: Partial<FakeNode> = {}, dataType?: string, array = false) => {
    const node: OpcNode = { node_id: id, browse_name: browse, display_name: browse, node_class: cls, has_children: false };
    if (cls === "Variable") Object.assign(node, { data_type: dataType, readable: true, writable: !!extra.writable, array });
    nodes.set(id, { node, children: [], ...extra });
    if (parent) {
      const p = nodes.get(parent)!;
      p.children.push(id);
      p.node.has_children = true;
    }
    return id;
  };
  const vars = (parent: string, path: string[], specs: Spec[]) => {
    for (const [name, type, value, writable] of specs) add(parent, s7([...path, name]), name, "Variable", { value, writable }, type, type.endsWith("[]"));
  };

  const root = add(null, "i=85", "Objects", "Object");
  // The server's own diagnostics (in a real S7-1500 large; the editor sorts it last)
  const server = add(root, "i=2253", "Server", "Object");
  add(server, "i=2256", "ServerStatus", "Variable", { value: fixed("Running") }, "ServerStatusDataType");
  add(server, "i=2255", "NamespaceArray", "Variable", { value: fixed(["http://opcfoundation.org/UA/", "urn:demo", "http://www.siemens.com/simatic-s7-opcua"]) }, "String", true);
  const device = add(root, "ns=2;i=5001", "DeviceSet", "Object");
  const cpu = add(device, "ns=2;i=5002", `S7-1500 ${conn.name ?? cid}`, "Object");
  add(cpu, "ns=2;i=6001", "SerialNumber", "Variable", { value: fixed("S C-DEMO0000") }, "String");
  add(cpu, "ns=2;i=6002", "FirmwareRevision", "Variable", { value: fixed("V3.1") }, "String");
  const ifaces = add(root, "ns=4;i=1", "ServerInterfaces", "Object");
  const tv = add(ifaces, "ns=4;s=Dashboard", "Dashboard", "Object");
  add(tv, "ns=4;s=Dashboard.Produktion", "Produktion", "Variable", { value: count(3000, 140) }, "UInt32");
  add(tv, "ns=4;s=Dashboard.OEE", "OEE", "Variable", { value: wave(84, 4, 61) }, "Float");

  const plc = add(root, `ns=3;s=PLC_${cid}`, `PLC_${cid}`, "Object");
  const dbs = add(plc, "ns=3;s=DataBlocksGlobal", "DataBlocksGlobal", "Object");

  // The demo document's own (fake) tags
  const tags = Object.keys(conn.tags ?? {});
  if (tags.length) {
    const demo = add(dbs, `ns=1;s=Demo.${cid}`, "DB Demo", "Object");
    for (const name of tags) {
      const [type, value] = demoType(name);
      add(demo, `ns=1;s=Demo.${cid}.${name}`, name, "Variable", { value }, type);
    }
  }

  const prod = add(dbs, s7(["DB Produktion"]), "DB Produktion", "Object");
  const data = add(prod, s7(["DB Produktion", "data"]), "data", "Object");
  vars(data, ["DB Produktion", "data"], [
    ["antal", "UInt32", count(5000, 140)],
    ["antalBra", "UInt32", count(4900, 137)],
    ["mal", "UInt32", fixed(71400)],
    ["oee", "Float", wave(86, 3, 53)],
    ["kassationPct", "Float", wave(2.1, 0.6, 37)],
    ["takt", "Float", wave(138, 5, 29)],
    ["linjeLage", "Int16", fixed(2)],
    ["kor", "Boolean", blink(20)],
    ["recept", "String", fixed("Platta 30x60 grå")],
    ["korTid", "UInt32", (t) => Math.floor(t % 86_400_000)],
    ["senasteTakter", "Float[]", (t) => Array.from({ length: 10 }, (_, i) => wave(138, 5, 29)(t - i * 6000))],
    ["borvarde", "Double", fixed(12.5), true],
  ]);
  const scr = add(prod, s7(["DB Produktion", "skarm"]), "skarm", "Object");
  vars(scr, ["DB Produktion", "skarm"], [
    ["aktivSkarm", "Int16", (t) => 1 + (Math.floor(t / 20000) % 3)],
    ["begardSkarm", "Int16", fixed(0)],
  ]);
  const glaze = add(dbs, s7(["DB Glasyr"]), "DB Glasyr", "Object");
  vars(glaze, ["DB Glasyr"], [
    ["niva", "Float", wave(62, 8, 90)],
    ["temperatur", "Float", wave(41.5, 1.5, 120)],
    ["lage", "Int16", fixed(1)],
  ]);
  const big = add(dbs, s7(["DB Recept"]), "DB Recept", "Object");
  for (let i = 0; i < 300; i++) add(big, s7(["DB Recept", `param${i}`]), `param${i}`, "Variable", { value: fixed(i * 10) }, "UInt16");
  const inst = add(plc, "ns=3;s=DataBlocksInstance", "DataBlocksInstance", "Object");
  const conv = add(inst, s7(["IDB_Transportor"]), "IDB_Transportor", "Object");
  vars(conv, ["IDB_Transportor"], [["hastighet", "Float", wave(1.2, 0.1, 15)]]);
  const inputs = add(plc, "ns=3;s=Inputs", "Inputs", "Object");
  add(inputs, "ns=3;s=Inputs.Start", "Start", "Variable", { value: fixed(false) }, "Boolean");
  add(inputs, "ns=3;s=Inputs.Nodstopp", "Nodstopp", "Variable", { value: fixed(false) }, "Boolean");
  const outputs = add(plc, "ns=3;s=Outputs", "Outputs", "Object");
  add(outputs, "ns=3;s=Outputs.Motor", "Motor", "Variable", { value: blink(20) }, "Boolean");
  const mem = add(plc, "ns=3;s=Memory", "Memory", "Object");
  add(mem, "ns=3;s=Memory.Klocka_1Hz", "Klocka_1Hz", "Variable", { value: blink(1) }, "Boolean");
  return nodes;
}

export class OpcError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

const sortKey = (n: OpcNode) => [n.node_id === "i=2253" ? 1 : 0, n.node_class === "Object" ? 0 : 1, n.display_name.toLowerCase()] as const;
const cmp = (a: OpcNode, b: OpcNode) => {
  const [x, y] = [sortKey(a), sortKey(b)];
  return x[0] - y[0] || x[1] - y[1] || (x[2] < y[2] ? -1 : x[2] > y[2] ? 1 : 0);
};

export function fakeBrowse(space: Map<string, FakeNode>, cid: string, node = "i=85", limit = 200): BrowseResult {
  const n = space.get(node);
  if (!n) throw new OpcError("Noden finns inte i PLC:n.", 404);
  limit = Math.max(1, Math.min(limit, MAX_CHILDREN));
  const children = n.children.map((c) => ({ ...space.get(c)!.node })).sort(cmp);
  return { connection: cid, node, children: children.slice(0, limit), truncated: children.length > limit, limit };
}

export function fakeRead(space: Map<string, FakeNode>, cid: string, node: string, now = Date.now()): ReadResult {
  const n = space.get(node);
  if (!n) throw new OpcError("Noden finns inte i PLC:n.", 404);
  if (n.node.node_class !== "Variable") throw new OpcError(`Noden är en ${n.node.node_class}, inte en variabel – välj en variabel för att läsa ett värde.`, 400);
  return {
    connection: cid,
    node_id: node,
    display_name: n.node.display_name,
    browse_name: n.node.browse_name,
    data_type: n.node.data_type ?? null,
    readable: true,
    writable: !!n.writable,
    array: !!n.node.array,
    value: n.value?.(now) ?? null,
    status: "Good",
    source_time: new Date(now).toISOString(),
  };
}

export function fakeSearch(space: Map<string, FakeNode>, cid: string, q: string, root = "i=85", depth = 5): SearchResult {
  const needle = q.trim().toLowerCase();
  if (needle.length < 2) throw new OpcError("Sök på minst 2 tecken.", 400);
  if (!space.has(root)) throw new OpcError("Noden finns inte i PLC:n.", 404);
  depth = Math.max(1, Math.min(depth, SEARCH_MAX_DEPTH));
  let level: [string, string[]][] = [[root, []]];
  const seen = new Set([root]);
  const results: OpcNode[] = [];
  let visited = 0;
  let stopped: SearchResult["stopped_by"] = null;
  for (let d = 0; d < depth && level.length && !stopped; d++) {
    const next: [string, string[]][] = [];
    for (const [id, path] of level) {
      for (const c of space.get(id)!.children) {
        if (seen.has(c) || c === "i=2253") continue;
        seen.add(c);
        visited++;
        const n = space.get(c)!.node;
        if (n.display_name.toLowerCase().includes(needle) || n.browse_name.toLowerCase().includes(needle) || c.toLowerCase().includes(needle))
          results.push({ ...n, has_children: n.has_children, path });
        next.push([c, [...path, n.display_name]]);
      }
      if (visited >= SEARCH_MAX_NODES || results.length >= SEARCH_MAX_RESULTS) {
        stopped = "antal";
        break;
      }
    }
    level = next;
    if (!stopped && d === depth - 1 && level.some(([id]) => space.get(id)!.children.length)) stopped = "djup";
  }
  return { connection: cid, root, q: needle, results: results.slice(0, SEARCH_MAX_RESULTS), visited, complete: !stopped, stopped_by: stopped };
}
