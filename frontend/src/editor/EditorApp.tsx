import { useEffect, useMemo, useState } from "react";
import { backend, type Doc } from "./backend";
import { Login } from "./Login";
import { ScaledBox, TvPreview } from "./TvPreview";
import { BUILTIN_NAMES, TYPE_NAMES } from "./names";
import { displaysOf, previewLayout, useEditorStore } from "./store";
import type { Layout, ScreenConfig } from "@/layout/layout";


function screenSummary(s: ScreenConfig): string {
  if (s.type !== "grid") return `Inbyggd: ${BUILTIN_NAMES[s.type] ?? s.type}${s.connection ? ` · ${s.connection}` : ""}`;
  return s.items.length === 1 ? "1 element" : `${s.items.length} element`;
}

function screenName(s: ScreenConfig): string {
  return s.title ?? (s.type === "grid" ? "Rutnät" : (BUILTIN_NAMES[s.type] ?? s.type));
}

function TopBar({ user, onLogout }: { user: string; onLogout: () => void }) {
  const { doc, displayId, version, selectDisplay } = useEditorStore();
  const displays = displaysOf(doc);
  const layoutParam = new URLSearchParams(window.location.search).get("layout");
  const tvHref = `${import.meta.env.BASE_URL}?display=${displayId ?? ""}${backend.demo && layoutParam ? `&layout=${layoutParam}` : ""}`;
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-zinc-800 bg-zinc-900 px-4">
      <span className="font-semibold">Layout-editor</span>
      <label className="flex items-center gap-2 text-sm text-zinc-400">
        Display
        <select
          data-testid="display-select"
          value={displayId ?? ""}
          onChange={(e) => selectDisplay(e.target.value)}
          className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-100"
        >
          {Object.entries(displays).map(([id, d]) => (
            <option key={id} value={id}>
              {(d.name as string | undefined) ? `${d.name as string} (${id})` : id}
            </option>
          ))}
        </select>
      </label>
      <span className="text-sm text-zinc-500">{version != null ? `Publicerad version ${version}` : null}</span>
      <a href={tvHref} target="_blank" rel="noreferrer" className="text-sm text-sky-400 hover:underline">
        Öppna TV-vyn ↗
      </a>
      <div className="ml-auto flex items-center gap-3 text-sm">
        {backend.demo ? (
          <span className="rounded-full bg-amber-500/90 px-3 py-1 font-medium text-black">
            DEMO · simulerade värden · når aldrig en PLC
          </span>
        ) : (
          <>
            <span className="text-zinc-400">Inloggad som {user}</span>
            <button onClick={onLogout} className="rounded-md border border-zinc-700 px-3 py-1 hover:bg-zinc-800">
              Logga ut
            </button>
          </>
        )}
      </div>
    </header>
  );
}

function DisplayInfo({ doc, displayId, layout }: { doc: Doc; displayId: string; layout: Layout }) {
  const d = displaysOf(doc)[displayId] ?? {};
  const pool = (doc.connections ?? {}) as Record<string, { name?: string }>;
  const screen = (d.screen ?? {}) as { connection?: string };
  const def = (d.default_connection as string | undefined) ?? (Object.keys(pool).length === 1 ? Object.keys(pool)[0] : undefined);
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
      <div className="text-zinc-500">
        Standard-PLC: <span className="font-mono text-zinc-300">{def ?? "–"}</span> · skärmväxling:{" "}
        <span className="font-mono text-zinc-300">{screen.connection ?? "–"}</span>
      </div>
    </div>
  );
}

function ScreenList({ layout }: { layout: Layout }) {
  const { screenNr, selectScreen } = useEditorStore();
  return (
    <nav className="min-h-0 flex-1 overflow-y-auto p-2" aria-label="Skärmar">
      <div className="px-2 pb-2 pt-1 text-xs font-medium uppercase tracking-wide text-zinc-500">Skärmar</div>
      {layout.screens.map((s) => (
        <button
          key={s.nr}
          data-testid={`screen-${s.nr}`}
          onClick={() => selectScreen(s.nr)}
          className={`mb-1 flex w-full items-center gap-3 rounded-md px-2 py-2 text-left ${
            s.nr === screenNr ? "bg-sky-900/50 ring-1 ring-sky-700" : "hover:bg-zinc-800"
          }`}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-zinc-800 font-mono text-sm" title="ActiveScreenNr">
            {s.nr}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm text-zinc-100">{screenName(s)}</span>
            <span className="block truncate text-xs text-zinc-500">{screenSummary(s)}</span>
          </span>
        </button>
      ))}
    </nav>
  );
}

function ScreenDetails({ layout, screenNr }: { layout: Layout; screenNr: number | null }) {
  const s = layout.screens.find((x) => x.nr === screenNr);
  if (!s) return null;
  return (
    <div className="space-y-3 p-4 text-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Skärm {s.nr}</div>
      {s.type !== "grid" ? (
        <p className="text-zinc-300">
          Inbyggd skärm <b>{BUILTIN_NAMES[s.type]}</b> från <span className="font-mono">{s.connection}</span>. Fyller hela ytan.
        </p>
      ) : (
        <ul className="space-y-2">
          {s.items.map((it) => (
            <li key={it.id} className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2">
              <div className="truncate text-zinc-100">{it.label}</div>
              <div className="truncate font-mono text-xs text-zinc-500">
                {TYPE_NAMES[it.type] ?? it.type} · {it.tag} · {it.w}×{it.h} @ {it.x},{it.y}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-zinc-500">Redigering kommer i nästa steg (etapp 2b–d).</p>
    </div>
  );
}

function Workspace({ user, onLogout }: { user: string; onLogout: () => void }) {
  const { doc, displayId, version, screenNr } = useEditorStore();
  const layout = useMemo(() => (doc && displayId ? previewLayout(doc, displayId, version) : null), [doc, displayId, version]);
  if (!doc || !displayId || !layout) return null;
  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100">
      <TopBar user={user} onLogout={onLogout} />
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-800 bg-zinc-900">
          <DisplayInfo doc={doc} displayId={displayId} layout={layout} />
          <ScreenList layout={layout} />
        </aside>
        <main className="min-w-0 flex-1 p-6">
          <ScaledBox>
            <TvPreview layout={layout} screenNr={screenNr} />
          </ScaledBox>
        </main>
        <aside className="w-80 shrink-0 overflow-y-auto border-l border-zinc-800 bg-zinc-900">
          <ScreenDetails layout={layout} screenNr={screenNr} />
        </aside>
      </div>
    </div>
  );
}

export function EditorApp() {
  const [user, setUser] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const setLoaded = useEditorStore((s) => s.setLoaded);

  useEffect(() => {
    backend.session().then(setUser, (e: Error) => setError(`Kan inte nå servern: ${e.message}`));
  }, []);

  useEffect(() => {
    if (!user) return;
    backend.load().then(
      ({ doc, version }) => setLoaded(doc, version),
      (e: Error) => setError(`Kunde inte läsa layouten: ${e.message}`),
    );
  }, [user, setLoaded]);

  const logout = async () => {
    await backend.logout().catch(() => {});
    setUser(null);
  };

  if (error) return <div className="flex h-screen items-center justify-center bg-zinc-950 text-red-300">{error}</div>;
  if (user === undefined) return <div className="h-screen bg-zinc-950" />;
  if (user === null) return <Login onLogin={setUser} />;
  return <Workspace user={user} onLogout={logout} />;
}
