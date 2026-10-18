import { createDemoDataSource } from "./demoDataSource";
import { createLiveDataSource } from "./liveDataSource";
import type { DataSource } from "./types";

/** True when built with VITE_DEMO=true (static preview, no backend or PLC). */
export const IS_DEMO = import.meta.env.VITE_DEMO === "true";

export const dataSource: DataSource = IS_DEMO ? createDemoDataSource() : createLiveDataSource();
