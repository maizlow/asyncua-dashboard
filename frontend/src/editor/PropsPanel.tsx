import type { ReactNode } from "react";
import type { Doc } from "./backend";
import { COLORS, fieldsFor, type Field } from "./elements";
import { isChartKind } from "@/charts/metrics";
import { TYPE_NAMES } from "./names";
import { findWidget, removeWidget, setChartSource, type ValueKind, type Widget } from "./ops";
import { useEditorStore } from "./store";
import { TagPicker } from "./TagPicker";
import { pasteClipboard } from "./actions";
import type { ItemAudit } from "./audit";

const input = "w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-zinc-100 outline-none focus:border-sky-500";
const btn = "rounded-md border border-zinc-700 px-2.5 py-1 text-sm hover:bg-zinc-800 disabled:opacity-40";

function Row({ field, children, problem }: { field: Field; children: ReactNode; problem?: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-zinc-400">
          {field.label}
          {field.required && <span className="text-zinc-600"> *</span>}
        </span>
        {field.help && <span className="truncate text-[11px] text-zinc-600" title={field.help}>{field.help}</span>}
      </div>
      {children}
      {problem && <div className="text-xs text-red-300">{problem}</div>}
    </div>
  );
}

const num = (s: string) => (s.trim() === "" ? undefined : Number(s.replace(",", ".")));

function FieldEditor({ field, w, doc, displayId, set }: { field: Field; w: Widget; doc: Doc; displayId: string; set: (key: string, v: unknown) => void }) {
  const v = w[field.key];
  const t = `prop-${field.key}`;
  // Chart tags are numbers (the TagPicker's type check); value elements check against their own kind
  const tagKind: ValueKind = isChartKind(w.kind) ? "number" : (w.kind as ValueKind);
  switch (field.type) {
    case "select": {
      const opts = field.options?.(w) ?? [];
      const cur = v === undefined ? "" : String(v);
      return (
        <select data-testid={t} className={input} value={cur} onChange={(e) => set(field.key, e.target.value === "" ? undefined : e.target.value)}>
          {!opts.some((o) => o.value === cur) && <option value={cur}>{cur}</option>}
          {opts.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }
    case "columns": {
      const cols = (v as string[] | undefined) ?? [];
      const toggle = (c: string, on: boolean) => {
        const next = on ? [...cols, c] : cols.filter((x) => x !== c);
        set(field.key, next.length ? next : undefined);
      };
      return (
        <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
          {(field.options?.(w) ?? []).map((o) => (
            <label key={o.value} className="flex items-center gap-2 text-zinc-300">
              <input
                data-testid={`${t}-${o.value}`}
                type="checkbox"
                checked={cols.includes(o.value)}
                disabled={!cols.includes(o.value) && cols.length >= 5}
                onChange={(e) => toggle(o.value, e.target.checked)}
              />
              {o.label}
            </label>
          ))}
        </div>
      );
    }
    case "number":
      return (
        <input data-testid={t} type="number" min={field.min} max={field.max} className={input} placeholder={field.placeholder} value={v === undefined ? "" : String(v)} onChange={(e) => set(field.key, num(e.target.value))} />
      );
    case "text":
      return (
        <input data-testid={t} className={input} maxLength={field.max} placeholder={field.placeholder} value={(v as string | undefined) ?? ""} onChange={(e) => set(field.key, e.target.value === "" && !field.required ? undefined : e.target.value)} />
      );
    case "tag":
      return <TagPicker testId={t} doc={doc} displayId={displayId} kind={tagKind} value={v as string | undefined} onChange={(r) => set(field.key, r)} />;
    case "int":
      return (
        <input data-testid={t} type="number" min={field.min} max={field.max} className={input} placeholder={field.placeholder} value={v === undefined ? "" : String(v)} onChange={(e) => set(field.key, num(e.target.value))} />
      );
    case "bool": {
      // defaultOn: stored only when switched off (false), like the backend's default
      const on = field.defaultOn ? v !== false : !!v;
      return (
        <label className="flex items-center gap-2 text-zinc-300">
          <input data-testid={t} type="checkbox" checked={on} onChange={(e) => set(field.key, field.defaultOn ? (e.target.checked ? undefined : false) : e.target.checked || undefined)} />
          {on ? "På" : "Av"}
        </label>
      );
    }
    case "color":
      return (
        <select data-testid={t} className={input} value={(v as string | undefined) ?? ""} onChange={(e) => set(field.key, e.target.value || undefined)}>
          <option value="">Standard (vit)</option>
          {COLORS.map(([c, n]) => (
            <option key={c} value={c}>
              {n}
            </option>
          ))}
        </select>
      );
    case "better":
      return (
        <select data-testid={t} className={input} value={(v as string | undefined) ?? "high"} onChange={(e) => set(field.key, e.target.value === "high" ? undefined : e.target.value)}>
          <option value="high">Högre (OEE, produktion)</option>
          <option value="low">Lägre (kassation, temperatur)</option>
        </select>
      );
    case "thresholds": {
      const th = (v as number[] | undefined) ?? [];
      const upd = (i: 0 | 1, s: string) => {
        const next = [th[0], th[1]] as (number | undefined)[];
        next[i] = num(s);
        set(field.key, next[0] === undefined && next[1] === undefined ? undefined : next.map((x) => x ?? 0));
      };
      return (
        <div className="grid grid-cols-2 gap-2">
          <input data-testid={`${t}-warn`} type="number" className={input} placeholder="varning" value={th[0] ?? ""} onChange={(e) => upd(0, e.target.value)} />
          <input data-testid={`${t}-good`} type="number" className={input} placeholder="bra" value={th[1] ?? ""} onChange={(e) => upd(1, e.target.value)} />
        </div>
      );
    }
    case "target": {
      const mode = v === undefined ? "none" : typeof v === "number" ? "number" : "tag";
      return (
        <div className="space-y-1.5">
          <select
            data-testid={t}
            className={input}
            value={mode}
            onChange={(e) => set(field.key, e.target.value === "none" ? undefined : e.target.value === "number" ? (isChartKind(w.kind) ? 85 : 1000) : (w.tag ?? ""))}
          >
            <option value="none">Inget mål</option>
            <option value="tag">Tagg</option>
            <option value="number">Fast tal</option>
          </select>
          {mode === "tag" && <TagPicker testId={`${t}-tag`} doc={doc} displayId={displayId} kind={tagKind} value={v as string} onChange={(r) => set(field.key, r)} />}
          {mode === "number" && <input type="number" className={input} value={String(v)} onChange={(e) => set(field.key, num(e.target.value) ?? 0)} />}
        </div>
      );
    }
    case "states": {
      const st = (v as Record<string, { text: string; color: string }> | undefined) ?? {};
      const entries = Object.entries(st);
      const put = (next: [string, { text: string; color: string }][]) => set(field.key, Object.fromEntries(next));
      return (
        <div className="space-y-1.5">
          {entries.map(([k, s], i) => (
            <div key={i} className="grid grid-cols-[56px_1fr_84px_24px] gap-1">
              <input
                type="number"
                className={input}
                value={k}
                aria-label="PLC-värde"
                onChange={(e) => put(entries.map((x, j) => (j === i ? [e.target.value, x[1]] : x)))}
              />
              <input className={input} maxLength={10} value={s.text} aria-label="Text" onChange={(e) => put(entries.map((x, j) => (j === i ? [x[0], { ...x[1], text: e.target.value }] : x)))} />
              <select className={input} value={s.color} aria-label="Färg" onChange={(e) => put(entries.map((x, j) => (j === i ? [x[0], { ...x[1], color: e.target.value }] : x)))}>
                {COLORS.map(([c, n]) => (
                  <option key={c} value={c}>
                    {n}
                  </option>
                ))}
              </select>
              <button className="text-zinc-500 hover:text-red-300" title="Ta bort" onClick={() => put(entries.filter((_, j) => j !== i))}>
                ×
              </button>
            </div>
          ))}
          <button
            className={btn}
            onClick={() => {
              const used = new Set(entries.map(([k]) => Number(k)));
              let n = 0;
              while (used.has(n)) n++;
              put([...entries, [String(n), { text: "NYTT", color: "white" }]]);
            }}
          >
            + Tillstånd
          </button>
        </div>
      );
    }
  }
}

function AuditBox({ audit }: { audit: ItemAudit | undefined }) {
  if (!audit) return null;
  const tone = audit.level === "error" ? "border-red-800 bg-red-950/50 text-red-200" : audit.level === "warn" ? "border-amber-800 bg-amber-950/40 text-amber-200" : "border-emerald-900 bg-emerald-950/30 text-emerald-200";
  return (
    <div data-testid="audit-box" className={`rounded-md border px-3 py-2 text-xs ${tone}`}>
      <div className="font-medium">
        Läsbarhet vid 1080p, värsta fallet: värde {audit.hero ?? "–"} px · minsta text {audit.minText ?? "–"} px
      </div>
      {audit.messages.map((m, i) => (
        <div key={i}>
          {m.level === "error" ? "✖" : "⚠"} {m.text}
        </div>
      ))}
      {audit.level === "ok" && <div>OK: värdet ≥ 90 px och all text ≥ 37 px.</div>}
    </div>
  );
}

export function PropsPanel({ id, problems }: { id: string; problems: Record<string, string> }) {
  const { doc, displayId, screenNr, edit, copy, audit } = useEditorStore();
  if (!doc || !displayId || screenNr === null) return null;
  const w = findWidget(doc, displayId, screenNr, id);
  if (!w) return null;
  const fields = fieldsFor(w.kind).filter((f) => !f.when || f.when(w));
  const set = (key: string, value: unknown) =>
    edit(
      (d) => {
        const x = findWidget(d, displayId, screenNr, id)!;
        if (key === "source" && isChartKind(x.kind)) setChartSource(d, displayId, x, value === "tag" ? "tag" : undefined);
        else if (value === undefined) delete x[key];
        else x[key] = value;
      },
      undefined,
      `${id}.${key}`,
    );
  return (
    <div className="space-y-4 p-4 text-sm" data-testid="props-panel">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">Element · {TYPE_NAMES[w.kind] ?? w.kind}</span>
        <span className="font-mono text-xs text-zinc-500" data-testid="item-rect">
          x {w.x} · y {w.y} · {w.w}×{w.h}
        </span>
      </div>
      <AuditBox audit={audit[id]} />
      {fields.map((f) => (
        <Row key={f.key} field={f} problem={problems[f.key]}>
          <FieldEditor field={f} w={w} doc={doc} displayId={displayId} set={set} />
        </Row>
      ))}
      {problems[""] && <div className="text-xs text-red-300">{problems[""]}</div>}
      <div className="flex flex-wrap gap-2 border-t border-zinc-800 pt-3">
        <button className={btn} onClick={copy}>
          Kopiera
        </button>
        <button
          className={btn}
          onClick={() => {
            copy();
            pasteClipboard();
          }}
        >
          Duplicera
        </button>
        <button data-testid="delete-item" className={`${btn} border-red-900 text-red-300 hover:bg-red-950`} onClick={() => edit((d) => removeWidget(d, displayId, screenNr, id), { selected: null })}>
          Ta bort
        </button>
      </div>
    </div>
  );
}
