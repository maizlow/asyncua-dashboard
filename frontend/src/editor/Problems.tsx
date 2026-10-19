import { useState } from "react";
import { useEditorStore } from "./store";
import type { Issue } from "./issues";

export function ProblemsBar({ issues }: { issues: Issue[] }) {
  const [open, setOpen] = useState(false);
  const { selectDisplay, selectScreen, select, displayId } = useEditorStore();
  const errors = issues.filter((i) => i.level === "error").length;
  const warns = issues.length - errors;
  return (
    <div className="shrink-0 border-t border-zinc-800 bg-zinc-900">
      <button data-testid="problems-toggle" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 px-4 py-1.5 text-left text-sm hover:bg-zinc-800">
        <span data-testid="problem-count" className={errors ? "text-red-300" : "text-zinc-400"}>
          {errors ? `✖ ${errors} fel` : "✔ Inga fel"}
        </span>
        <span className={warns ? "text-amber-300" : "text-zinc-500"}>{warns ? `⚠ ${warns} varningar` : "inga varningar"}</span>
        <span className="ml-auto text-xs text-zinc-500">{open ? "Dölj ▾" : issues.length ? "Visa ▸" : ""}</span>
      </button>
      {open && issues.length > 0 && (
        <ul className="max-h-48 overflow-y-auto border-t border-zinc-800 py-1 text-sm" data-testid="problem-list">
          {issues.map((i, n) => (
            <li key={n}>
              <button
                className="flex w-full gap-3 px-4 py-1 text-left hover:bg-zinc-800"
                onClick={() => {
                  if (i.display && i.display !== displayId) selectDisplay(i.display);
                  if (i.screen !== undefined) selectScreen(i.screen);
                  if (i.item) select(i.item);
                }}
              >
                <span className={i.level === "error" ? "text-red-300" : "text-amber-300"}>{i.level === "error" ? "✖" : "⚠"}</span>
                <span className="text-zinc-200">{i.text}</span>
                <span className="ml-auto truncate font-mono text-xs text-zinc-500">{i.where}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
