from fastapi import APIRouter
from fastapi.responses import JSONResponse

from backend.dashboard_config import ConfigError
from backend.layout_store import get_runtime

router = APIRouter(prefix="/api", tags=["Layout"])


@router.get("/layout")
async def get_layout(display: str | None = None):
    """Published layout for one display (default: the first): screens with x, y, w, h, header and
    tag types. No node ids, read-only."""
    try:
        rt = get_runtime()
    except ConfigError as e:
        return JSONResponse(status_code=500, content={"error": "invalid layout", "details": e.errors})
    try:
        return rt.view(display)
    except KeyError:
        known = ", ".join(rt.doc.displays)
        return JSONResponse(status_code=404, content={"error": "unknown display", "details": [f"okänd display '{display}' (finns: {known})"]})


@router.get("/displays")
async def get_displays():
    """Displays in the published layout (id + name), e.g. for choosing /?display=..."""
    try:
        rt = get_runtime()
    except ConfigError as e:
        return JSONResponse(status_code=500, content={"error": "invalid layout", "details": e.errors})
    return [{"id": k, "name": d.name} for k, d in rt.doc.displays.items()]
