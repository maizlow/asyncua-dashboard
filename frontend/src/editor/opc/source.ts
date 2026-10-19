/**
 * Where the browser gets the address space from: the backend (/api/editor/opcua, read-only, behind
 * the login) or, in the demo build, the fake S7-1500 space (fake.ts) without any network.
 */
import { IS_DEMO } from "@/lib/env";
import { buildSpace, fakeBrowse, fakeRead, fakeSearch, OpcError, type FakeConnection } from "./fake";
import type { BrowseResult, OpcNode, ReadResult, SearchResult } from "./types";

export { OpcError };

export interface OpcSource {
  demo: boolean;
  browse(cid: string, node?: string, limit?: number): Promise<BrowseResult>;
  read(cid: string, node: string): Promise<ReadResult>;
  search(cid: string, q: string, root?: string): Promise<SearchResult>;
}

const API = `${import.meta.env.BASE_URL}api/editor/opcua`;

async function get<T>(path: string, params: Record<string, string | number | undefined>): Promise<T> {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][]).toString();
  let res: Response;
  try {
    res = await fetch(`${API}${path}${qs ? `?${qs}` : ""}`, { credentials: "same-origin" });
  } catch {
    throw new OpcError("Kan inte nå editorns server.", 0);
  }
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const d = (await res.json())?.detail;
      if (typeof d === "string") message = d;
      else if (Array.isArray(d) && d[0]?.msg) message = `Ogiltig fråga: ${d[0].msg}`;
    } catch {
      /* not JSON */
    }
    if (res.status === 401) message = "Inloggningen har gått ut – ladda om sidan och logga in igen.";
    throw new OpcError(message, res.status);
  }
  return res.json() as Promise<T>;
}

function liveSource(): OpcSource {
  const e = encodeURIComponent;
  return {
    demo: false,
    browse: (cid, node, limit) => get(`/${e(cid)}/browse`, { node, limit }),
    read: (cid, node) => get(`/${e(cid)}/read`, { node }),
    search: (cid, q, root) => get(`/${e(cid)}/search`, { q, root }),
  };
}

function demoSource(connections: () => Record<string, FakeConnection>): OpcSource {
  const spaces = new Map<string, ReturnType<typeof buildSpace>>();
  const space = (cid: string) => {
    const conn = connections()[cid];
    if (!conn) throw new OpcError(`PLC:n '${cid}' finns inte i layouten.`, 404);
    const key = `${cid}|${Object.keys(conn.tags ?? {}).join(",")}`; // rebuilt when the tags change
    let s = spaces.get(key);
    if (!s) spaces.set(key, (s = buildSpace(cid, conn)));
    return s;
  };
  // A little latency, like a real PLC, so loading states are visible
  const later = <T>(fn: () => T) =>
    new Promise<T>((resolve, reject) =>
      setTimeout(() => {
        try {
          resolve(fn());
        } catch (err) {
          reject(err);
        }
      }, 120),
    );
  return {
    demo: true,
    browse: (cid, node, limit) => later(() => fakeBrowse(space(cid), cid, node, limit)),
    read: (cid, node) => later(() => fakeRead(space(cid), cid, node)),
    search: (cid, q, root) => later(() => fakeSearch(space(cid), cid, q, root)),
  };
}

let demoConnections: () => Record<string, FakeConnection> = () => ({});

/** Demo: where the fake space reads the PLC list from (the editor's document) */
export function setDemoConnections(fn: () => Record<string, FakeConnection>) {
  demoConnections = fn;
}

export const opcSource: OpcSource = IS_DEMO ? demoSource(() => demoConnections()) : liveSource();

/**
 * Data types of nodes seen while browsing (this browser session), so the props panel can warn about
 * a type that doesn't fit the element after the browser is closed. Key: `${cid}|${node id}`.
 */
export const seenTypes = new Map<string, Pick<OpcNode, "data_type" | "array">>();

export function remember(cid: string, nodes: OpcNode[]) {
  for (const n of nodes) if (n.node_class === "Variable") seenTypes.set(`${cid}|${n.node_id}`, { data_type: n.data_type, array: n.array });
}
