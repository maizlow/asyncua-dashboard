import type { Layout } from "@/layout/layout";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export type MetricValue = number | string;

export interface Alarm {
  ID: number | string;
  message: string;
  timestamp: string;
  displayClass: number;
}

export interface ShiftPatternRow {
  /** "HH:MM" local start of the bucket (buckets are aligned to the shift start) */
  time: string;
  /** "HH:MM" local end of the bucket */
  end?: string;
  /** Bucket length in minutes (60, or less for a final partial hour) */
  minutes?: number;
  running: number;
  stopped: number;
}

/** OEE breakdown pushed by the backend (backend/opc/oee.py). Fractions are 0..1. */
export interface OeeDetails {
  nominal_tpm: number;
  /** OEE goal in % (PLC tag OeeTarget, default 85) */
  oee_target?: { value: number; source: "OeeTarget" | "default" };
  counts: {
    good: number | null;
    reject: number | null;
    total: number | null;
    scrap_pct: number | null;
    good_source?: string;
  };
  speed: { current: number | null; nominal: number; pct: number | null };
  shift: {
    start: string;
    end: string;
    duration_s: number;
    elapsed_s: number;
    remaining_s: number;
    /** Planned production time so far: PlannedTime pro rata, else elapsed */
    planned_s?: number;
    planned_shift_s?: number;
    planned_source?: "PlannedTime" | "schedule";
    /** PLC tag ShiftTeam (null when empty) */
    team?: string | null;
  } | null;
  target: {
    /** null when the PLC tag ShiftTarget has no value */
    so_far: number | null;
    shift: number | null;
    source?: "ShiftTarget" | null;
    prognosis: number | null;
    progress_pct: number | null;
  } | null;
  stops: {
    count: number;
    total_s: number;
    longest_s: number;
    run_s: number;
    mtbf_s: number | null;
    mttr_s: number | null;
    running: boolean | null;
  } | null;
  oee: {
    availability: number | null;
    performance: number | null;
    quality: number | null;
    oee: number | null;
  };
  /** good tiles per local clock hour; elapsed_s = seconds of that hour inside the shift so far */
  hourly: { time: string; good: number | null; elapsed_s?: number }[];
}

/** One local calendar day of the 7-day screen (backend/opc/daily.py). Values are null without data. */
export interface DailyRow {
  /** "YYYY-MM-DD" in the plant time zone */
  date: string;
  /** 0 = Monday */
  weekday: number;
  start: string;
  end: string;
  today: boolean;
  has_data: boolean;
  good: number | null;
  reject: number | null;
  total: number | null;
  good_source?: string | null;
  planned_s: number | null;
  run_s: number | null;
  stop_s: number | null;
  /** Day target from ShiftTarget (today: up to now); null without ShiftTarget */
  target: number | null;
  /** "shifts" = aggregated from the shift log, "raw" = from the raw history (days before the log) */
  source?: "shifts" | "raw";
  /** Planned-time-weighted mean of the shifts' OeeTarget (shift log only) */
  oee_target?: number | null;
  /** Shift teams that worked this day (shift log only) */
  teams?: string[];
  shifts?: number | null;
  stop_count?: number | null;
  oee: { availability: number | null; performance: number | null; quality: number | null; oee: number | null };
}

export interface DailyHistory {
  days: DailyRow[];
  nominal_tpm: number;
  oee_target?: { value: number; source: string };
  retention_days?: number | null;
  shift?: { start: string; end: string } | null;
  updated: string;
}

/** One completed run without a stop (backend/opc/highscore.py). */
export interface RunRecord {
  start: string;
  end: string;
  duration_s: number;
  /** ShiftTeam at the start ("A→B" if the run spanned a team change); null without ShiftTeam */
  team: string | null;
  /** Started in the current shift (highlighted) */
  current_shift: boolean;
}

export interface Highscores {
  /** Longest completed runs, longest first */
  records: RunRecord[];
  /** Ongoing run (null when the line is not running); duration as of `updated` */
  current: { start: string; duration_s: number; team: string | null; running: boolean; current_shift: boolean } | null;
  shift_start: string | null;
  min_stop_s: number;
  updated: string;
}

export type ServerMessage =
  /** key = tag name within `connection` (backend), or a qualified key without `connection` (demo) */
  | { type: "data_update"; connection?: string; key: string; value: MetricValue }
  | {
      type: "full_snapshot";
      connection?: string;
      /** OPC UA connection status per connection */
      connected?: Record<string, boolean>;
      data: Record<string, MetricValue>;
      histories: Record<string, MetricValue[]>;
    }
  /** A PLC's OPC UA connection went up or down */
  | { type: "connection_status"; connection: string; connected: boolean }
  | { type: "alarm_added"; alarm_id: number | string; alarm: Alarm }
  | { type: "alarm_removed"; alarm_id: number | string; alarm?: Alarm }
  | { type: "shift_pattern_data"; data: ShiftPatternRow[] }
  | { type: "screen_change"; screen: number }
  /** A new layout version was published (editor, etapp 2): reload GET /api/layout */
  | { type: "layout_changed"; version: number }
  | { type: "oee_details"; data: OeeDetails }
  | { type: "daily_history"; data: DailyHistory }
  | { type: "highscores"; data: Highscores };

/**
 * Everything the UI needs from "the outside world". The real implementation talks
 * to the FastAPI backend (WebSocket + read-only REST); the demo implementation
 * simulates a production line in the browser.
 */
export interface DataSource {
  /** Subscribe to every pushed message. Returns an unsubscribe function. */
  subscribe(listener: (msg: ServerMessage) => void): () => void;
  /** Subscribe to connection status changes. Returns an unsubscribe function. */
  subscribeStatus(listener: () => void): () => void;
  getStatus(): ConnectionStatus;
  /** Screen currently selected by the PLC, if known. */
  getActiveScreen(): Promise<number | undefined>;
  getAlarms(): Promise<Alarm[]>;
  getShiftPattern(): Promise<ShiftPatternRow[] | undefined>;
  getOeeDetails(): Promise<OeeDetails | undefined>;
  /** Today + the previous 6 days (GET /api/history/days?n=7). */
  getDailyHistory(): Promise<DailyHistory | undefined>;
  /** Run-time highscores (GET /api/highscores). */
  getHighscores(): Promise<Highscores | undefined>;
  /** Screens, header and tag types of this display (?display=, default the first). Rejects with LayoutError if the layout is invalid. */
  getLayout(): Promise<Layout>;
  /** Ask for an immediate full_snapshot push (read-only, no PLC write). */
  requestSnapshot(): void;
}

/** The layout (dashboard.yaml or the published version) failed validation; `details` are the "fil:rad nyckel → ...: fel" lines. */
export class LayoutError extends Error {
  details: string[];
  constructor(details: string[]) {
    super("invalid dashboard.yaml");
    this.details = details;
  }
}
