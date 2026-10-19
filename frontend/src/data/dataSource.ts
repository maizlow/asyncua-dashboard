import { createDemoDataSource } from "./demoDataSource";
import { createLiveDataSource } from "./liveDataSource";
import type { DataSource } from "./types";

import { IS_DEMO } from "@/lib/env";

export { IS_DEMO };

export const dataSource: DataSource = IS_DEMO ? createDemoDataSource() : createLiveDataSource();
