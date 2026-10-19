/**
 * The demo editor's storage (GitHub Pages: no backend): versions, the published version and the
 * draft in localStorage, one entry per example document (?layout=). The TV demo in the same browser
 * shows the published demo version, and reloads when it changes. Nothing leaves the browser.
 */
export type Doc = Record<string, unknown>;

export interface DemoVersion {
  id: number;
  created: string;
  author: string;
  source: "yaml" | "editor";
  comment: string | null;
  doc: Doc;
}

export interface DemoState {
  versions: DemoVersion[];
  published: number;
}

export interface DemoDraft {
  document: Doc;
  base_version: number | null;
  author: string;
  saved: string;
}

/** Versions + published (the TV demo reloads when this changes) */
export const demoKey = (layout: string | null) => `aud-demo-layout:${layout || "dashboard"}`;
/** The draft, in its own key so autosaving doesn't reload the TV demo */
const draftKey = (layout: string | null) => `aud-demo-draft:${layout || "dashboard"}`;

export function readDemoDraft(layout: string | null): DemoDraft | null {
  try {
    const raw = localStorage.getItem(draftKey(layout));
    return raw ? (JSON.parse(raw) as DemoDraft) : null;
  } catch {
    return null;
  }
}

export function writeDemoDraft(layout: string | null, draft: DemoDraft | null) {
  if (draft) localStorage.setItem(draftKey(layout), JSON.stringify(draft));
  else localStorage.removeItem(draftKey(layout));
}

export function readDemo(layout: string | null): DemoState | null {
  try {
    const raw = localStorage.getItem(demoKey(layout));
    return raw ? (JSON.parse(raw) as DemoState) : null;
  } catch {
    return null;
  }
}

export function writeDemo(layout: string | null, state: DemoState) {
  localStorage.setItem(demoKey(layout), JSON.stringify(state));
}

export function clearDemo(layout: string | null) {
  localStorage.removeItem(demoKey(layout));
  localStorage.removeItem(draftKey(layout));
}

/** The published demo document, if the demo editor has published one */
export function publishedDemoDoc(layout: string | null): Doc | null {
  const s = readDemo(layout);
  return s?.versions.find((v) => v.id === s.published)?.doc ?? null;
}
