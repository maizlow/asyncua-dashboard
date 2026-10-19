import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { backend, BackendError, type Doc, type ServerProblem, type Validation, type VersionInfo } from "./backend";
import { AuditFrame } from "./AuditFrame";
import type { ItemAudit } from "./audit";
import type { Issue } from "./issues";
import { pathText, validateDocument } from "./validate";
import { docYaml, download, fmtTime } from "./exportYaml";
import { displaysOf, previewLayout, useEditorStore } from "./store";

function Modal({ title, testid, onClose, children }: { title: string; testid: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onMouseDown={onClose}>
      <div
        data-testid={testid}
        role="dialog"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-[720px] flex-col rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl"
      >
        <div className="flex items-center border-b border-zinc-800 px-5 py-3">
          <h2 className="font-semibold">{title}</h2>
          <button onClick={onClose} className="ml-auto text-zinc-400 hover:text-zinc-100" aria-label="Stäng">
            ✕
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto px-5 py-4 text-sm">{children}</div>
      </div>
    </div>
  );
}

/**
 * Legibility audit of every grid screen on every display, one at a time off-screen (the same
 * AuditFrame as the live check). Built-in screens are covered by the fit check in CI.
 */
function FullAudit({ doc, version, onDone }: { doc: Doc; version: number | null; onDone: (issues: Issue[]) => void }) {
  const jobs = useMemo(() => {
    const out: { did: string; layout: ReturnType<typeof previewLayout>; nr: number }[] = [];
    for (const did of Object.keys(displaysOf(doc))) {
      const layout = previewLayout(doc, did, version);
      for (const s of layout.screens) if (s.type === "grid") out.push({ did, layout, nr: s.nr });
    }
    return out;
  }, [doc, version]);
  const [idx, setIdx] = useState(0);
  const [found, setFound] = useState<Issue[]>([]);
  const job = jobs[idx];
  useEffect(() => {
    if (idx >= jobs.length) onDone(found);
  }, [idx, jobs.length, found, onDone]);
  const onResult = useCallback(
    (r: Record<string, ItemAudit>) => {
      if (!job) return;
      const add: Issue[] = [];
      for (const a of Object.values(r))
        for (const m of a.messages) add.push({ level: m.level, text: m.text, where: `${job.did} → skärm ${job.nr} → ${a.id}`, display: job.did, screen: job.nr, item: a.id });
      setFound((f) => [...f, ...add]);
      setIdx((i) => i + 1);
    },
    [job],
  );
  if (!job) return null;
  const screen = job.layout.screens.find((s) => s.nr === job.nr)!;
  return <AuditFrame key={`${job.did}-${job.nr}`} layout={job.layout} screen={screen} onResult={onResult} />;
}

function IssueList({ issues, onPick }: { issues: Issue[]; onPick: (i: Issue) => void }) {
  return (
    <ul className="mt-2 space-y-1" data-testid="publish-issues">
      {issues.map((i, n) => (
        <li key={n}>
          <button onClick={() => onPick(i)} className="flex w-full gap-2 rounded px-2 py-1 text-left hover:bg-zinc-800">
            <span className={i.level === "error" ? "text-red-300" : "text-amber-300"}>{i.level === "error" ? "✖" : "⚠"}</span>
            <span>{i.text}</span>
            <span className="ml-auto truncate font-mono text-xs text-zinc-500">{i.where}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

const serverIssues = (v: { problems?: ServerProblem[]; runtime?: string[] }): Issue[] => [
  ...(v.problems ?? []).map((p) => ({ level: "error" as const, text: p.message, where: pathText(p.path) })),
  ...(v.runtime ?? []).map((t) => ({ level: "error" as const, text: t, where: "backend (etapp 4)" })),
];

export function PublishDialog({ onClose }: { onClose: () => void }) {
  const { doc, version, base, setPublished, notify, selectDisplay, selectScreen, select } = useEditorStore();
  const [snapshot] = useState(() => structuredClone(doc!));
  const clientProblems = useMemo(() => validateDocument(snapshot), [snapshot]);
  const [audit, setAudit] = useState<Issue[] | null>(clientProblems.length ? [] : null);
  const [server, setServer] = useState<Validation | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<number | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (clientProblems.length) return;
    backend.validate(snapshot).then(setServer, (e: Error) => setServerError(e.message));
  }, [snapshot, clientProblems.length]);

  const issues: Issue[] = [
    ...clientProblems.map((p) => ({ level: "error" as const, text: p.message, where: pathText(p.path), display: p.display, screen: p.screen, item: p.item })),
    ...(server ? serverIssues(server) : []),
    ...(audit ?? []),
  ];
  const errors = issues.filter((i) => i.level === "error").length;
  const checking = !clientProblems.length && (audit === null || (server === null && serverError === null));

  const pick = (i: Issue) => {
    if (i.display) selectDisplay(i.display);
    if (i.screen !== undefined) selectScreen(i.screen);
    if (i.item) select(i.item);
    onClose();
  };

  const publish = async (over: number | null) => {
    setBusy(true);
    setFailed(null);
    try {
      const r = await backend.publish(snapshot, over ?? base, comment);
      if (JSON.stringify(useEditorStore.getState().doc) === JSON.stringify(snapshot)) setPublished(r.version);
      notify(
        r.restart_needed
          ? `Publicerad som version ${r.version}. Nya eller ändrade taggar: starta om backend för att läsa dem (till etapp 4).`
          : `Publicerad som version ${r.version}. TV:n visar den inom några sekunder.`,
      );
      onClose();
    } catch (e) {
      if (e instanceof BackendError && e.status === 409) {
        const latest = (await backend.versions().catch(() => [] as VersionInfo[])).find((v) => v.published)?.id ?? null;
        setConflict(latest);
        setFailed(e.message);
      } else if (e instanceof BackendError && e.status === 422 && e.detail && typeof e.detail === "object") {
        setServer({ ok: false, problems: [], runtime: [], ...(e.detail as Partial<Validation>) });
        setFailed(e.message);
      } else setFailed((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Publicera" testid="publish-dialog" onClose={onClose}>
      {audit === null && <FullAudit doc={snapshot} version={version} onDone={setAudit} />}
      {checking ? (
        <p className="text-zinc-400" data-testid="publish-checking">
          Kontrollerar alla skärmar med värsta tänkbara värden …
        </p>
      ) : (
        <>
          <p data-testid="publish-summary" className={errors ? "text-red-300" : "text-emerald-300"}>
            {errors
              ? `✖ ${errors} fel måste rättas innan du kan publicera.`
              : `✔ Inga fel${issues.length ? ` · ${issues.length} ${issues.length === 1 ? "varning" : "varningar"} (kan publiceras)` : ""}.`}
          </p>
          {serverError && <p className="mt-2 text-red-300">Servern kunde inte kontrollera dokumentet: {serverError}</p>}
          {issues.length > 0 && <IssueList issues={issues} onPick={pick} />}
          {!errors && !serverError && (
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="text-zinc-400">Kommentar (visas i versionslistan)</span>
                <input
                  data-testid="publish-comment"
                  autoFocus
                  value={comment}
                  maxLength={200}
                  onChange={(e) => setComment(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !busy && void publish(null)}
                  placeholder="t.ex. Ny skärm för packlinjen"
                  className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2"
                />
              </label>
              <p className="text-zinc-500">
                {backend.demo
                  ? "Demo: versionen sparas bara i den här webbläsaren. Öppna TV-vyn i en annan flik för att se den."
                  : "Den nya versionen ersätter den publicerade direkt; TV:n laddar om layouten. Äldre versioner finns kvar under Versioner."}
              </p>
              {failed && (
                <p className="text-red-300" data-testid="publish-error">
                  {failed}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  data-testid="publish-confirm"
                  disabled={busy}
                  onClick={() => void publish(null)}
                  className="rounded-md bg-sky-600 px-4 py-2 font-medium text-white hover:bg-sky-500 disabled:opacity-50"
                >
                  Publicera version
                </button>
                {conflict !== null && (
                  <button
                    data-testid="publish-override"
                    disabled={busy}
                    onClick={() => void publish(conflict)}
                    className="rounded-md border border-red-400 px-4 py-2 text-red-200 hover:bg-red-950"
                  >
                    Publicera ändå (ersätter version {conflict})
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

const SOURCE: Record<string, string> = { yaml: "dashboard.yaml", editor: "editorn" };

export function VersionsDialog({ onClose }: { onClose: () => void }) {
  const { edit, notify } = useEditorStore();
  const [list, setList] = useState<VersionInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    backend.versions().then(setList, (e: Error) => setError(e.message));
  }, []);

  const restore = async (v: VersionInfo) => {
    try {
      const doc = await backend.version(v.id);
      if (
        edit((d) => {
          for (const k of Object.keys(d)) delete d[k];
          Object.assign(d, doc);
        })
      )
        notify(`Version ${v.id} är inläst som utkast. Publicera för att återställa den (Ångra tar tillbaka ditt utkast).`);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const exportVersion = async (v: VersionInfo) => {
    const url = backend.exportUrl(v.id);
    if (url) {
      const a = Object.assign(document.createElement("a"), { href: url, download: `layout-v${v.id}.yaml` });
      document.body.append(a);
      a.click();
      a.remove();
    } else download(`layout-v${v.id}.yaml`, docYaml(await backend.version(v.id), `Version ${v.id} från layout-editorn (demo)`));
  };

  return (
    <Modal title="Versioner" testid="versions-dialog" onClose={onClose}>
      {error && <p className="text-red-300">{error}</p>}
      {!list && !error && <p className="text-zinc-400">Läser …</p>}
      {list && (
        <table className="w-full text-left">
          <thead className="text-zinc-500">
            <tr>
              <th className="py-1 pr-3 font-normal">Version</th>
              <th className="pr-3 font-normal">Tid</th>
              <th className="pr-3 font-normal">Av</th>
              <th className="pr-3 font-normal">Kommentar</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((v) => (
              <tr key={v.id} data-testid={`version-${v.id}`} className="border-t border-zinc-800 align-top">
                <td className="py-2 pr-3 font-mono">
                  {v.id}
                  {v.published && <span className="ml-2 rounded bg-emerald-700 px-1.5 py-0.5 font-sans text-xs text-white">publicerad</span>}
                </td>
                <td className="py-2 pr-3 whitespace-nowrap text-zinc-300">{fmtTime(v.created)}</td>
                <td className="py-2 pr-3 text-zinc-300">{v.author ?? SOURCE[v.source] ?? v.source}</td>
                <td className="py-2 pr-3 text-zinc-300">{v.comment ?? <span className="text-zinc-600">–</span>}</td>
                <td className="py-2 whitespace-nowrap">
                  <button data-testid={`restore-${v.id}`} onClick={() => void restore(v)} className="rounded border border-zinc-700 px-2 py-0.5 hover:bg-zinc-800">
                    Öppna som utkast
                  </button>
                  <button data-testid={`export-${v.id}`} onClick={() => void exportVersion(v)} className="ml-1 rounded border border-zinc-700 px-2 py-0.5 hover:bg-zinc-800">
                    YAML
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
