import { stringify } from "yaml";
import type { Doc } from "./backend";

/** Formatted in the browser's time zone (on the plant: Swedish time) */
export const fmtTime = (iso: string) => new Date(iso).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });

export function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/yaml" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The document as YAML (same structure as dashboard.yaml v2) */
export function docYaml(doc: Doc, note: string) {
  return `# ${note}\n# Läs in: lägg filen som dashboard.yaml och sätt LAYOUT_YAML_IMPORT=always (se docs/CONFIG.md)\n${stringify(doc)}`;
}

export function exportDraft(doc: Doc) {
  download("layout-utkast.yaml", docYaml(doc, `Utkast från layout-editorn, ${fmtTime(new Date().toISOString())}`));
}

