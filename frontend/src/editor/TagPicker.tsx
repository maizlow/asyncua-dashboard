import { useState } from "react";
import { splitRef } from "@/layout/doc";
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

/**
 * Tag picker: the tags of every PLC in the pool, grouped by PLC, or a new tag from a typed node id
 * (until browsing the OPC UA server arrives in etapp 3). The display's default PLC is written as a
 * short name (OEE), other PLCs qualified (plc2.Level).
 */
export function TagPicker({ doc, displayId, value, onChange, testId }: { doc: Doc; displayId: string; value: string | undefined; onChange: (ref: string) => void; testId?: string }) {
  const edit = useEditorStore((s) => s.edit);
  const [adding, setAdding] = useState(false);
  const def = defaultConnection(doc, displayId);
  const conns = (doc.connections ?? {}) as Record<string, { name?: string; tags?: Record<string, unknown> }>;
  const ids = connectionIds(doc);
  const [cid, name] = value ? splitRef(value, def) : [null, ""];
  const qualified = cid ? `${cid}.${name}` : (value ?? "");
  const known = cid && conns[cid]?.tags && name in conns[cid].tags!;
  const node = known ? nodeOf(conns[cid!].tags![name]) : "";
  const pick = (q: string) => {
    const [c, n] = splitRef(q, null);
    onChange(c === def ? n : q);
  };

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
