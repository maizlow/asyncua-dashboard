import { useMemo, useState } from "react";
import { splitRef } from "@/layout/doc";
import { OpcBrowser, type Pick, type PlcInfo } from "./opc/OpcBrowser";
import { seenTypes, setDemoConnections } from "./opc/source";
import { typeFit, type ValueKind } from "./opc/types";
import type { Doc } from "./backend";
import { connectionIds, defaultConnection } from "./ops";
import { useEditorStore } from "./store";
import { TAG_NAME } from "./validate";

const input = "w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-zinc-100 outline-none focus:border-sky-500";

function nodeOf(spec: unknown): string {
  if (typeof spec === "string") return spec;
  if (spec && typeof spec === "object" && "node" in spec) return String((spec as { node?: string }).node ?? "");
  return "";
}

// Demo build: the fake address space lists the PLCs and tags of the document being edited
setDemoConnections(() => (useEditorStore.getState().doc?.connections ?? {}) as Record<string, { name?: string; tags?: Record<string, unknown> }>);

/**
 * Tag picker: the tags of every PLC in the pool, grouped by PLC; a node picked by browsing the PLC
 * (etapp 3, read-only); or a new tag from a typed node id. The display's default PLC is written as
 * a short name (OEE), other PLCs qualified (plc2.Level).
 */
export function TagPicker({ doc, displayId, value, onChange, testId, kind }: { doc: Doc; displayId: string; value: string | undefined; onChange: (ref: string) => void; testId?: string; kind?: ValueKind }) {
  const edit = useEditorStore((s) => s.edit);
  const [adding, setAdding] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const def = defaultConnection(doc, displayId);
  const conns = useMemo(() => (doc.connections ?? {}) as Record<string, { name?: string; tags?: Record<string, unknown> }>, [doc.connections]);
  const ids = connectionIds(doc);
  const [cid, name] = value ? splitRef(value, def) : [null, ""];
  const qualified = cid ? `${cid}.${name}` : (value ?? "");
  const known = cid && conns[cid]?.tags && name in conns[cid].tags!;
  const node = known ? nodeOf(conns[cid!].tags![name]) : "";
  const pick = (q: string) => {
    const [c, n] = splitRef(q, null);
    onChange(c === def ? n : q);
  };

  const plcs: PlcInfo[] = useMemo(
    () =>
      ids.map((c) => {
        const tags = conns[c]?.tags ?? {};
        return { id: c, name: conns[c]?.name, tagNames: Object.keys(tags), tagsByNode: new Map(Object.entries(tags).map(([t, spec]) => [nodeOf(spec).trim(), t])) };
      }),
    [ids, conns],
  );
  const usePicked = (p: Pick) => {
    if (!p.existing)
      edit((d) => {
        const c = (d.connections as Record<string, { tags?: Record<string, unknown> }>)[p.cid];
        c.tags ??= {};
        c.tags[p.alias] = p.type === "time" ? { node: p.node.node_id, type: "time" } : p.node.node_id;
      });
    pick(`${p.cid}.${p.alias}`);
    setBrowsing(false);
  };
  const seen = known && cid ? seenTypes.get(`${cid}|${node.trim()}`) : undefined;
  const fit = seen && kind ? typeFit(kind, seen.data_type, seen.array) : null;

  const [nc, setNc] = useState(cid ?? def ?? ids[0] ?? "");
  const [nn, setNn] = useState("");
  const [nodeId, setNodeId] = useState("");
  const [ntype, setNtype] = useState<"auto" | "time">("auto");
  const exists = !!conns[nc]?.tags && nn in conns[nc].tags!;
  const nameOk = TAG_NAME.test(nn) && !exists;
  const add = () => {
    edit((d) => {
      const c = (d.connections as Record<string, { tags?: Record<string, unknown> }>)[nc];
      c.tags ??= {};
      c.tags[nn] = ntype === "time" ? { node: nodeId.trim(), type: "time" } : nodeId.trim();
    });
    pick(`${nc}.${nn}`);
    setAdding(false);
    setNn("");
    setNodeId("");
  };

  return (
    <div className="space-y-1.5">
      <select data-testid={testId} className={input} value={known ? qualified : "__unknown"} onChange={(e) => (e.target.value === "__new" ? setAdding(true) : pick(e.target.value))}>
        {!known && <option value="__unknown">{value ? `${value} (okänd)` : "– välj tagg –"}</option>}
        {ids.map((c) => (
          <optgroup key={c} label={`${c}${conns[c]?.name ? ` · ${conns[c].name}` : ""}${c === def ? " (standard)" : ""}`}>
            {Object.keys(conns[c]?.tags ?? {}).map((t) => (
              <option key={t} value={`${c}.${t}`}>
                {c === def ? t : `${c}.${t}`}
              </option>
            ))}
          </optgroup>
        ))}
        <option value="__new">+ Ny tagg från nod-id …</option>
      </select>
      <button
        data-testid={testId ? `${testId}-browse` : undefined}
        onClick={() => setBrowsing(true)}
        className="w-full rounded-md border border-zinc-700 px-2 py-1 text-left text-sm text-sky-300 hover:bg-zinc-800"
      >
        Bläddra i PLC:n …
      </button>
      {browsing && <OpcBrowser plcs={plcs} initialCid={cid ?? def ?? ids[0]} kind={kind} onPick={usePicked} onClose={() => setBrowsing(false)} />}
      {fit && fit.level !== "ok" && (
        <div data-testid={testId ? `${testId}-fit` : undefined} className={`text-[11px] ${fit.level === "error" ? "text-red-300" : "text-amber-300"}`}>
          {fit.level === "error" ? "✖" : "⚠"} {seen?.data_type}: {fit.text}
        </div>
      )}
      {node ? (
        <div className="truncate font-mono text-[11px] text-zinc-500" title={node}>
          {node}
        </div>
      ) : known ? (
        <div className="text-[11px] text-amber-400">Saknar nod-id (TODO(PLC)): visar – tills den fylls i</div>
      ) : null}
      {adding && (
        <div className="space-y-2 rounded-md border border-zinc-700 bg-zinc-950 p-2" data-testid="new-tag">
          <div className="grid grid-cols-2 gap-2">
            <select className={input} value={nc} onChange={(e) => setNc(e.target.value)} aria-label="PLC">
              {ids.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input className={input} placeholder="Namn, t.ex. Temp" value={nn} onChange={(e) => setNn(e.target.value)} aria-label="Taggnamn" />
          </div>
          <input className={`${input} font-mono`} placeholder='ns=3;s="DB"."temp"' value={nodeId} onChange={(e) => setNodeId(e.target.value)} aria-label="Nod-id" />
          <div className="flex items-center gap-2">
            <select className={input} value={ntype} onChange={(e) => setNtype(e.target.value as "auto" | "time")} aria-label="Typ">
              <option value="auto">Tal/heltal/bool</option>
              <option value="time">S7 TIME (tid)</option>
            </select>
            <button disabled={!nameOk || !nodeId.trim()} onClick={add} className="shrink-0 rounded-md bg-sky-700 px-2.5 py-1 text-sm hover:bg-sky-600 disabled:opacity-40">
              Lägg till
            </button>
            <button onClick={() => setAdding(false)} className="shrink-0 rounded-md border border-zinc-700 px-2 py-1 text-sm">
              Avbryt
            </button>
          </div>
          <p className="text-[11px] text-zinc-500">
            {nn && !TAG_NAME.test(nn) ? "Namn: bokstäver, siffror och _, börjar med en bokstav. " : ""}
            {exists ? `${nn} finns redan i ${nc}. ` : ""}
            Nya taggar läses av backend efter omstart (tills etapp 4). Editorn skriver aldrig till PLC:n.
          </p>
        </div>
      )}
    </div>
  );
}
