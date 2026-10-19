import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { opcSource, OpcError, remember } from "./source";
import { formatValue, MAX_TAG_NAME, suggestAlias, suggestKind, TAG_NAME, typeFit, type OpcNode, type ReadResult, type SearchResult, type ValueKind } from "./types";

const ROOT = "i=85";
const input = "w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-zinc-100 outline-none focus:border-sky-500";
const KIND_NAMES: Record<ValueKind, string> = { number: "Tal", percent: "Procent", counter: "Räknare", time: "Tid", status: "Status" };

interface Level {
  children?: OpcNode[];
  truncated?: boolean;
  loading?: boolean;
  error?: string;
}

export interface PlcInfo {
  id: string;
  name?: string;
  /** node id -> tag name, for the tags this PLC already has */
  tagsByNode: Map<string, string>;
  tagNames: string[];
}

export interface Pick {
  cid: string;
  node: OpcNode;
  /** Existing tag with this node id, or the new tag's name */
  alias: string;
  existing: boolean;
  type: "auto" | "time";
}

function nodeIcon(n: OpcNode) {
  if (n.node_class === "Variable") return n.array ? "▦" : "◆";
  return n.has_children ? "▸" : "▫";
}

/**
 * Browse a PLC's address space one level at a time (lazy), filter what is loaded or search the PLC,
 * and pick a variable as a tag. Read-only: the backend only browses and reads.
 */
export function OpcBrowser({ plcs, initialCid, kind, onPick, onClose }: { plcs: PlcInfo[]; initialCid: string; kind?: ValueKind; onPick: (p: Pick) => void; onClose: () => void }) {
  const [cid, setCid] = useState(initialCid);
  const plc = plcs.find((p) => p.id === cid) ?? plcs[0];
  const [levels, setLevels] = useState<Record<string, Level>>({});
  const [open, setOpen] = useState<Set<string>>(new Set([ROOT]));
  const [selected, setSelected] = useState<OpcNode | null>(null);
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState<{ q: string; loading?: boolean; result?: SearchResult; error?: string } | null>(null);
  const [rootError, setRootError] = useState<string | null>(null);

  // State is only set in the promise callbacks, so the effect below can start it
  const fetchLevel = useCallback(
    (node: string) =>
      opcSource.browse(cid, node).then(
        (r) => {
          remember(cid, r.children);
          setLevels((l) => ({ ...l, [node]: { children: r.children, truncated: r.truncated } }));
          if (node === ROOT) setRootError(null);
        },
        (e: Error) => {
          setLevels((l) => ({ ...l, [node]: { error: e.message } }));
          if (node === ROOT) setRootError(e.message);
        },
      ),
    [cid],
  );
  const load = (node: string) => {
    setLevels((l) => ({ ...l, [node]: { ...l[node], loading: true, error: undefined } }));
    return fetchLevel(node);
  };

  useEffect(() => {
    void fetchLevel(ROOT);
  }, [fetchLevel]);

  const changePlc = (id: string) => {
    setLevels({});
    setOpen(new Set([ROOT]));
    setSelected(null);
    setSearch(null);
    setCid(id);
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  const toggle = (n: OpcNode) => {
    const next = new Set(open);
    if (next.has(n.node_id)) next.delete(n.node_id);
    else {
      next.add(n.node_id);
      if (!levels[n.node_id]?.children) void load(n.node_id);
    }
    setOpen(next);
  };

  const runSearch = async () => {
    const q = filter.trim();
    if (q.length < 2) return;
    setSearch({ q, loading: true });
    try {
      const result = await opcSource.search(cid, q);
      remember(cid, result.results);
      setSearch({ q, result });
    } catch (e) {
      setSearch({ q, error: (e as Error).message });
    }
  };

  const f = filter.trim().toLowerCase();
  // Local filter: a loaded node is shown when it or something loaded below it matches
  const matches = useMemo(() => {
    if (!f) return null;
    const keep = new Set<string>();
    const walk = (id: string): boolean => {
      let any = false;
      for (const c of levels[id]?.children ?? []) {
        const self = c.display_name.toLowerCase().includes(f) || c.browse_name.toLowerCase().includes(f) || c.node_id.toLowerCase().includes(f);
        const below = open.has(c.node_id) && walk(c.node_id);
        if (self || below) {
          keep.add(c.node_id);
          any = true;
        }
      }
      return any;
    };
    walk(ROOT);
    return keep;
  }, [f, levels, open]);

  const renderLevel = (id: string, depth: number): React.ReactNode => {
    const lv = levels[id];
    if (!lv) return id === ROOT ? <div className="px-2 py-1 text-xs text-zinc-500">Läser …</div> : null;
    if (lv.loading && !lv.children) return <div className="py-1 text-xs text-zinc-500" style={{ paddingLeft: depth * 16 + 24 }}>Läser …</div>;
    if (lv.error) return <div className="py-1 text-xs text-red-300" style={{ paddingLeft: depth * 16 + 24 }}>{lv.error}</div>;
    const kids = (lv.children ?? []).filter((c) => !matches || matches.has(c.node_id));
    return (
      <>
        {kids.map((c) => {
          const isOpen = open.has(c.node_id);
          const isSel = selected?.node_id === c.node_id;
          const tag = plc.tagsByNode.get(c.node_id);
          return (
            <div key={c.node_id} role="treeitem" aria-expanded={c.has_children ? isOpen : undefined}>
              <div
                data-testid="tree-item"
                data-name={c.browse_name}
                data-node={c.node_id}
                onClick={() => setSelected(c)}
                onDoubleClick={() => c.has_children && toggle(c)}
                className={`flex cursor-pointer items-center gap-1.5 rounded py-0.5 pr-2 text-sm ${isSel ? "bg-sky-900/60 text-white" : "hover:bg-zinc-800"}`}
                style={{ paddingLeft: depth * 16 + 4 }}
              >
                <button
                  data-testid="tree-toggle"
                  aria-label={isOpen ? "Fäll ihop" : "Fäll ut"}
                  disabled={!c.has_children}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(c);
                  }}
                  className="w-4 shrink-0 text-center text-zinc-400 disabled:opacity-0"
                >
                  {isOpen ? "▾" : "▸"}
                </button>
                <span className={c.node_class === "Variable" ? "text-sky-300" : "text-zinc-500"}>{c.node_class === "Variable" ? nodeIcon(c) : "■"}</span>
                <span className="truncate">{c.display_name}</span>
                {c.data_type && <span className="ml-auto shrink-0 font-mono text-[11px] text-zinc-500">{c.data_type}{c.array ? "[]" : ""}</span>}
                {tag && <span className="shrink-0 rounded bg-emerald-800 px-1.5 text-[11px] text-white" title="Finns redan som tagg">{tag}</span>}
              </div>
              {isOpen && renderLevel(c.node_id, depth + 1)}
            </div>
          );
        })}
        {lv.truncated && (
          <div data-testid="opc-truncated" className="py-1 text-xs text-amber-300" style={{ paddingLeft: depth * 16 + 24 }}>
            Visar de första {lv.children?.length} – sök för att hitta resten.
          </div>
        )}
        {matches && !kids.length && depth === 0 && <div className="px-2 py-2 text-xs text-zinc-500">Inget av det inlästa matchar. Tryck Enter för att söka i PLC:n.</div>}
      </>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onMouseDown={onClose}>
      <div
        data-testid="opc-browser"
        role="dialog"
        aria-label="Bläddra i PLC:n"
        onMouseDown={(e) => e.stopPropagation()}
        className="flex h-[80vh] max-h-[760px] w-[1080px] max-w-[95vw] flex-col rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl"
      >
        <div className="flex items-center gap-3 border-b border-zinc-800 px-5 py-3">
          <h2 className="font-semibold">Bläddra i PLC:n</h2>
          <select data-testid="opc-plc" value={cid} onChange={(e) => changePlc(e.target.value)} className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm" aria-label="PLC">
            {plcs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id}
                {p.name ? ` · ${p.name}` : ""}
              </option>
            ))}
          </select>
          <div className="flex flex-1 gap-2">
            <input
              data-testid="opc-filter"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                if (!e.target.value.trim()) setSearch(null);
              }}
              onKeyDown={(e) => e.key === "Enter" && void runSearch()}
              placeholder="Filtrera det inlästa, Enter söker i hela PLC:n (namn eller nod-id)"
              className={input}
            />
            <button data-testid="opc-search" onClick={() => void runSearch()} disabled={filter.trim().length < 2} className="shrink-0 rounded-md border border-zinc-700 px-3 text-sm hover:bg-zinc-800 disabled:opacity-40">
              Sök i PLC:n
            </button>
          </div>
          <span className="text-xs text-zinc-500">{opcSource.demo ? "Demo: påhittad S7-1500" : "Bara läsning"}</span>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-100" aria-label="Stäng">
            ✕
          </button>
        </div>
        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1 overflow-y-auto border-r border-zinc-800 p-2" role="tree">
            {search ? (
              <SearchList search={search} plc={plc} selected={selected} onSelect={setSelected} onClear={() => setSearch(null)} />
            ) : rootError ? (
              <div data-testid="opc-error" className="m-3 rounded-md border border-red-900 bg-red-950/50 p-3 text-sm text-red-200">
                {rootError}
                <button onClick={() => void load(ROOT)} className="ml-3 rounded border border-red-800 px-2 py-0.5 text-xs hover:bg-red-900">
                  Försök igen
                </button>
              </div>
            ) : (
              renderLevel(ROOT, 0)
            )}
          </div>
          <div className="w-[420px] shrink-0 overflow-y-auto p-4">
            {selected ? <Detail key={`${cid}|${selected.node_id}`} cid={cid} node={selected} plc={plc} kind={kind} onPick={onPick} /> : <p className="text-sm text-zinc-500">Välj en variabel (◆) för att se datatyp och värde och använda den som tagg.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

function SearchList({ search, plc, selected, onSelect, onClear }: { search: { q: string; loading?: boolean; result?: SearchResult; error?: string }; plc: PlcInfo; selected: OpcNode | null; onSelect: (n: OpcNode) => void; onClear: () => void }) {
  const r = search.result;
  return (
    <div data-testid="search-results">
      <div className="mb-2 flex items-center gap-2 px-2 text-xs text-zinc-400">
        {search.loading ? `Söker efter "${search.q}" …` : search.error ? <span className="text-red-300">{search.error}</span> : `${r!.results.length} träffar för "${search.q}"`}
        {r && !r.complete && (
          <span className="text-amber-300">
            · sökningen stoppades ({r.stopped_by === "tid" ? "tidsgräns" : r.stopped_by === "djup" ? "djup" : "antal noder"}) – sök mer exakt
          </span>
        )}
        <button onClick={onClear} className="ml-auto rounded border border-zinc-700 px-2 py-0.5 hover:bg-zinc-800">
          Tillbaka till trädet
        </button>
      </div>
      {r?.results.map((n) => (
        <div
          key={n.node_id}
          data-testid="search-result"
          data-name={n.browse_name}
          onClick={() => onSelect(n)}
          className={`cursor-pointer rounded px-2 py-1 text-sm ${selected?.node_id === n.node_id ? "bg-sky-900/60" : "hover:bg-zinc-800"}`}
        >
          <div className="flex gap-2">
            <span className={n.node_class === "Variable" ? "text-sky-300" : "text-zinc-500"}>{n.node_class === "Variable" ? nodeIcon(n) : "■"}</span>
            <span>{n.display_name}</span>
            {n.data_type && <span className="ml-auto font-mono text-[11px] text-zinc-500">{n.data_type}</span>}
            {plc.tagsByNode.get(n.node_id) && <span className="rounded bg-emerald-800 px-1.5 text-[11px] text-white">{plc.tagsByNode.get(n.node_id)}</span>}
          </div>
          <div className="truncate pl-5 text-[11px] text-zinc-500">{(n.path ?? []).join(" › ")}</div>
        </div>
      ))}
    </div>
  );
}

function Detail({ cid, node, plc, kind, onPick }: { cid: string; node: OpcNode; plc: PlcInfo; kind?: ValueKind; onPick: (p: Pick) => void }) {
  const isVar = node.node_class === "Variable";
  const [live, setLive] = useState<ReadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const existing = plc.tagsByNode.get(node.node_id);
  const [alias, setAlias] = useState(() => existing ?? suggestAlias(node.browse_name, plc.tagNames));
  const [type, setType] = useState<"auto" | "time">(kind === "time" ? "time" : "auto");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isVar) return;
    let stop = false;
    const tick = () =>
      opcSource.read(cid, node.node_id).then(
        (r) => !stop && (setLive(r), setError(null)),
        (e: OpcError) => !stop && setError(e.message),
      );
    void tick();
    timer.current = setInterval(tick, 2000); // only while this node is selected; nothing is subscribed
    return () => {
      stop = true;
      if (timer.current) clearInterval(timer.current);
    };
  }, [cid, node.node_id, isVar]);

  const dataType = live?.data_type ?? node.data_type;
  const array = live?.array ?? node.array ?? false;
  const fit = isVar && kind ? typeFit(kind, dataType, array) : null;
  const suggested = suggestKind(dataType);
  const nameTaken = !existing && plc.tagNames.includes(alias);
  const nameOk = TAG_NAME.test(alias) && alias.length <= MAX_TAG_NAME && !nameTaken;

  return (
    <div data-testid="opc-detail" className="space-y-3 text-sm">
      <div>
        <div className="text-base font-medium">{node.display_name}</div>
        {node.path && <div className="text-xs text-zinc-500">{node.path.join(" › ")}</div>}
      </div>
      <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-zinc-500">Nod-id</dt>
        <dd className="break-all font-mono" data-testid="opc-node-id">
          {node.node_id}
        </dd>
        <dt className="text-zinc-500">Nodklass</dt>
        <dd>{node.node_class}</dd>
        {isVar && (
          <>
            <dt className="text-zinc-500">Datatyp</dt>
            <dd className="font-mono" data-testid="opc-data-type">
              {dataType ?? "–"}
              {array ? " (array)" : ""}
            </dd>
            <dt className="text-zinc-500">Åtkomst</dt>
            <dd>{(live?.writable ?? node.writable) ? "läs och skriv i PLC:n (editorn läser bara)" : "läs"}</dd>
          </>
        )}
      </dl>
      {isVar ? (
        <>
          <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
            <div className="text-xs text-zinc-500">Värde just nu {opcSource.demo ? "(simulerat)" : "(läses varannan sekund)"}</div>
            <div data-testid="opc-value" className="mt-1 break-all font-mono text-2xl">
              {error ? <span className="text-base text-red-300">{error}</span> : live ? formatValue(live.value) : "…"}
            </div>
            {live && live.status !== "Good" && <div className="text-xs text-amber-300">Status: {live.status}</div>}
          </div>
          {fit && (
            <div
              data-testid="opc-fit"
              data-level={fit.level}
              className={`rounded-md border p-2 text-xs ${fit.level === "error" ? "border-red-900 bg-red-950/50 text-red-200" : fit.level === "warn" ? "border-amber-900 bg-amber-950/40 text-amber-200" : "border-emerald-900 bg-emerald-950/40 text-emerald-200"}`}
            >
              {fit.level === "error" ? "✖ " : fit.level === "warn" ? "⚠ " : "✔ "}
              {fit.text}
              {fit.level !== "ok" && suggested && suggested !== kind && <div className="mt-1 text-zinc-300">Förslag: elementtypen {KIND_NAMES[suggested]}.</div>}
            </div>
          )}
          {existing ? (
            <div className="space-y-2">
              <p data-testid="opc-existing" className="text-xs text-emerald-300">
                Noden finns redan som taggen <b>{existing}</b> i {cid}.
              </p>
              <button data-testid="opc-use" onClick={() => onPick({ cid, node: { ...node, data_type: dataType, array }, alias: existing, existing: true, type })} className="rounded-md bg-sky-600 px-3 py-1.5 font-medium text-white hover:bg-sky-500">
                Använd {existing}
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <label className="block">
                <span className="text-xs text-zinc-400">Taggnamn (alias) i {cid}</span>
                <input data-testid="opc-alias" className={`${input} mt-1 font-mono`} value={alias} maxLength={MAX_TAG_NAME} onChange={(e) => setAlias(e.target.value)} />
              </label>
              <label className="block">
                <span className="text-xs text-zinc-400">Typ</span>
                <select data-testid="opc-type" className={`${input} mt-1`} value={type} onChange={(e) => setType(e.target.value as "auto" | "time")}>
                  <option value="auto">Tal/heltal/bool</option>
                  <option value="time">S7 TIME/TOD (ms, visas som tid)</option>
                </select>
              </label>
              {!nameOk && <p className="text-xs text-red-300">{nameTaken ? `${alias} finns redan i ${cid}.` : "Namn: bokstäver, siffror och _, börjar med en bokstav."}</p>}
              <button
                data-testid="opc-use"
                disabled={!nameOk}
                onClick={() => onPick({ cid, node: { ...node, data_type: dataType, array }, alias, existing: false, type })}
                className="rounded-md bg-sky-600 px-3 py-1.5 font-medium text-white hover:bg-sky-500 disabled:opacity-40"
              >
                Skapa taggen och använd den
              </button>
              <p className="text-[11px] text-zinc-500">
                Taggen blir <span className="font-mono">{cid}.{alias || "…"}</span> → {node.node_id}. Backend läser nya taggar efter omstart (tills etapp 4).
              </p>
            </div>
          )}
        </>
      ) : (
        <p className="text-xs text-zinc-500">{node.has_children ? "En mapp eller ett objekt: fäll ut för att se innehållet." : "Tomt objekt."}</p>
      )}
    </div>
  );
}
