/**
 * Element catalogue: which properties each value element has. The props panel is generated from this
 * (a new element type needs no new panel code). Limits as in docs/CONFIG.md (Objekt).
 */
import type { ValueKind } from "./ops";

export type FieldType = "text" | "tag" | "int" | "target" | "bool" | "color" | "thresholds" | "better" | "states";

export interface Field {
  key: string;
  type: FieldType;
  label: string;
  help?: string;
  max?: number;
  min?: number;
  required?: boolean;
  placeholder?: string;
}

const label: Field = { key: "label", type: "text", label: "Etikett", max: 20, required: true, help: "Visas med versaler, högst 20 tecken" };
const tag: Field = { key: "tag", type: "tag", label: "Tagg", required: true };
const unit: Field = { key: "unit", type: "text", label: "Enhet", max: 6, help: "Högst 6 tecken, med mål/trend helst ≤ 4", placeholder: "st, TPM, °C" };
const decimals: Field = { key: "decimals", type: "int", label: "Decimaler", min: 0, max: 3, placeholder: "auto" };
const target: Field = { key: "target", type: "target", label: "Mål", help: "En tagg eller ett fast tal; visar Mål och stapel" };
const trend: Field = { key: "trend", type: "bool", label: "Visa senaste förändringen (trend)" };
const color: Field = { key: "color", type: "color", label: "Fast färg", help: "Gränser går före fast färg" };
const thresholds: Field = { key: "thresholds", type: "thresholds", label: "Gränser [varning, bra]" };
const better: Field = { key: "better", type: "better", label: "Bättre är" };
const states: Field = { key: "states", type: "states", label: "Tillstånd (PLC-värde → text och färg)" };

export const ELEMENT_FIELDS: Record<ValueKind, Field[]> = {
  number: [label, tag, unit, decimals, target, trend, thresholds, better, color],
  percent: [label, tag, decimals, target, trend, thresholds, better, color],
  counter: [label, tag, unit, target, trend, thresholds, better, color],
  time: [label, tag, color],
  status: [label, tag, states],
};

export const COLORS: [string, string][] = [
  ["white", "Vit"],
  ["green", "Grön"],
  ["amber", "Gul"],
  ["red", "Röd"],
  ["grey", "Grå"],
];
