/**
 * Where the editor gets its document from.
 * - Live (plant network): /api/editor on the backend, session cookie login (two local accounts).
 * - Demo (GitHub Pages): no login and no backend; documents bundled at build time with connection URLs
 *   replaced, simulated values only. The demo can never reach a PLC: it makes no requests at all.
 */
import { IS_DEMO } from "@/lib/env";
import { clearDemo, readDemo, readDemoDraft, writeDemo, writeDemoDraft, type DemoState } from "@/data/demoStore";
import { validateDocument } from "./validate";

export type Doc = Record<string, unknown>;

export interface Draft {
  document: Doc;
  base_version: number | null;
  author: string | null;
  /** UTC ISO time */
  saved: string;
  /** A newer version was published after the draft was started */
  stale: boolean;
}

export interface ServerProblem {
  path: (string | number)[];
  message: string;
}

export interface Validation {
  ok: boolean;
  problems: ServerProblem[];
  /** What today's backend can't run yet (several PLCs/displays until etapp 4) */
  runtime: string[];
}

export interface VersionInfo {
  id: number;
  /** UTC ISO time */
  created: string;
  author: string | null;
  source: string;
  comment: string | null;
  published: boolean;
}

/** Error from the backend with its HTTP status and detail (422: validation result) */
export class BackendError extends Error {
  constructor(
    message: string,
    public status: number,
    public detail?: unknown,
  ) {
    super(message);
  }
}

export interface Loaded {
  doc: Doc;
  /** Published version (null in the demo) */
  version: number | null;
}

export interface EditorBackend {
  demo: boolean;
  /** Logged-in user, null when not logged in (the demo is always "logged in" as demo) */
  session(): Promise<string | null>;
  /** Throws Error with a Swedish message */
  login(name: string, password: string): Promise<string>;
  logout(): Promise<void>;
  load(): Promise<Loaded>;
  loadDraft(): Promise<Draft | null>;
  saveDraft(doc: Doc, baseVersion: number | null): Promise<string>;
  discardDraft(): Promise<void>;
  validate(doc: Doc): Promise<Validation>;
  /** Throws BackendError (409: someone published since baseVersion; 422: invalid) */
  publish(doc: Doc, baseVersion: number | null, comment: string): Promise<{ version: number; restart_needed: boolean }>;
  versions(): Promise<VersionInfo[]>;
  version(id: number): Promise<Doc>;
  /** URL of a version as YAML (live), null in the demo (exported in the browser) */
  exportUrl(id: number): string | null;
  /** Demo only: forget everything stored in this browser */
  resetDemo?(): void;
}

const API = `${import.meta.env.BASE_URL}api/editor`;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    credentials: "same-origin",
    ...init,
    headers: { "Content-Type": "application/json", "X-Editor": "1", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    let detail: unknown;
    try {
      detail = (await res.json())?.detail;
      if (typeof detail === "string") message = detail;
      else if (detail && typeof (detail as { message?: unknown }).message === "string") message = (detail as { message: string }).message;
    } catch {
      /* not JSON */
    }
    throw new BackendError(message, res.status, detail);
  }
  return (await res.json()) as T;
}

function liveBackend(): EditorBackend {
  return {
    demo: false,
    async session() {
      try {
        return (await call<{ user: string }>("/session")).user;
      } catch (e) {
        if ((e as { status?: number }).status === 401) return null;
        throw e;
      }
    },
    async login(name, password) {
      return (await call<{ user: string }>("/login", { method: "POST", body: JSON.stringify({ name, password }) })).user;
    },
    async logout() {
      await call("/logout", { method: "POST" });
    },
    async load() {
      const r = await call<{ version: number; document: Doc }>("/document");
      return { doc: r.document, version: r.version };
    },
    loadDraft: async () => (await call<{ draft: Draft | null }>("/draft")).draft,
    saveDraft: async (doc, base) => (await call<{ saved: string }>("/draft", { method: "PUT", body: JSON.stringify({ document: doc, base_version: base }) })).saved,
    discardDraft: async () => {
      await call("/draft", { method: "DELETE" });
    },
    validate: (doc) => call<Validation>("/validate", { method: "POST", body: JSON.stringify({ document: doc }) }),
    publish: (doc, base, comment) =>
      call<{ version: number; restart_needed: boolean }>("/publish", { method: "POST", body: JSON.stringify({ document: doc, base_version: base, comment }) }),
    versions: async () => (await call<{ versions: VersionInfo[] }>("/versions")).versions,
    version: async (id) => (await call<{ document: Doc }>(`/versions/${id}`)).document,
    exportUrl: (id) => `${API}/versions/${id}/export.yaml`,
  };
}

function demoBackend(): EditorBackend {
  // Same ?layout= choice as the TV demo; the bundled documents are only part of the demo build
  const which = new URLSearchParams(window.location.search).get("layout");
  const now = () => new Date().toISOString().slice(0, 19) + "+00:00";
  const bundled = async (): Promise<Doc> => {
    const examples: Record<string, () => Promise<{ default: Doc }>> = {
      multi: () => import("../../../docs/examples/flera-displayer.yaml?doc"),
      stress: () => import("../../../docs/examples/stress.yaml?doc"),
      // Chart elements: the OEE and 7-day screens rebuilt from elements, and every element type
      "oee-element": () => import("../../../docs/examples/oee-element.yaml?doc"),
      "7dagar-element": () => import("../../../docs/examples/7dagar-element.yaml?doc"),
      diagram: () => import("../../../docs/examples/diagram.yaml?doc"),
    };
    const mod = await (examples[which ?? ""] ?? (() => import("../../../dashboard.yaml?doc")))();
    return structuredClone(mod.default);
  };
  /** Versions in localStorage; version 1 = the bundled example */
  const state = async (): Promise<DemoState> => {
    const s = readDemo(which);
    if (s) return s;
    const init: DemoState = { versions: [{ id: 1, created: now(), author: "demo", source: "yaml", comment: "exempeldokumentet", doc: await bundled() }], published: 1 };
    writeDemo(which, init);
    return init;
  };
  return {
    demo: true,
    session: async () => "demo",
    login: async () => "demo",
    logout: async () => {},
    async load() {
      const s = await state();
      return { doc: structuredClone(s.versions.find((v) => v.id === s.published)!.doc), version: s.published };
    },
    async loadDraft() {
      const d = readDemoDraft(which);
      return d ? { ...d, stale: d.base_version !== (await state()).published } : null;
    },
    async saveDraft(doc, base) {
      const saved = now();
      writeDemoDraft(which, { document: doc, base_version: base, author: "demo", saved });
      return saved;
    },
    discardDraft: async () => writeDemoDraft(which, null),
    // No backend: the browser's rules are the only check (the demo runs several PLCs/displays)
    validate: async (doc) => {
      const problems = validateDocument(doc).map((p) => ({ path: p.path, message: p.message }));
      return { ok: problems.length === 0, problems, runtime: [] };
    },
    async publish(doc, base, comment) {
      const s = await state();
      if (base !== s.published) throw new BackendError(`version ${s.published} har publicerats sedan du började – ladda om och gör ändringen igen`, 409);
      const problems = validateDocument(doc);
      if (problems.length) throw new BackendError("dokumentet går inte att publicera", 422, { problems, runtime: [] });
      const id = Math.max(...s.versions.map((v) => v.id)) + 1;
      writeDemo(which, { versions: [...s.versions, { id, created: now(), author: "demo", source: "editor", comment: comment.trim() || null, doc }], published: id });
      writeDemoDraft(which, null);
      return { version: id, restart_needed: false };
    },
    async versions() {
      const s = await state();
      return s.versions
        .map((v) => ({ id: v.id, created: v.created, author: v.author, source: v.source, comment: v.comment, published: v.id === s.published }))
        .reverse();
    },
    async version(id) {
      const v = (await state()).versions.find((x) => x.id === id);
      if (!v) throw new BackendError(`version ${id} finns inte`, 404);
      return structuredClone(v.doc);
    },
    exportUrl: () => null,
    resetDemo: () => clearDemo(which),
  };
}

export const backend: EditorBackend = IS_DEMO ? demoBackend() : liveBackend();
