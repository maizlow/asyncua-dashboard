import { createLiveDataSource } from "./liveDataSource";
import type { DataSource } from "./types";

export const dataSource: DataSource = createLiveDataSource();
