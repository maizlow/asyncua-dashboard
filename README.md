> 📋 Planerade och genomförda funktioner: se [ROADMAP.md](ROADMAP.md).

# Using `config.py` – DASHBOARD_DATA_NODES

## Overview

The `config.py` file acts as the central configuration for all OPC UA data points used in the dashboard. The most important part for the dashboard is the `DASHBOARD_DATA_NODES` list.

This list defines **which PLC variables** should be read, how they should be interpreted, and whether historical data should be collected for sparklines.

---

## Purpose of `DASHBOARD_DATA_NODES`

`DASHBOARD_DATA_NODES` tells the OPC client which nodes to subscribe to and how to store them in the `data_store`. The `alias` you define here becomes the key used in the frontend (`MetricCard`, etc.).

---

## Node Definition Structure

Each item in `DASHBOARD_DATA_NODES` is a dictionary with the following fields:

| Field          | Type    | Required | Description |
|----------------|---------|----------|-----------|
| `nodeid`       | string  | Yes      | Full OPC UA node ID or browse path |
| `datatype`     | string  | Yes      | Data type of the PLC variable (`DInt`, `Real`, `Int`, `Time_Of_Day`, etc.) |
| `alias`        | string  | Yes      | Friendly name used in the frontend and `data_store` |
| `historical`   | bool    | No       | If `true`, historical values are stored (used for sparklines) |

### Example

```python
{
    "nodeid": 'ns=3;s="DB Production TV"."dashboardData"."oee"',
    "datatype": "Real",
    "alias": "OEE",
    "historical": True,
}
```

---

## How It Works

1. The OPC client reads the `DASHBOARD_DATA_NODES` list at startup.
2. It subscribes to each `nodeid`.
3. When a value changes, it stores the value in `data_store` using the `alias` as the key.
4. If `historical: true`, the value is also added to the history buffer (used for sparklines in `MetricCard`).

---

## How to Add a New Metric

To display a new value on the dashboard, follow these steps:

### 1. Add the node to `DASHBOARD_DATA_NODES`

```python
{
    "nodeid": 'ns=3;s="DB Production TV"."dashboardData"."newMetric"',
    "datatype": "Real",
    "alias": "NewMetric",
    "historical": True,
}
```

### 2. Use it in the frontend (`DashboardScreen.tsx`)

```tsx
<MetricCard
  label="New Metric"
  value={metrics["NewMetric"]?.value ?? 0}
  unit="%"
  showSparkline={true}
  sparklineData={metrics["NewMetric"]?.history}
  sparklineDataAsDelta={true}
/>
```

---

## Best Practices

- Use clear, consistent `alias` names (e.g. `OEE`, `TPM`, `ProductionCount`).
- Set `historical: true` only when you need sparklines or trend data.
- Keep `datatype` accurate — it helps with correct value handling.
- Group related nodes logically in the list for readability.

---

## Full Example

```python
DASHBOARD_DATA_NODES = [
    {
        "nodeid": 'ns=3;s="DB Production TV"."dashboardData"."oee"',
        "datatype": "Real",
        "alias": "OEE",
        "historical": True,
    },
    {
        "nodeid": 'ns=3;s="DB Production TV"."dashboardData"."runtime"',
        "datatype": "Time_Of_Day",
        "alias": "CurrentRuntime",
        "historical": False,
    }
]
```

# MetricCard Usage Summary

## Overview

The `MetricCard` component is a flexible, reusable UI block used to display live industrial metrics. It supports multiple display modes including:

- Simple value display
- Delta / trend indicators
- Sparkline charts
- Progress bars (value vs target)
- Custom string formatting (e.g. time values)

---

## Current Usages in `DashboardScreen.tsx`

### 1. Production Card (Progress Bar Mode)

```tsx
<MetricCard
  label="Production"
  value={41306}
  unit="pcs"
  progressTarget={50000}
  progressTargetUnit="pcs"
  showProgressBar={true}
/>
```

**Mode:** Progress bar  
**Features:** Shows current value against a target with a visual progress fill.

---

### 2. Delta Card (Sparkline + Delta Mode)

```tsx
<MetricCard
  label="Delta"
  value={-1249}
  unit="pcs"
  delta={-24}
  deltaUnit="pcs"
  showSparkline={true}
  sparklineData={[10, -31, 40, 15, 11]}
  sparklineDataAsDelta={true}
/>
```

**Mode:** Sparkline + calculated delta  
**Features:** Displays a sparkline and automatically calculates delta from the last two values in `sparklineData`.

---

### 3. Efficiency Card (Sparkline + Delta Mode)

```tsx
<MetricCard
  label="Efficiency"
  value={89.03}
  unit="%"
  delta={2.1}
  showSparkline={true}
  sparklineData={[-2.2, -2.9, -1.5, -0.5, 2.2]}
  sparklineDataAsDelta={true}
/>
```

**Mode:** Sparkline + delta  
**Features:** Shows percentage value with trend sparkline and delta.

---

### 4. Line Speed Card (Sparkline + Delta Mode)

```tsx
<MetricCard
  label="Line speed"
  value={120.2}
  unit="TPM"
  delta={1.2}
  deltaUnit="TPM"
  showSparkline={true}
  sparklineData={[-2.2, -2.9, -1.5, -0.2, 2.2]}
  sparklineDataAsDelta={true}
/>
```

**Mode:** Sparkline + delta  
**Features:** Displays speed with unit and trend visualization.

---

### 5. Current Run Time (Simple String Value)

```tsx
<MetricCard
  label="Current run time"
  value={"00:42:13"}   
/>
```

**Mode:** Plain string display  
**Features:** Shows time-formatted string without any numeric formatting or charts.

---

### 6. Total Stop Time (Styled String Value)

```tsx
<MetricCard
  label="Total stop time"
  value={"00:23:53"}   
  stringValueColor="text-[var(--accent-red)]" 
/>
```

**Mode:** Styled string display  
**Features:** Uses `stringValueColor` to apply custom theming (in this case red for stop time).

---

## Supported Props Summary

| Prop                    | Type             | Description                                      | Used In |
|-------------------------|------------------|--------------------------------------------------|--------|
| `label`                 | string           | Card title                                       | All |
| `value`                 | number \| string | Main displayed value                             | All |
| `unit`                  | string           | Unit suffix after value                          | 1, 2, 3, 4 |
| `delta`                 | number           | Manual delta value                               | 2, 3, 4 |
| `deltaUnit`             | string           | Unit for delta                                   | 2, 4 |
| `showSparkline`         | boolean          | Enable sparkline chart                           | 2, 3, 4 |
| `sparklineData`         | number[]         | Data for sparkline                               | 2, 3, 4 |
| `sparklineDataAsDelta`  | boolean          | Calculate delta from sparkline data              | 2, 3, 4 |
| `showProgressBar`       | boolean          | Show progress bar instead of sparkline           | 1 |
| `progressTarget`        | number           | Target value for progress bar                    | 1 |
| `progressTargetUnit`    | string           | Unit for progress target                         | 1 |
| `stringValueColor`      | string           | Tailwind class for non-numeric values            | 6 |

---

## Design Patterns Observed

- **Progress Mode**: Used when comparing current value to a target.
- **Trend Mode**: Used for live values with historical sparkline + delta.
- **Status Mode**: Used for time-based or non-numeric values with optional color theming.

---
---

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
Certificates/private keys live in `certificates/` and are git-ignored. Never commit `.env` or key material.

The WebSocket URL defaults to `ws(s)://<page host>/ws` (the Vite dev server proxies `/ws` and `/api` to `localhost:8000`);
set `VITE_WS_URL` at build time to override.

The dashboard is display-only: the REST API is read-only, and the only value written to the PLC is `ActiveScreenNr`,
set internally by the backend's screen handler when the PLC requests a screen.

### Screens (`ActiveScreenNr`)

| Nr | Screen |
|----|--------|
| 1 | Larm (alarms) |
| 2 | Dashboard |
| 3 | Skiftmönster (shift pattern) |
| 4 | OEE (availability/performance/quality, production vs target, scrap, rate, stops, remaining shift time) |

The UI is designed on a fixed 3840×2160 canvas that is scaled to fit any screen (`ScaledCanvas.tsx`); 21:9 screens are letterboxed.
In demo mode, `?screen=N` pins a single screen instead of cycling, `?alarms=many` adds many long alarms and `?count=999999` forces all count fields to 6 digits, `?stopped=1` shows a stopped line with 999 stops (overflow tests).

Sized for a 65" 1080p TV read from 8–10 m: hero numbers ≥ 90 px cap height at 1080p (290 px on the canvas), alarm text
≈ 79 px, nothing important below ≈ 37 px (≈ 12 arcmin at 8 m). Status is never colour-only (▲/▼/●, "UNDER MÅL", "LARM"/"VARNING").

No screen may overflow or scroll. `npm run check:fit` (needs a served demo build and Chrome, see `frontend/scripts/check-fit.mjs`)
checks all screens at 1280×720, 1366×768, 1920×1080, 2560×1080 and 3840×2160; CI runs it on every push.

### OEE

OEE values are computed in the backend (`backend/opc/oee.py`) and served at `GET /api/oee` and as `oee_details` WebSocket messages
(every `OEE_INTERVAL_S`, default 5 s). The nominal rate is `NOMINAL_RATE_TPM` (default 140 tiles/min).
A = run time / elapsed shift time, P = total / (run minutes × nominal) (capped at 100 %), Q = good / total.
`GoodCount` and `RejectCount` in `backend/config.py` are placeholders until the real PLC node IDs are known;
until then they are skipped and `ProductionCount` is used as the good count.

## Backend internals

- **Threads/loops:** the OPC UA client runs on its own thread and event loop; FastAPI/WebSockets run on uvicorn's loop.
  OPC callbacks never touch sockets directly — they call `broadcaster.publish()` (`backend/app/broadcaster.py`), which hands
  messages to the uvicorn loop with `call_soon_threadsafe`; a single consumer sends them in order.
- **SQLite:** one writer thread with one connection (`backend/opc/database.py`); value changes are queued and batch-inserted.
  Timestamps are stored in UTC. `RETENTION_DAYS` (default 30) controls how long `data_points` are kept.
- **Shifts:** `ShiftStart`/`ShiftEnd` from the PLC are plant-local times, resolved in `TIMEZONE` (or the system local zone),
  DST-aware. Shifts crossing midnight (e.g. 22:00–06:00) are supported.
- **Tests:** `pip install -r backend/requirements-dev.txt && python -m pytest`
