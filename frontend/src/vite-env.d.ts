/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "true" builds the self-contained demo (mock data, no backend/PLC). */
  readonly VITE_DEMO?: string;
  /** Optional absolute WebSocket URL override, e.g. ws://192.168.1.10:8000/ws */
  readonly VITE_WS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** A layout file imported via the dashboard-yaml plugin in vite.config.ts: { displayId: view }. */
declare module "*.yaml" {
  const value: Record<string, unknown>;
  export default value;
}
