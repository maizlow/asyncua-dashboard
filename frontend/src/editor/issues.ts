import type { ItemAudit } from "./audit";
import { pathText, type Problem } from "./validate";

export interface Issue {
  level: "error" | "warn";
  text: string;
  where: string;
  display?: string;
  screen?: number;
  item?: string;
}

/** Validation problems (whole document) + the legibility audit of the current screen */
export function collectIssues(problems: Problem[], audit: Record<string, ItemAudit>, displayId: string | null, screenNr: number | null): Issue[] {
  const out: Issue[] = problems.map((p) => ({ level: "error", text: p.message, where: pathText(p.path), display: p.display, screen: p.screen, item: p.item }));
  for (const a of Object.values(audit))
    for (const m of a.messages)
      out.push({ level: m.level, text: m.text, where: `${displayId} → skärm ${screenNr} → ${a.id}`, display: displayId ?? undefined, screen: screenNr ?? undefined, item: a.id });
  return out;
}

