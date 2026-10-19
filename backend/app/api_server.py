import uvicorn
from fastapi import FastAPI

from backend.settings import settings


def run_fastapi_server(app: FastAPI = None):
    """API, WebSocket, TV view and editor on one port (HTTP_PORT, default 8000). Plain HTTP: see docs/DRIFT.md."""
    if app is None:
        app = FastAPI(title="Production Dashboard API")

    uvicorn.run(
        app,
        host=settings.http_host,
        port=settings.http_port,
        log_level="info",
        proxy_headers=True,               # X-Forwarded-Proto from a TLS proxy in front (docs/DRIFT.md)
        forwarded_allow_ips=settings.forwarded_allow_ips,
    )
