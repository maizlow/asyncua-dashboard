/**
 * Live legibility check (docs/EDITOR-PLAN.md, Läsbarhetsspärrar), measured in the browser on a
 * rendering of the screen with worst-case values (AuditFrame). At 1080p the 3840×2160 canvas is
 * scaled 0.5, so cap heights are reported in 1080p px:
 * - any text with a cap height under 37 px blocks publishing (error);
 * - a hero value (the big number) under 90 px is a warning;
 * - clipped overflow or a value that doesn't fit blocks; text shortened with … is a warning, except in
 *   charts and KPI tiles, where it blocks (as in scripts/check-fit.mjs: the chart text is all there is);
 * - every [data-fit-value] (chart values, which shrink to fit) must fit.
 * Cap heights come from the real fonts (canvas measureText of "H"), not a fixed factor.
 */
export const MIN_TEXT_PX = 37;
export const MIN_HERO_PX = 90;
const TO_1080 = 0.5;

export type Level = "ok" | "warn" | "error";
export interface ItemAudit {
  id: string;
  /** Cap height of the hero value at 1080p (null: no hero) */
  hero: number | null;
  /** Smallest cap height of any text at 1080p */
  minText: number | null;
  level: Level;
  messages: { level: Exclude<Level, "ok">; text: string }[];
}

const ratios = new Map<string, number>();
let ctx: CanvasRenderingContext2D | null = null;

/** Cap height / font size for a font (measured once per family + weight) */
export function capRatio(family: string, weight: string): number {
  const key = `${weight}|${family}`;
  let r = ratios.get(key);
  if (r === undefined) {
    ctx ??= document.createElement("canvas").getContext("2d");
    if (!ctx) return 0.72;
    ctx.font = `${weight} 100px ${family}`;
    r = ctx.measureText("H").actualBoundingBoxAscent / 100 || 0.72;
    ratios.set(key, r);
  }
  return r;
}

function cap(el: Element, sizePx?: number): number {
  const cs = getComputedStyle(el);
  const size = sizePx ?? parseFloat(cs.fontSize);
  return Math.round(size * capRatio(cs.fontFamily, cs.fontWeight) * TO_1080);
}

const hasText = (el: Element) => [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim() !== "");

export function auditItem(itemEl: HTMLElement): ItemAudit {
  const id = itemEl.dataset.item ?? "";
  const messages: ItemAudit["messages"] = [];
  let minText: number | null = null;
  for (const el of [itemEl, ...itemEl.querySelectorAll("*")]) {
    if (el instanceof SVGElement || !hasText(el)) continue;
    const b = el.getBoundingClientRect();
    if (b.width === 0 && b.height === 0) continue;
    const c = cap(el);
    minText = minText === null ? c : Math.min(minText, c);
  }
  const heroEl = itemEl.querySelector<HTMLElement>("[data-hero]");
  const hero = heroEl ? cap(heroEl, parseFloat(heroEl.style.fontSize || getComputedStyle(heroEl).fontSize)) : null;

  if (minText !== null && minText < MIN_TEXT_PX) messages.push({ level: "error", text: `text ${minText} px – under ${MIN_TEXT_PX} px vid 1080p` });
  if (hero !== null && hero < MIN_HERO_PX) messages.push({ level: "warn", text: `värdet ${hero} px – under ${MIN_HERO_PX} px vid 1080p (gör rutan större)` });
  if (heroEl && heroEl.scrollWidth > heroEl.clientWidth + 1) messages.push({ level: "error", text: "värdet får inte plats i rutan" });
  for (const el of itemEl.querySelectorAll<HTMLElement>("[data-fit-value]"))
    if (el.scrollWidth > el.clientWidth + 1) messages.push({ level: "error", text: `”${(el.textContent ?? "").trim().slice(0, 24)}” får inte plats (gör rutan större)` });
  const chart = itemEl.querySelector("[data-chart]") !== null;
  // Overflow where it is clipped (same rule as scripts/check-fit.mjs): … is a warning, cut text an error
  for (const el of itemEl.querySelectorAll("*")) {
    if (el instanceof SVGElement) continue;
    const cs = getComputedStyle(el);
    const overX = cs.overflowX !== "visible" && el.scrollWidth > el.clientWidth + 1;
    const overY = cs.overflowY !== "visible" && el.scrollHeight > el.clientHeight + 1;
    if (!overX && !overY) continue;
    const text = (el.textContent ?? "").trim().slice(0, 24);
    const ellipsis = cs.textOverflow === "ellipsis";
    const clamp = cs.webkitLineClamp && cs.webkitLineClamp !== "none";
    if ((overX && !ellipsis) || (overY && !clamp)) messages.push({ level: "error", text: `”${text}” klipps av` });
    else messages.push({ level: chart ? "error" : "warn", text: `”${text}” kortas med …${chart ? " (gör rutan större eller rubriken kortare)" : ""}` });
  }
  const level: Level = messages.some((m) => m.level === "error") ? "error" : messages.length ? "warn" : "ok";
  return { id, hero, minText, level, messages };
}

export function auditRoot(root: HTMLElement): Record<string, ItemAudit> {
  return Object.fromEntries([...root.querySelectorAll<HTMLElement>("[data-item]")].map((el) => {
    const a = auditItem(el);
    return [a.id, a];
  }));
}
