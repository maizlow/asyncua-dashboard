from fastapi import APIRouter
from fastapi.responses import JSONResponse

from backend.dashboard_config import ConfigError, get_dashboard

router = APIRouter(prefix="/api", tags=["Layout"])


@router.get("/layout")
async def get_layout():
    """Screens and items from dashboard.yaml (what the frontend renders). No node ids, read-only."""
    try:
        return get_dashboard().layout()
    except ConfigError as e:
        return JSONResponse(status_code=500, content={"error": "invalid dashboard.yaml", "details": e.errors})
