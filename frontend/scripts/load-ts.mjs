// Import a TypeScript module from src/ in node --test without a bundler: transpiles it and, recursively,
// its relative and "@/..." imports (JSON as a default export) into data: URLs. Type-only imports are
// erased by the transpiler. Used by the unit tests (npm test).
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const cache = new Map();
const toUrl = (js) => `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`;

function file(spec, from) {
  const base = spec.startsWith("@/") ? resolve(SRC, spec.slice(2)) : resolve(dirname(from), spec);
  for (const f of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) if (existsSync(f) && !f.endsWith("/")) try { readFileSync(f); return f; } catch { /* dir */ }
  throw new Error(`cannot resolve ${spec} from ${from}`);
}

function urlOf(path) {
  if (cache.has(path)) return cache.get(path);
  let js;
  if (path.endsWith(".json")) js = `export default ${readFileSync(path, "utf8")};`;
  else {
    const out = ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, verbatimModuleSyntax: false },
    }).outputText;
    js = out.replace(/(from\s+|import\s+)"([^"]+)"/g, (m, kw, spec) =>
      spec.startsWith(".") || spec.startsWith("@/") ? `${kw}"${urlOf(file(spec, path))}"` : m,
    );
  }
  const url = toUrl(js);
  cache.set(path, url);
  return url;
}

/** await loadTs("lib/history.ts") -> the module's exports */
export const loadTs = (rel) => import(urlOf(resolve(SRC, rel)));
