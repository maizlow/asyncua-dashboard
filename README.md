> 📋 Planerade och genomförda funktioner: se [ROADMAP.md](ROADMAP.md).

# asyncua-dashboard

Display-only TV dashboard for a Siemens S7-1500 line (OPC UA via asyncua, FastAPI backend, React frontend).

## Configuration: `dashboard.yaml`

Everything that is shown — OPC UA nodes, PLC tags, screens and the items on each screen — is configured in
[`dashboard.yaml`](dashboard.yaml) in the project root. No code changes are needed to add, remove or rebind an item.

📖 **[docs/CONFIG.md](docs/CONFIG.md)** (svenska): format reference and step by step *Lägga till ett nytt dashboard-objekt*.

🧮 **[docs/BERAKNINGAR.md](docs/BERAKNINGAR.md)** (svenska): formulas for every calculated value on the screens (OEE, mål, prognos, kassation, stopp, skift kvar, trend, colours).

```yaml
tags:
  OEE: ns=3;s="DB Production TV"."dashboardData"."oee"
screens:
  2:
    items:
      - { label: OEE, tag: OEE, type: percent, trend: true, thresholds: [75, 85] }
```

Check the file with `python -m backend.dashboard_config` (errors point at line and key). JSON schema for editor
autocompletion: [`docs/dashboard.schema.json`](docs/dashboard.schema.json).

**The database is the source of truth for the layout.** The backend imports `dashboard.yaml` into SQLite as version 1
on first start. Before the editor is used, a changed file is imported again at start-up as a new version. After the
first publish from the editor, the editor wins (`LAYOUT_YAML_IMPORT=auto`; `always` keeps importing, `off` never reads
the file again). The backend serves the published version at `GET /api/layout?display=…`. The demo build bundles the
same file.

Internally the layout is a *layout document* (`schema_version: 2`):
- `connections` is a shared pool of PLCs.
- `displays` are TVs. Each display can read several PLCs (tags are `plc2.Level`, or short names with a
  `default_connection`), and PLCs are shared between displays with one OPC UA client per PLC.
- Each display has its own header logos and screens on a fixed 24 × 12 grid.

Commands:
- `python -m backend.layout_doc --migrate` shows the converted document.
- `python -m backend.layout_store list|show N|restore N` manages the versions.

See [docs/CONFIG.md](docs/CONFIG.md#var-layouten-sparas-databasen) and the planned editor in
[docs/EDITOR-PLAN.md](docs/EDITOR-PLAN.md).

### Layout editor (`/editor/`)

The editor is under construction ([docs/EDITOR-PLAN.md](docs/EDITOR-PLAN.md)). It needs a login: two local accounts,
stored as argon2 hashes in `data.db` and created on the server with `python -m backend.users add <name>`, which prompts
for the password. There is no signup page.

The editor never writes to the PLC; its previews use simulated values. The demo editor at
https://maizlow.github.io/asyncua-dashboard/editor/ has no login and no backend and uses fake node ids. See
[docs/CONFIG.md](docs/CONFIG.md#editorn-konton-och-inloggning).

## Running in production

Build the frontend (`cd frontend && npm run build`), then `python -m backend.app.main`. The backend serves the TV view at
`/`, the editor at `/editor/`, the API and `/ws` on one port (`HTTP_PORT`, default 8000). It is plain HTTP for now, so
the editor login travels unencrypted on the plant network. 📖 **[docs/DRIFT.md](docs/DRIFT.md)** (svenska) covers the
settings, caching, the Docker plan and how to add HTTPS with a TLS proxy.

## Demo mode / preview

The frontend can run without backend or PLC using built-in simulated data:

```bash
cd frontend
VITE_DEMO=true npm run dev          # local demo
VITE_DEMO=true VITE_BASE=/asyncua-dashboard/ npm run build   # what GitHub Pages builds
```

Pushes to `main` deploy the demo to https://maizlow.github.io/asyncua-dashboard/ (`.github/workflows/pages.yml`).

## Configuration & secrets

Copy `.env.example` to `.env` in the project root and fill in the OPC UA endpoint, credentials and certificate file names.
Secrets (password, certificates) only live in `.env`; tags and screens live in `dashboard.yaml` (path override: `DASHBOARD_CONFIG`).
Certificates/private keys live in `certificates/` and are git-ignored. Never commit `.env` or key material.

The WebSocket URL defaults to `ws(s)://<page host>/ws` (the Vite dev server proxies `/ws` and `/api` to `localhost:8000`);
set `VITE_WS_URL` at build time to override.

The dashboard is display-only: the REST API is read-only, and the only value written to the PLC is `ActiveScreenNr`,
set internally by the backend's screen handler when the PLC requests a screen.

### Screens (`ActiveScreenNr`)

Defined in `dashboard.yaml` (`screens:`); the example file has:

| Nr | Screen |
|----|--------|
| 1 | Larm (alarms) |
| 2 | Dashboard |
| 3 | Skiftmönster (shift pattern) |
| 4 | OEE (availability/performance/quality, production vs target, scrap, rate, stops, remaining shift time) |
| 5 | 7 dagar (today + previous 6 days from the SQLite history: OEE %, good count per day vs day target) |
| 6 | Highscore (the five longest runs without a stop: run time, shift team, date; ongoing run vs record) |

The UI is designed on a fixed 3840×2160 canvas that is scaled to fit any screen (`ScaledCanvas.tsx`); 21:9 screens are letterboxed.
In demo mode, `?layout=stress` loads the worst-case layout `docs/examples/stress.yaml`, `?screen=N` pins a single screen instead of cycling, `?alarms=many` adds many long alarms and `?count=999999` forces all count fields to 6 digits, `?stopped=1` shows a stopped line with 999 stops (overflow tests).

Sized for a 65" 1080p TV read from 8–10 m: hero numbers ≥ 90 px cap height at 1080p (290 px on the canvas), alarm text
≈ 79 px, nothing important below ≈ 37 px (≈ 12 arcmin at 8 m). Status is never colour-only (▲/▼/●, "UNDER MÅL", "LARM"/"VARNING").

No screen may overflow or scroll. `npm run check:fit` (needs a served demo build and Chrome, see `frontend/scripts/check-fit.mjs`)
checks all screens at 1280×720, 1366×768, 1920×1080, 2560×1080 and 3840×2160; CI runs it on every push.

### OEE

OEE values are computed in the backend (`backend/opc/oee.py`) and served at `GET /api/oee` and as `oee_details` WebSocket messages
(every `OEE_INTERVAL_S`, default 5 s). The nominal rate is `NOMINAL_RATE_TPM` (default 140 tiles/min).
A = run time / planned time so far (`PlannedTime` minutes excl. breaks, pro rata; else elapsed shift time), P = total / (run minutes × nominal) (both capped at 100 %), Q = good / total (unknown without `RejectCount`).
Targets come from the PLC: `ShiftTarget` (whole-shift target, tiles; target so far = pro rata) and `OeeTarget` (%, default 85).
Without `ShiftTarget` the targets show `–` – there is no fallback to the nominal rate.
`GoodCount`, `RejectCount`, `ShiftTarget`, `OeeTarget`, `PlannedTime` and `ShiftTeam` in `dashboard.yaml` are placeholders (empty node id) until the real PLC
node IDs are known; until then `ProductionCount` (assumed to include rejects) is used for the counts.
All formulas, edge cases and worked examples: [docs/BERAKNINGAR.md](docs/BERAKNINGAR.md).

## Backend internals

- **Threads/loops:** the OPC UA client runs on its own thread and event loop; FastAPI/WebSockets run on uvicorn's loop.
  OPC callbacks never touch sockets directly — they call `broadcaster.publish()` (`backend/app/broadcaster.py`), which hands
  messages to the uvicorn loop with `call_soon_threadsafe`; a single consumer sends them in order.
- **SQLite:** one writer thread with one connection (`backend/opc/database.py`); value changes are queued and batch-inserted.
  Timestamps are stored in UTC. `RETENTION_DAYS` (default 30) controls how long `data_points` are kept (keep it ≥ 7 for the 7-day screen).
- **7-day screen (`type: week`):** `backend/opc/daily.py` aggregates per local calendar day (`TIMEZONE`, DST-aware, split at
  midnight) with SQL window functions; past days are cached and only today is recomputed every `HISTORY_INTERVAL_S` (default 60 s).
  Served at `GET /api/history/days?n=7` and pushed as `daily_history`. Formulas: [docs/BERAKNINGAR.md](docs/BERAKNINGAR.md#skärm-7-dagar-type-week).
- **Shift log:** `backend/opc/shifts.py` persists one row per shift in the `shifts` table (never purged): parameters
  (`ShiftTarget`, `OeeTarget`, `PlannedTime`, `ShiftTeam`), counter deltas, run/stop time. Shift changes are detected from
  `ShiftStart` (or the clock for single-shift plants) and settle for `SHIFT_SETTLE_S` (default 10 s) because tags arrive in
  different OPC frames. The 7-day screen aggregates over these rows (raw history for days before the log existed).
  `GET /api/shifts?limit=20`. Design and formulas: [docs/BERAKNINGAR.md](docs/BERAKNINGAR.md#skiftlogg-tabellen-shifts).
- **Highscores:** `backend/opc/highscore.py` tracks runs (ProductionState == 2 without a stop; stops shorter than
  `HIGHSCORE_MIN_STOP_S`, default 0, are bridged) from the exact state-change timestamps and stores them in `run_records`
  (never purged). An ongoing run is closed at its last confirmed time on restart or OPC disconnect. `GET /api/highscores?n=5`,
  pushed as `highscores`.
- **Shifts:** `ShiftStart`/`ShiftEnd` from the PLC are plant-local times, resolved in `TIMEZONE` (or the system local zone),
  DST-aware. Shifts crossing midnight (e.g. 22:00–06:00) are supported.
- **Tests:** `pip install -r backend/requirements-dev.txt && python -m pytest`; frontend formatters: `cd frontend && npm test`
