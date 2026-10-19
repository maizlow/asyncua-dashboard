#!/usr/bin/env bash
# The real backend (python -m backend.app.main) serving frontend/dist on one port, for e2e-serve/.
# Throwaway database and editor account; the PLC address is unreachable on purpose, so the OPC client
# just keeps retrying in the background while the TV view and the editor are tested.
set -euo pipefail
cd "$(dirname "$0")/../.."
export HTTP_PORT="${SERVE_PORT:-8010}"
export DB_PATH="${SERVE_DB:-/tmp/serve-e2e.db}"
export OPC_ENDPOINT_URL="opc.tcp://127.0.0.1:9/"
export CLIENT_CERT=none.pem CLIENT_KEY=none.pem
export FRONTEND_DIST="${SERVE_DIST:-frontend/dist}"
export LOG_LEVEL=WARNING
PY="${PYTHON:-python}"
rm -f "$DB_PATH" "$DB_PATH-wal" "$DB_PATH-shm"
: "${SERVE_PASSWORD:?set by playwright.serve.config.ts}"
printf '%s\n%s\n' "$SERVE_PASSWORD" "$SERVE_PASSWORD" | "$PY" -m backend.users add e2e  # getpass warns about echo without a terminal: harmless
exec "$PY" -m backend.app.main
