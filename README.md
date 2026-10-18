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

Check the file with `python -m backend.dashboard_config` (errors point at line and key). The backend validates it at start-up
and serves it at `GET /api/layout`; the demo build bundles the same file. JSON schema for editor autocompletion:
[`docs/dashboard.schema.json`](docs/dashboard.schema.json).

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

The UI is designed on a fixed 3840×2160 canvas that is scaled to fit any screen (`ScaledCanvas.tsx`); 21:9 screens are letterboxed.
In demo mode, `?layout=stress` loads the worst-case layout `docs/examples/stress.yaml`, `?screen=N` pins a single screen instead of cycling, `?alarms=many` adds many long alarms and `?count=999999` forces all count fields to 6 digits, `?stopped=1` shows a stopped line with 999 stops (overflow tests).

Sized for a 65" 1080p TV read from 8–10 m: hero numbers ≥ 90 px cap height at 1080p (290 px on the canvas), alarm text
≈ 79 px, nothing important below ≈ 37 px (≈ 12 arcmin at 8 m). Status is never colour-only (▲/▼/●, "UNDER MÅL", "LARM"/"VARNING").

No screen may overflow or scroll. `npm run check:fit` (needs a served demo build and Chrome, see `frontend/scripts/check-fit.mjs`)
checks all screens at 1280×720, 1366×768, 1920×1080, 2560×1080 and 3840×2160; CI runs it on every push.

### OEE

OEE values are computed in the backend (`backend/opc/oee.py`) and served at `GET /api/oee` and as `oee_details` WebSocket messages
(every `OEE_INTERVAL_S`, default 5 s). The nominal rate is `NOMINAL_RATE_TPM` (default 140 tiles/min).
A = run time / elapsed shift time, P = total / (run minutes × nominal) (both capped at 100 %), Q = good / total (unknown without `RejectCount`).
Targets come from the PLC: `ShiftTarget` (whole-shift target, tiles; target so far = pro rata) and `OeeTarget` (%, default 85).
Without `ShiftTarget` the targets show `–` – there is no fallback to the nominal rate.
`GoodCount`, `RejectCount`, `ShiftTarget` and `OeeTarget` in `dashboard.yaml` are placeholders (empty node id) until the real PLC
node IDs are known; until then `ProductionCount` (assumed to include rejects) is used for the counts.
All formulas, edge cases and worked examples: [docs/BERAKNINGAR.md](docs/BERAKNINGAR.md).

## Backend internals

- **Threads/loops:** the OPC UA client runs on its own thread and event loop; FastAPI/WebSockets run on uvicorn's loop.
  OPC callbacks never touch sockets directly — they call `broadcaster.publish()` (`backend/app/broadcaster.py`), which hands
  messages to the uvicorn loop with `call_soon_threadsafe`; a single consumer sends them in order.
- **SQLite:** one writer thread with one connection (`backend/opc/database.py`); value changes are queued and batch-inserted.
  Timestamps are stored in UTC. `RETENTION_DAYS` (default 30) controls how long `data_points` are kept.
- **Shifts:** `ShiftStart`/`ShiftEnd` from the PLC are plant-local times, resolved in `TIMEZONE` (or the system local zone),
  DST-aware. Shifts crossing midnight (e.g. 22:00–06:00) are supported.
- **Tests:** `pip install -r backend/requirements-dev.txt && python -m pytest`; frontend formatters: `cd frontend && npm test`
