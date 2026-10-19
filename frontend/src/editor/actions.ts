/** Editor commands shared by buttons and keyboard shortcuts */
import { GRID_COLS, GRID_ROWS } from "@/layout/doc";
import { findWidget, pasteWidget, placementProblem, removeWidget, setRect } from "./ops";
import { useEditorStore } from "./store";

export function pasteClipboard() {
  const { clipboard, displayId, screenNr, edit } = useEditorStore.getState();
  if (!clipboard || !displayId || screenNr === null) return;
  let id = "";
  edit(
    (d) => {
      id = pasteWidget(d, displayId, screenNr, clipboard);
    },
    () => ({ selected: id }),
  );
}

export function deleteSelected() {
  const { doc, displayId, screenNr, selected, edit } = useEditorStore.getState();
  if (!doc || !displayId || screenNr === null || !selected) return;
  const w = findWidget(doc, displayId, screenNr, selected);
  if (!w || w.kind === "alarms" || ["shift", "oee", "week", "highscore"].includes(w.kind)) return; // whole screen: delete the screen
  edit((d) => removeWidget(d, displayId, screenNr, selected), { selected: null });
}

/** Arrow keys: move one cell; with Shift: resize. Refused (with a notice) when it would collide. */
export function nudge(dx: number, dy: number, resize: boolean) {
  const { doc, displayId, screenNr, selected, edit } = useEditorStore.getState();
  if (!doc || !displayId || screenNr === null || !selected) return;
  const w = findWidget(doc, displayId, screenNr, selected);
  if (!w) return;
  const rect = resize
    ? { x: w.x, y: w.y, w: Math.min(GRID_COLS, w.w + dx), h: Math.min(GRID_ROWS, w.h + dy) }
    : { x: w.x + dx, y: w.y + dy, w: w.w, h: w.h };
  edit((d) => {
    const why = placementProblem(d, displayId, screenNr, selected, w.kind, rect);
    if (why) throw new Error(why);
    setRect(d, displayId, screenNr, selected, rect);
  });
}

function typing(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}

export function onEditorKey(e: KeyboardEvent) {
  if (typing(e)) return;
  // A dialog (publish, versions, PLC browser) handles its own keys: Esc closes it, nothing else
  // may reach the canvas (Delete would remove the selected element behind it)
  if (document.querySelector('[role="dialog"]')) return;
  const s = useEditorStore.getState();
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (mod && k === "z" && !e.shiftKey) s.undo();
  else if (mod && (k === "y" || (k === "z" && e.shiftKey))) s.redo();
  else if (mod && k === "c") s.copy();
  else if (mod && k === "v") pasteClipboard();
  else if (mod && k === "d") {
    s.copy();
    pasteClipboard();
  } else if (!mod && (e.key === "Delete" || e.key === "Backspace")) deleteSelected();
  else if (!mod && e.key === "Escape") s.select(null);
  else if (!mod && e.key.startsWith("Arrow")) {
    if (!s.selected) return;
    const [dx, dy] = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key] ?? [0, 0];
    nudge(dx, dy, e.shiftKey);
  } else return;
  e.preventDefault();
}
