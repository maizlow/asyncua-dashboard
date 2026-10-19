import { useEffect, useMemo, useState } from "react";
import { backend } from "./backend";
import { PublishDialog, VersionsDialog } from "./Publish";
import { exportDraft, fmtTime } from "./exportYaml";
import { Login } from "./Login";
import { Canvas } from "./Canvas";
import { Inspector } from "./Inspector";
import { Sidebar } from "./Sidebar";
import { onEditorKey } from "./actions";
import { AuditFrame } from "./AuditFrame";
import { ProblemsBar } from "./Problems";
import { collectIssues } from "./issues";
import { validateDocument } from "./validate";
import { displaysOf, previewLayout, useEditorStore } from "./store";


function TopBar({ user, onLogout }: { user: string; onLogout: () => void }) {
  const { doc, published, displayId, version, draftSaved, selectDisplay, past, future, undo, redo } = useEditorStore();
  const [dialog, setDialog] = useState<"publish" | "versions" | null>(null);
  const changed = useMemo(() => JSON.stringify(doc) !== JSON.stringify(published), [doc, published]);
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
      <div className="flex gap-1">
        <button data-testid="undo" title="Ångra (Ctrl+Z)" disabled={!past.length} onClick={undo} className="rounded-md border border-zinc-700 px-2 py-1 text-sm hover:bg-zinc-800 disabled:opacity-40">
          ↶ Ångra
        </button>
        <button data-testid="redo" title="Gör om (Ctrl+Y)" disabled={!future.length} onClick={redo} className="rounded-md border border-zinc-700 px-2 py-1 text-sm hover:bg-zinc-800 disabled:opacity-40">
          ↷ Gör om
        </button>
      </div>
      <span className="text-sm text-zinc-500" data-testid="changes">
        {changed
          ? `Ändrat, inte publicerat${draftSaved ? ` · utkast sparat ${fmtTime(draftSaved).slice(-5)}` : ""}`
          : version != null
            ? `Publicerad version ${version}`
            : "Inga ändringar"}
      </span>
      <div className="flex gap-1">
        <button data-testid="versions-open" onClick={() => setDialog("versions")} className="rounded-md border border-zinc-700 px-2 py-1 text-sm hover:bg-zinc-800">
          Versioner
        </button>
        <button data-testid="export-draft" title="Ladda ner utkastet som dashboard.yaml" onClick={() => doc && exportDraft(doc)} className="rounded-md border border-zinc-700 px-2 py-1 text-sm hover:bg-zinc-800">
          Exportera YAML
        </button>
        <button
          data-testid="publish-open"
          disabled={!changed}
          onClick={() => setDialog("publish")}
          className="rounded-md bg-sky-600 px-3 py-1 text-sm font-medium text-white hover:bg-sky-500 disabled:bg-zinc-700 disabled:text-zinc-400"
        >
          Publicera …
        </button>
      </div>
      {dialog === "publish" && <PublishDialog onClose={() => setDialog(null)} />}
      {dialog === "versions" && <VersionsDialog onClose={() => setDialog(null)} />}
      <a href={tvHref} target="_blank" rel="noreferrer" className="text-sm text-sky-400 hover:underline">
        Öppna TV-vyn ↗
      </a>
      <div className="ml-auto flex items-center gap-3 text-sm">
        {backend.demo ? (
          <>
            <span className="rounded-full bg-amber-500/90 px-3 py-1 font-medium text-black">DEMO · simulerade värden · når aldrig en PLC</span>
            <button
              data-testid="reset-demo"
              title="Glöm demoversioner och utkast i den här webbläsaren"
              onClick={() => {
                if (window.confirm("Återställa demon? Utkast och publicerade demoversioner i den här webbläsaren tas bort.")) {
                  backend.resetDemo?.();
                  window.location.reload();
                }
              }}
              className="rounded-md border border-zinc-700 px-3 py-1 hover:bg-zinc-800"
            >
              Återställ demo
            </button>
          </>
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

function Workspace({ user, onLogout }: { user: string; onLogout: () => void }) {
  const { doc, displayId, version, screenNr, audit, setAudit } = useEditorStore();
  const layout = useMemo(() => (doc && displayId ? previewLayout(doc, displayId, version) : null), [doc, displayId, version]);
  const problems = useMemo(() => (doc ? validateDocument(doc) : []), [doc]);
  const screen = layout?.screens.find((s) => s.nr === screenNr);
  const auditScreen = screen && screen.type === "grid" ? screen : null;
  useEffect(() => {
    if (!auditScreen) setAudit({});
  }, [auditScreen, setAudit]);
  const issues = useMemo(() => collectIssues(problems, audit, displayId, screenNr), [problems, audit, displayId, screenNr]);
  useDraftAutosave();
  useEffect(() => {
    window.addEventListener("keydown", onEditorKey);
    return () => window.removeEventListener("keydown", onEditorKey);
  }, []);
  if (!doc || !displayId || !layout) return null;
  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100">
      <TopBar user={user} onLogout={onLogout} />
      <div className="flex min-h-0 flex-1">
        <Sidebar doc={doc} displayId={displayId} layout={layout} />
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 p-6">
            <Canvas layout={layout} />
          </div>
          <ProblemsBar issues={issues} />
          <StatusLine />
        </main>
        <Inspector layout={layout} problems={problems} />
        {auditScreen && <AuditFrame layout={layout} screen={auditScreen} onResult={setAudit} />}
      </div>
    </div>
  );
}

/**
 * Saves the draft (server, or localStorage in the demo) a second after the last change; a draft
 * that equals the published version is removed. One draft is shared by the editor accounts.
 */
function useDraftAutosave() {
  const { doc, published, base, draftSaved, setDraftSaved, notify } = useEditorStore();
  useEffect(() => {
    if (!doc || !published) return;
    const changed = JSON.stringify(doc) !== JSON.stringify(published);
    if (!changed && !draftSaved) return;
    const t = setTimeout(() => {
      const op = changed ? backend.saveDraft(doc, base) : backend.discardDraft().then(() => null);
      op.then(
        (saved) => setDraftSaved(saved),
        (e: Error & { status?: number }) =>
          notify(
            e.status === 401 ? "Inloggningen har gått ut – ladda om sidan och logga in igen. Osparade ändringar försvinner." : `Utkastet kunde inte sparas: ${e.message}`,
            "error",
          ),
      );
    }, 1000);
    return () => clearTimeout(t);
    // draftSaved is left out on purpose: saving must not trigger another save
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, published, base, setDraftSaved, notify]);
}

function StatusLine() {
  const notice = useEditorStore((s) => s.notice);
  return (
    <div
      data-testid="notice"
      className={`h-8 shrink-0 truncate border-t border-zinc-800 px-4 py-1.5 text-sm ${notice?.kind === "error" ? "text-red-300" : "text-zinc-400"}`}
    >
      {notice?.text ?? "Dra element från paletten, dra för att flytta, hörnet för att ändra storlek."}
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
    (async () => {
      const { doc, version } = await backend.load();
      setLoaded(doc, version);
      const draft = await backend.loadDraft();
      if (!draft) return;
      const st = useEditorStore.getState();
      st.resumeDraft(draft.document, draft.base_version, draft.saved);
      st.notify(
        draft.stale
          ? `Utkastet (sparat ${fmtTime(draft.saved)}${draft.author ? ` av ${draft.author}` : ""}) bygger på version ${draft.base_version ?? "–"}, men version ${version} har publicerats sedan dess. Kontrollera innan du publicerar.`
          : `Fortsätter på utkastet sparat ${fmtTime(draft.saved)}${draft.author ? ` av ${draft.author}` : ""}.`,
        draft.stale ? "error" : "info",
      );
    })().catch((e: Error) => setError(`Kunde inte läsa layouten: ${e.message}`));
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
