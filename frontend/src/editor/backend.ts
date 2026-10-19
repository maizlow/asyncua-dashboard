/**
 * Where the editor gets its document from.
 * - Live (plant network): /api/editor on the backend, session cookie login (two local accounts).
 * - Demo (GitHub Pages): no login and no backend; documents bundled at build time with connection URLs
 *   replaced, simulated values only. The demo can never reach a PLC: it makes no requests at all.
 */
import { IS_DEMO } from "@/lib/env";

export type Doc = Record<string, unknown>;

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
}

const API = `${import.meta.env.BASE_URL}api/editor`;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    credentials: "same-origin",
    ...init,
    headers: { "Content-Type": "application/json", "X-Editor": "1", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (typeof body?.detail === "string") detail = body.detail;
    } catch {
      /* not JSON */
    }
    throw Object.assign(new Error(detail), { status: res.status });
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
  };
}

function demoBackend(): EditorBackend {
  return {
    demo: true,
    session: async () => "demo",
    login: async () => "demo",
    logout: async () => {},
    async load() {
      // Same ?layout= choice as the TV demo; the bundled documents are only part of the demo build
      const which = new URLSearchParams(window.location.search).get("layout");
      const mod =
        which === "multi"
          ? await import("../../../docs/examples/flera-displayer.yaml?doc")
          : which === "stress"
            ? await import("../../../docs/examples/stress.yaml?doc")
            : await import("../../../dashboard.yaml?doc");
      return { doc: structuredClone(mod.default), version: null };
    },
  };
}

export const backend: EditorBackend = IS_DEMO ? demoBackend() : liveBackend();
