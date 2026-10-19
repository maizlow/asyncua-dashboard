import { useState } from "react";
import { BUILTIN_KINDS } from "@/layout/doc";
import type { Layout, LogoAsset, ScreenConfig } from "@/layout/layout";
import type { Doc } from "./backend";
import { setDragKind } from "./dnd";
import { CHART_KINDS, KINDS } from "@/charts/metrics";
import { BUILTIN_NAMES, TYPE_NAMES } from "./names";
import { addScreen, addWidget, connectionIds, display, minSizeOf, VALUE_KINDS, type ElementKind } from "./ops";
import { displaysOf, useEditorStore } from "./store";

const LOGOS: [LogoAsset, string][] = [
  ["customer", "Kundens logotyp"],
  ["vendor", "ABECE"],
  ["none", "Ingen"],
];

const sel = "w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-zinc-100";

function DisplaySettings({ doc, displayId, layout }: { doc: Doc; displayId: string; layout: Layout }) {
  const edit = useEditorStore((s) => s.edit);
  const d = displaysOf(doc)[displayId] ?? {};
  const pool = (doc.connections ?? {}) as Record<string, { name?: string }>;
  const header = (d.header ?? {}) as { left?: LogoAsset; right?: LogoAsset };
  const screenCtl = (d.screen ?? {}) as { connection?: string };
  const conns = connectionIds(doc);
  const setHeader = (side: "left" | "right", v: LogoAsset) =>
    edit((x) => {
      const dd = display(x, displayId);
      dd.header = { left: "customer", right: "vendor", ...((dd.header as object) ?? {}), [side]: v };
    });
  return (
    <div className="space-y-2 border-b border-zinc-800 p-4 text-sm">
      <div className="font-medium text-zinc-200">{(d.name as string | undefined) ?? displayId}</div>
      <div className="text-zinc-400">
        Läser från:{" "}
        {Object.keys(layout.connections).map((c) => (
          <span key={c} title={pool[c]?.name} className="mr-1 inline-block rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-xs text-zinc-200">
            {c}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className="text-xs text-zinc-500">Vänster logotyp</span>
          <select data-testid="logo-left" className={sel} value={header.left ?? "customer"} onChange={(e) => setHeader("left", e.target.value as LogoAsset)}>
            {LOGOS.map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-xs text-zinc-500">Höger logotyp</span>
          <select data-testid="logo-right" className={sel} value={header.right ?? "vendor"} onChange={(e) => setHeader("right", e.target.value as LogoAsset)}>
            {LOGOS.map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block space-y-1">
        <span className="text-xs text-zinc-500">Standard-PLC (korta taggnamn)</span>
        <select
          className={sel}
          value={(d.default_connection as string | undefined) ?? ""}
          onChange={(e) =>
            edit((x) => {
              const dd = display(x, displayId);
              if (e.target.value) dd.default_connection = e.target.value;
              else delete dd.default_connection;
            })
          }
        >
          {conns.length === 1 && <option value="">{conns[0]} (enda)</option>}
          {conns.length !== 1 && !d.default_connection && <option value="">– välj –</option>}
          {conns.map((c) => (
            <option key={c} value={c}>
              {c}
              {pool[c]?.name ? ` · ${pool[c].name}` : ""}
            </option>
          ))}
        </select>
      </label>
      <div className="text-xs text-zinc-500">
        Skärmväxling (ActiveScreenNr) från <span className="font-mono text-zinc-300">{screenCtl.connection ?? "–"}</span>
      </div>
    </div>
  );
}

function screenName(s: ScreenConfig): string {
  return s.title ?? (s.type === "grid" ? "Rutnät" : (BUILTIN_NAMES[s.type] ?? s.type));
}

function screenSummary(s: ScreenConfig): string {
  if (s.type !== "grid") return `Inbyggd: ${BUILTIN_NAMES[s.type] ?? s.type}${s.connection ? ` · ${s.connection}` : ""}`;
  return s.items.length === 1 ? "1 element" : `${s.items.length} element`;
}

function ScreenList({ layout, displayId }: { layout: Layout; displayId: string }) {
  const { screenNr, selectScreen, edit } = useEditorStore();
  const [adding, setAdding] = useState(false);
  const add = (kind: "grid" | (typeof BUILTIN_KINDS)[number]) => {
    let nr = 0;
    edit(
      (d) => {
        nr = addScreen(d, displayId, kind, screenNr ?? undefined);
      },
      () => ({ screenNr: nr, selected: null }),
    );
    setAdding(false);
  };
  return (
    <nav className="border-b border-zinc-800 p-2" aria-label="Skärmar">
      <div className="flex items-center justify-between px-2 pb-2 pt-1">
        <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">Skärmar</span>
        <button data-testid="add-screen" onClick={() => setAdding((a) => !a)} className="rounded px-2 py-0.5 text-sm text-sky-400 hover:bg-zinc-800">
          + Ny skärm
        </button>
      </div>
      {adding && (
        <div className="mb-2 grid grid-cols-2 gap-1 rounded-md bg-zinc-950 p-2">
          <button data-testid="add-screen-grid" onClick={() => add("grid")} className="col-span-2 rounded bg-zinc-800 px-2 py-1 text-sm hover:bg-zinc-700">
            Rutnät (egna element)
          </button>
          {BUILTIN_KINDS.map((k) => (
            <button key={k} data-testid={`add-screen-${k}`} onClick={() => add(k)} className="rounded bg-zinc-800 px-2 py-1 text-sm hover:bg-zinc-700">
              {BUILTIN_NAMES[k]}
            </button>
          ))}
        </div>
      )}
      {layout.screens.map((s) => (
        <button
          key={s.nr}
          data-testid={`screen-${s.nr}`}
          onClick={() => selectScreen(s.nr)}
          className={`mb-1 flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left ${
            s.nr === screenNr ? "bg-sky-900/50 ring-1 ring-sky-700" : "hover:bg-zinc-800"
          }`}
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-zinc-800 font-mono text-sm" title="ActiveScreenNr">
            {s.nr}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm text-zinc-100">{screenName(s)}</span>
            <span className="block truncate text-xs text-zinc-500">{screenSummary(s)}</span>
          </span>
        </button>
      ))}
      {layout.screens.length === 0 && <p className="px-2 py-1 text-sm text-zinc-500">Inga skärmar.</p>}
    </nav>
  );
}

function PaletteButton({ kind, name, disabled, onAdd }: { kind: ElementKind; name: string; disabled: boolean; onAdd: (k: ElementKind) => void }) {
  const [w, h] = minSizeOf(kind);
  return (
    <button
      data-testid={`palette-${kind}`}
      draggable={!disabled}
      disabled={disabled}
      onDragStart={(e) => {
        setDragKind(e.dataTransfer, kind);
        e.dataTransfer.effectAllowed = "copy";
      }}
      onClick={() => onAdd(kind)}
      title={`Dra till skärmen eller klicka för att lägga till på första lediga plats (minst ${w}×${h} rutor)`}
      className="cursor-grab rounded-md border border-zinc-700 bg-zinc-950 px-2 py-2 text-left text-sm hover:border-sky-600 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {name}
    </button>
  );
}

function Palette({ displayId, layout }: { displayId: string; layout: Layout }) {
  const { screenNr, edit } = useEditorStore();
  const screen = layout.screens.find((s) => s.nr === screenNr);
  const disabled = !screen || screen.type !== "grid";
  const add = (kind: ElementKind) => {
    if (screenNr === null) return;
    let id = "";
    edit(
      (d) => {
        id = addWidget(d, displayId, screenNr, kind);
      },
      () => ({ selected: id }),
    );
  };
  return (
    <div className="p-2">
      <div className="px-2 pb-2 pt-1 text-xs font-medium uppercase tracking-wide text-zinc-500">Element</div>
      <div className="grid grid-cols-2 gap-1">
        {VALUE_KINDS.map((k) => (
          <PaletteButton key={k} kind={k} name={TYPE_NAMES[k]} disabled={disabled} onAdd={add} />
        ))}
      </div>
      <div className="px-2 pb-2 pt-3 text-xs font-medium uppercase tracking-wide text-zinc-500">Diagram och KPI</div>
      <div className="grid grid-cols-2 gap-1">
        {CHART_KINDS.map((k) => (
          <PaletteButton key={k} kind={k} name={KINDS[k].name} disabled={disabled} onAdd={add} />
        ))}
      </div>
      <p className="mt-2 px-1 text-xs text-zinc-500">
        {disabled
          ? "Egna element läggs på en rutnätsskärm. Inbyggda skärmar fyller hela ytan: lägg till dem med + Ny skärm."
          : "Värden minst 12×4 rutor, diagram enligt typen (läsbart på 8–10 m). Diagrammen visar displayens standard-PLC."}
      </p>
    </div>
  );
}

export function Sidebar({ doc, displayId, layout }: { doc: Doc; displayId: string; layout: Layout }) {
  return (
    <aside className="flex w-72 shrink-0 flex-col overflow-y-auto border-r border-zinc-800 bg-zinc-900">
      <DisplaySettings doc={doc} displayId={displayId} layout={layout} />
      <ScreenList layout={layout} displayId={displayId} />
      <Palette displayId={displayId} layout={layout} />
    </aside>
  );
}
