/**
 * The document rules in the browser, mirroring backend/layout_doc.py (document_problems) so the editor
 * shows problems while editing, and the demo editor (no backend) can still refuse to publish. The live
 * editor validates on the server too before publishing; the server is authoritative.
 */
import { BUILTIN_KINDS, GRID_COLS, GRID_ROWS, splitRef } from "@/layout/doc";
import type { Doc } from "./backend";
import { MIN_H, MIN_W, overlaps, type Screen, type Widget } from "./ops";

export interface Problem {
  /** Path in the document, e.g. ["displays", "tv1", "screens", "2", "items", 0, "tag"] */
  path: (string | number)[];
  message: string;
  display?: string;
  screen?: number;
  item?: string;
}

export const MAX_LABEL = 20;
export const MAX_UNIT = 6;
export const MAX_STATE_TEXT = 10;
const SHIFT_TAGS = ["ShiftStart", "ShiftEnd", "ProductionState"];
const NEED: Record<string, string[]> = { shift: SHIFT_TAGS, week: SHIFT_TAGS, oee: [...SHIFT_TAGS, "TPM"], highscore: ["ProductionState"] };
const VALUE_FIELDS = ["label", "tag", "unit", "decimals", "target", "trend", "color", "thresholds", "better", "states"];
export const TAG_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** "→"-joined path like the backend's messages */
export const pathText = (p: (string | number)[]) => p.join(" → ");

function lev(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1));
      prev = t;
    }
  }
  return d[b.length];
}

export function suggest(word: string, options: Iterable<string>): string {
  let best: string | null = null;
  let bestD = Infinity;
  for (const o of options) {
    const dd = lev(word, o);
    if (dd < bestD) [best, bestD] = [o, dd];
  }
  return best !== null && bestD <= Math.max(2, Math.floor(word.length / 3)) ? ` (menade du '${best}'?)` : "";
}

export function validateDocument(doc: Doc): Problem[] {
  const out: Problem[] = [];
  const conns = (isObj(doc.connections) ? doc.connections : {}) as Record<string, Doc>;
  const connIds = Object.keys(conns);
  const tagsOf = (c: string) => Object.keys(isObj(conns[c]?.tags) ? (conns[c].tags as object) : {});
  const ids = new Map<string, string>();
  if (!connIds.length) out.push({ path: ["connections"], message: "minst en anslutning (PLC) behövs" });

  for (const [did, d] of Object.entries((doc.displays ?? {}) as Record<string, Doc>)) {
    const base = ["displays", did];
    const def = (d.default_connection as string | undefined) ?? (connIds.length === 1 ? connIds[0] : null);
    const conn = (cid: unknown, path: (string | number)[], extra: Partial<Problem> = {}) => {
      if (typeof cid !== "string" || !conns[cid]) out.push({ path, message: `okänd anslutning '${String(cid)}'${suggest(String(cid), connIds)}`, display: did, ...extra });
    };
    if (d.default_connection !== undefined) conn(d.default_connection, [...base, "default_connection"]);
    const sc = (d.screen ?? {}) as Doc;
    conn(sc.connection, [...base, "screen", "connection"]);
    const ref = (r: string, path: (string | number)[], extra: Partial<Problem>) => {
      const [cid, name] = splitRef(r, def);
      if (cid === null) out.push({ path, message: `ange anslutningen, t.ex. '${connIds[0] ?? "plc1"}.${name}' (eller standard-PLC på displayen)`, ...extra });
      else if (!conns[cid]) out.push({ path, message: `okänd anslutning '${cid}'${suggest(cid, connIds)}`, ...extra });
      else if (!tagsOf(cid).includes(name)) out.push({ path, message: `okänd tagg '${name}' i ${cid}${suggest(name, tagsOf(cid))}`, ...extra });
    };

    const screens = (d.screens ?? {}) as Record<string, Screen>;
    if (!Object.keys(screens).length) out.push({ path: [...base, "screens"], message: "displayen har inga skärmar", display: did });
    for (const [nrText, s] of Object.entries(screens)) {
      const nr = Number(nrText);
      const sp = [...base, "screens", nrText];
      const items = s.items ?? [];
      if (!(nr >= 1 && nr <= 99)) out.push({ path: sp, message: "skärmnumret måste vara 1–99", display: did, screen: nr });
      if (!items.length) out.push({ path: [...sp, "items"], message: "skärmen har inga objekt", display: did, screen: nr });
      items.forEach((w: Widget, i) => {
        const lp = [...sp, "items", i];
        const at: Partial<Problem> = { display: did, screen: nr, item: w.id };
        const p = (path: (string | number)[], message: string) => out.push({ path, message, ...at });
        if (ids.has(w.id)) p([...lp, "id"], `id '${w.id}' finns redan`);
        ids.set(w.id, did);
        if (w.x < 0 || w.y < 0 || w.x + w.w > GRID_COLS || w.y + w.h > GRID_ROWS) p(lp, `utanför rutnätet ${GRID_COLS}×${GRID_ROWS}`);
        items.slice(0, i).forEach((o, j) => overlaps(w, o) && p(lp, `överlappar objekt ${j + 1} ('${o.id}')`));
        if ((BUILTIN_KINDS as readonly string[]).includes(w.kind)) {
          const extra = VALUE_FIELDS.filter((f) => w[f] !== undefined && w[f] !== null);
          if (extra.length) p(lp, `'${w.kind}' har inga egna fält – ta bort ${extra.join(", ")}`);
          if (w.x || w.y || w.w !== GRID_COLS || w.h !== GRID_ROWS || items.length > 1)
            p(lp, `'${w.kind}': ${w.kind === "alarms" ? "larm visas alltid i helskärm" : "visas i helskärm tills mindre storlekar stöds (etapp 6)"}`);
          if (!w.connection) p([...lp, "connection"], `'${w.kind}' behöver connection (vilken PLC/linje den visar)`);
          else if (!conns[w.connection]) p([...lp, "connection"], `okänd anslutning '${w.connection}'${suggest(w.connection, connIds)}`);
          else {
            const have = tagsOf(w.connection);
            const missing = (NEED[w.kind] ?? []).filter((t) => !have.includes(t));
            if (missing.length) p([...lp, "kind"], `'${w.kind}' kräver taggarna ${missing.join(", ")} i ${w.connection}`);
            if ((w.kind === "oee" || w.kind === "week") && !have.includes("GoodCount") && !have.includes("ProductionCount"))
              p([...lp, "kind"], `'${w.kind}' kräver taggen GoodCount eller ProductionCount i ${w.connection}`);
          }
          return;
        }
        if (w.connection !== undefined) p([...lp, "connection"], "connection används bara på inbyggda skärmar – skriv anslutningen i taggen (plc1.OEE)");
        if (!w.label) p([...lp, "label"], "saknas (obligatorisk)");
        else if (String(w.label).length > MAX_LABEL) p([...lp, "label"], `högst ${MAX_LABEL} tecken`);
        if (!w.tag) p([...lp, "tag"], "saknas (obligatorisk)");
        else ref(w.tag, [...lp, "tag"], at);
        if (typeof w.unit === "string" && w.unit.length > MAX_UNIT) p([...lp, "unit"], `högst ${MAX_UNIT} tecken`);
        if (w.w < MIN_W || w.h < MIN_H) p(lp, `för liten ruta ${w.w}×${w.h} (minst ${MIN_W}×${MIN_H})`);
        if (typeof w.target === "string") ref(w.target, [...lp, "target"], at);
        const th = w.thresholds as number[] | undefined;
        if (th && (th.length !== 2 || th.some((x) => typeof x !== "number" || Number.isNaN(x)))) p([...lp, "thresholds"], "två tal: [varning, bra]");
        else if (th && th[0] > th[1]) p([...lp, "thresholds"], "skriv [varning, bra] med det lägre värdet först");
        const states = w.states as Record<string, { text?: string }> | undefined;
        if (w.kind === "status" && (!states || !Object.keys(states).length)) p([...lp, "states"], "status-objekt behöver tillstånd (PLC-värde → text och färg)");
        if (w.kind !== "status" && states) p([...lp, "states"], "tillstånd används bara med status");
        for (const [k, st] of Object.entries(states ?? {})) {
          if (!/^-?\d+$/.test(k)) p([...lp, "states", k], "PLC-värdet måste vara ett heltal");
          if (!st?.text) p([...lp, "states", k, "text"], "saknas (obligatorisk)");
          else if (st.text.length > MAX_STATE_TEXT) p([...lp, "states", k, "text"], `högst ${MAX_STATE_TEXT} tecken`);
        }
        if ((w.kind === "time" || w.kind === "status") && (w.target !== undefined || w.trend || w.thresholds))
          p(lp, `${w.kind === "time" ? "tid" : "status"} stöder inte mål, trend eller gränser`);
      });
    }
  }
  return out;
}
