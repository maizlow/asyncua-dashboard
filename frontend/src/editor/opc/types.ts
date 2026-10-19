/**
 * OPC UA browsing for the editor (etapp 3): the shapes returned by /api/editor/opcua (see
 * backend/opc/browse.py) and the pure rules on top of them: does a data type fit an element type,
 * and which tag name to suggest for a node. No imports, so the unit tests can load it directly.
 */
export interface OpcNode {
  node_id: string;
  browse_name: string;
  display_name: string;
  node_class: "Object" | "Variable" | string;
  has_children: boolean;
  data_type?: string | null;
  readable?: boolean;
  writable?: boolean;
  array?: boolean;
  /** Search results: display names from the root down to the parent */
  path?: string[];
}

export interface BrowseResult {
  connection: string;
  node: string;
  children: OpcNode[];
  truncated: boolean;
  limit: number;
}

export interface SearchResult {
  connection: string;
  root: string;
  q: string;
  results: OpcNode[];
  visited: number;
  complete: boolean;
  stopped_by: "antal" | "djup" | "tid" | null;
}

export interface ReadResult {
  connection: string;
  node_id: string;
  display_name: string | null;
  browse_name: string | null;
  data_type: string | null;
  readable: boolean;
  writable: boolean;
  array: boolean;
  value: unknown;
  status: string;
  source_time: string | null;
}

export type ValueKind = "number" | "percent" | "counter" | "time" | "status";
export type TypeGroup = "bool" | "int" | "float" | "string" | "datetime" | "other";

const INT = new Set(["SByte", "Byte", "Int16", "UInt16", "Int32", "UInt32", "Int64", "UInt64", "Integer", "UInteger"]);
const FLOAT = new Set(["Float", "Double", "Number"]);
const STRING = new Set(["String", "LocalizedText", "ByteString", "XmlElement"]);

export function typeGroup(dataType: string | null | undefined): TypeGroup {
  if (!dataType) return "other";
  if (dataType === "Boolean") return "bool";
  if (INT.has(dataType)) return "int";
  if (FLOAT.has(dataType)) return "float";
  if (STRING.has(dataType)) return "string";
  if (dataType === "DateTime" || dataType === "UtcTime") return "datetime";
  return "other";
}

export interface Fit {
  level: "ok" | "warn" | "error";
  text: string;
}

const KIND_NAMES: Record<ValueKind, string> = { number: "Tal", percent: "Procent", counter: "Räknare", time: "Tid", status: "Status" };

/**
 * Does a node's data type fit the element type? error = the element can't show it sensibly
 * (a string as a percentage, a bool as a counter), warn = works with a caveat.
 */
export function typeFit(kind: ValueKind, dataType: string | null | undefined, array = false): Fit {
  const name = KIND_NAMES[kind];
  if (array) return { level: "error", text: `Noden är en array – ${name} visar ett värde. Välj ett element i arrayen.` };
  const g = typeGroup(dataType);
  const dt = dataType ?? "okänd typ";
  if (g === "other")
    return { level: "warn", text: `Datatypen ${dt} är okänd för editorn (t.ex. en struktur eller ett S7-format). Kontrollera att ${name} kan visa den.` };
  if (g === "string")
    return kind === "status"
      ? { level: "warn", text: "Status jämför tal med tillståndens nummer – en text matchar inga tillstånd." }
      : { level: "error", text: `En text (${dt}) kan inte visas som ${name}.` };
  if (g === "datetime") return { level: kind === "time" ? "warn" : "error", text: kind === "time" ? "Tid visar S7 TIME/TOD i ms, inte DateTime." : `Ett datum (${dt}) kan inte visas som ${name}.` };
  switch (kind) {
    case "counter":
      if (g === "bool") return { level: "error", text: "En bool (av/på) kan inte visas som räknare. Använd Status." };
      if (g === "float") return { level: "warn", text: `Räknare visar heltal – ${dt} avrundas.` };
      return { level: "ok", text: `${dt} passar Räknare.` };
    case "percent":
      if (g === "bool") return { level: "error", text: "En bool (av/på) kan inte visas som procent. Använd Status." };
      return { level: "ok", text: `${dt} passar Procent (värdet ska vara 0–100).` };
    case "number":
      if (g === "bool") return { level: "warn", text: "En bool visas som 0 eller 1. Status passar bättre." };
      return { level: "ok", text: `${dt} passar Tal.` };
    case "time":
      if (g === "int") return { level: "ok", text: `${dt} passar Tid om värdet är S7 TIME/TOD i ms (taggen får typen tid).` };
      return { level: "error", text: `Tid visar S7 TIME/TOD i ms – ${dt} passar inte.` };
    case "status":
      if (g === "float") return { level: "warn", text: `Status jämför med heltal – ${dt} med decimaler matchar inga tillstånd.` };
      return { level: "ok", text: g === "bool" ? "Boolean passar Status (tillstånd 0 och 1)." : `${dt} passar Status.` };
  }
}

/** The element type a data type suggests (shown in the browser) */
export function suggestKind(dataType: string | null | undefined): ValueKind | null {
  switch (typeGroup(dataType)) {
    case "bool":
      return "status";
    case "int":
      return "counter";
    case "float":
      return "number";
    default:
      return null;
  }
}

/** Tag name rule (same as validate.ts TAG_NAME) */
export const TAG_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
export const MAX_TAG_NAME = 40;

/** Written in capitals in a suggested tag name (oee → OEE, oeeMal → OEEMal) */
const ABBREVIATIONS = new Set(["oee", "tpm", "ok", "nok", "id", "pv", "sp", "kw", "kwh", "plc", "hmi", "db"]);

/**
 * A tag name suggested from a browse name: "prodState" → ProdState, "oee" → OEE, "DB Pack"."count"
 * → Count, "Level 1" → Level1; unique within the PLC (Count2, Count3…).
 */
export function suggestAlias(browseName: string, taken: Iterable<string>): string {
  const last = browseName.split(/"\s*\.\s*"/).pop() ?? browseName;
  const words = last
    .replace(/["']/g, "")
    .split(/[^A-Za-z0-9ÅÄÖåäö]+|(?<=[a-zåäö0-9])(?=[A-ZÅÄÖ])/)
    .filter(Boolean)
    .map((w) => w.replace(/[åä]/g, "a").replace(/[ÅÄ]/g, "A").replace(/ö/g, "o").replace(/Ö/g, "O"));
  let name = words.map((w) => (ABBREVIATIONS.has(w.toLowerCase()) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join("");
  if (!name) name = "Tagg";
  if (!/^[A-Za-z]/.test(name)) name = `T${name}`;
  name = name.slice(0, MAX_TAG_NAME - 3);
  const used = new Set(taken);
  if (!used.has(name)) return name;
  for (let i = 2; ; i++) if (!used.has(`${name}${i}`)) return `${name}${i}`;
}

/** Value as shown in the preview */
export function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "–";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toLocaleString("sv-SE", { maximumFractionDigits: 3 });
  if (typeof v === "boolean") return v ? "true (1)" : "false (0)";
  if (Array.isArray(v)) return `[${v.map(formatValue).join(", ")}]`;
  return String(v);
}
