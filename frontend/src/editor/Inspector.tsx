import { useState } from "react";
import type { Layout } from "@/layout/layout";
import { BUILTIN_NAMES, TYPE_NAMES } from "./names";
import { connectionIds, deleteScreen, duplicateScreen, findWidget, isBuiltin, moveScreen, removeWidget, renumberScreen, screen as screenOf } from "./ops";
import { useEditorStore } from "./store";
import { pasteClipboard } from "./actions";

const btn = "rounded-md border border-zinc-700 px-2.5 py-1 text-sm hover:bg-zinc-800 disabled:opacity-40";
const input = "w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-zinc-100 outline-none focus:border-sky-500";

function ScreenPanel({ layout }: { layout: Layout }) {
  const { doc, displayId, screenNr, edit, clipboard } = useEditorStore();
  const [nrText, setNrText] = useState<string | null>(null);
  if (!doc || !displayId || screenNr === null) return <p className="p-4 text-sm text-zinc-500">Ingen skärm vald.</p>;
  const s = screenOf(doc, displayId, screenNr);
  const view = layout.screens.find((x) => x.nr === screenNr);
  if (!s || !view) return null;
  const nrs = layout.screens.map((x) => x.nr);
  const i = nrs.indexOf(screenNr);
  const applyNr = () => {
    const to = Number(nrText);
    if (nrText !== null && to !== screenNr) edit((d) => renumberScreen(d, displayId, screenNr, to), { screenNr: to });
    setNrText(null);
  };
  return (
    <div className="space-y-4 p-4 text-sm" data-testid="screen-panel">
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Skärm</div>
      <label className="block space-y-1">
        <span className="text-zinc-400">Nummer (ActiveScreenNr från PLC:n)</span>
        <input
          data-testid="screen-nr"
          type="number"
          min={1}
          max={99}
          className={input}
          value={nrText ?? String(screenNr)}
          onChange={(e) => setNrText(e.target.value)}
          onBlur={applyNr}
          onKeyDown={(e) => e.key === "Enter" && applyNr()}
        />
      </label>
      <label className="block space-y-1">
        <span className="text-zinc-400">Namn (bara i editorn och listan)</span>
        <input
          data-testid="screen-title"
          maxLength={40}
          className={input}
          value={s.title ?? ""}
          onChange={(e) =>
            edit((d) => {
              const t = screenOf(d, displayId, screenNr)!;
              if (e.target.value) t.title = e.target.value;
              else delete t.title;
            })
          }
        />
      </label>
      {view.type !== "grid" && (
        <p className="text-zinc-400">
          Inbyggd skärm <b className="text-zinc-200">{BUILTIN_NAMES[view.type]}</b>. Välj den på duken för att byta PLC.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button className={btn} disabled={i <= 0} onClick={() => edit((d) => void moveScreen(d, displayId, screenNr, -1), { screenNr: nrs[i - 1] ?? screenNr, selected: null })}>
          ↑ Flytta upp
        </button>
        <button className={btn} disabled={i < 0 || i >= nrs.length - 1} onClick={() => edit((d) => void moveScreen(d, displayId, screenNr, 1), { screenNr: nrs[i + 1] ?? screenNr, selected: null })}>
          ↓ Flytta ned
        </button>
        <button
          className={btn}
          data-testid="duplicate-screen"
          onClick={() => {
            let to = 0;
            edit(
              (d) => {
                to = duplicateScreen(d, displayId, screenNr);
              },
              () => ({ screenNr: to, selected: null }),
            );
          }}
        >
          Duplicera
        </button>
        <button className={btn} disabled={!clipboard || view.type !== "grid"} onClick={pasteClipboard}>
          Klistra in
        </button>
        <button
          className={`${btn} border-red-900 text-red-300 hover:bg-red-950`}
          data-testid="delete-screen"
          onClick={() => {
            if (window.confirm(`Ta bort skärm ${screenNr}${s.title ? ` (${s.title})` : ""}?`)) edit((d) => deleteScreen(d, displayId, screenNr), { screenNr: null });
          }}
        >
          Ta bort
        </button>
      </div>
      <p className="text-xs text-zinc-500">
        Flytta upp/ned byter nummer med grannen: PLC:n väljer skärm med numret. Demons cykel visar skärmarna i nummerordning.
      </p>
    </div>
  );
}

function ItemPanel({ id }: { id: string }) {
  const { doc, displayId, screenNr, edit, copy } = useEditorStore();
  if (!doc || !displayId || screenNr === null) return null;
  const w = findWidget(doc, displayId, screenNr, id);
  if (!w) return null;
  const builtin = isBuiltin(w.kind);
  const conns = connectionIds(doc);
  const pool = (doc.connections ?? {}) as Record<string, { name?: string }>;
  return (
    <div className="space-y-4 p-4 text-sm" data-testid="item-panel">
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        {builtin ? `Inbyggd skärm · ${BUILTIN_NAMES[w.kind]}` : `Element · ${TYPE_NAMES[w.kind] ?? w.kind}`}
      </div>
      {builtin ? (
        <label className="block space-y-1">
          <span className="text-zinc-400">PLC (linje) som visas</span>
          <select
            data-testid="builtin-connection"
            className={input}
            value={w.connection ?? ""}
            onChange={(e) => edit((d) => void (findWidget(d, displayId, screenNr, id)!.connection = e.target.value))}
          >
            {conns.map((c) => (
              <option key={c} value={c}>
                {c}
                {pool[c]?.name ? ` · ${pool[c].name}` : ""}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-zinc-400">
            <dt>Etikett</dt>
            <dd className="truncate text-zinc-200">{w.label}</dd>
            <dt>Tagg</dt>
            <dd className="truncate font-mono text-zinc-200">{w.tag}</dd>
            <dt>Plats</dt>
            <dd className="font-mono text-zinc-200" data-testid="item-rect">
              x {w.x} · y {w.y} · {w.w}×{w.h}
            </dd>
          </dl>
          <div className="flex flex-wrap gap-2">
            <button className={btn} onClick={copy}>
              Kopiera
            </button>
            <button
              className={btn}
              onClick={() => {
                copy();
                pasteClipboard();
              }}
            >
              Duplicera
            </button>
            <button
              data-testid="delete-item"
              className={`${btn} border-red-900 text-red-300 hover:bg-red-950`}
              onClick={() => edit((d) => removeWidget(d, displayId, screenNr, id), { selected: null })}
            >
              Ta bort
            </button>
          </div>
          <p className="text-xs text-zinc-500">
            Egenskapspanelen (etikett, tagg, enhet, gränser …) kommer i nästa steg. Kortkommandon: Ctrl+Z/Y, Ctrl+C/V/D, Delete,
            pilar flyttar, Shift+pil ändrar storlek.
          </p>
        </>
      )}
    </div>
  );
}

export function Inspector({ layout }: { layout: Layout }) {
  const { doc, displayId, screenNr, selected } = useEditorStore();
  const w = doc && displayId && screenNr !== null && selected ? findWidget(doc, displayId, screenNr, selected) : undefined;
  return (
    <aside className="w-80 shrink-0 overflow-y-auto border-l border-zinc-800 bg-zinc-900">
      {w ? <ItemPanel id={w.id} /> : null}
      {!w || isBuiltin(w.kind) ? <ScreenPanel layout={layout} /> : null}
    </aside>
  );
}
