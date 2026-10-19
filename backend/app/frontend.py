"""Serve the built frontend (TV view at /, editor at /editor/) from FastAPI on the same port as the API.

`npm run build` writes frontend/dist:
    index.html          TV view            -> /, /?display=tv2, and any other page path (SPA fallback)
    editor/index.html   layout editor      -> /editor/ and /editor/<anything> (SPA fallback)
    assets/*            hashed JS/CSS      -> cached for a year (the file name changes with the content)
    favicon.svg, logos  public/ files      -> always revalidated (stable names)

The mount is added after all routers, and it never matches /api, /ws, /docs, /openapi.json or a WebSocket,
so those keep FastAPI's own answers (JSON 404, 405 for a wrong method) instead of index.html. A missing
asset is a real 404 (not HTML served as JavaScript).
The pages themselves are public: they hold no data or secrets (the same code is the public demo).
Everything the editor reads or changes goes through /api/editor/..., which requires the login.
"""

import logging
from pathlib import Path, PurePosixPath

from fastapi import FastAPI
from starlette.exceptions import HTTPException
from starlette.responses import Response
from starlette.routing import Match, Mount
from starlette.staticfiles import StaticFiles
from starlette.types import Scope

logger = logging.getLogger(__name__)

IMMUTABLE = "public, max-age=31536000, immutable"
REVALIDATE = "no-cache"  # may be stored, but always checked (ETag/Last-Modified give a cheap 304)
NOT_FRONTEND = {"api", "ws", "docs", "redoc", "openapi.json"}


class FrontendMount(Mount):
    """Mount at / that leaves the API, the WebSocket and the API docs to the router."""

    def matches(self, scope: Scope):
        first = scope["path"].lstrip("/").split("/", 1)[0]
        if scope["type"] != "http" or first in NOT_FRONTEND:
            return Match.NONE, {}
        return super().matches(scope)


class FrontendFiles(StaticFiles):
    def __init__(self, dist: Path):
        super().__init__(directory=dist, html=True, check_dir=True)

    async def get_response(self, path: str, scope: Scope) -> Response:
        parts = PurePosixPath(path).parts
        try:
            response = await super().get_response(path, scope)
        except HTTPException as exc:
            if exc.status_code != 404:
                raise
            response = await self._fallback(parts, scope)
        if response.status_code in (200, 304):
            hashed = bool(parts) and parts[0] == "assets"
            response.headers["Cache-Control"] = IMMUTABLE if hashed else REVALIDATE
        return response

    async def _fallback(self, parts: tuple[str, ...], scope: Scope) -> Response:
        """Client-side routes get their page; files that do not exist stay 404."""
        if (parts and parts[0] == "assets") or (parts and "." in parts[-1]):
            return Response("Not Found", status_code=404, media_type="text/plain")
        page = "editor/index.html" if parts and parts[0] == "editor" else "index.html"
        return await super().get_response(page, scope)


def mount_frontend(app: FastAPI, dist: Path) -> bool:
    """Mount the build at / if it exists. Call after include_router so API and WebSocket routes win."""
    missing = [p for p in ("index.html", "editor/index.html") if not (dist / p).is_file()]
    if missing:
        logger.warning(
            "Frontend build not found in %s (missing %s): serving the API only. Run `npm run build` in frontend/ "
            "or set FRONTEND_DIST.", dist, ", ".join(missing),
        )
        return False
    app.router.routes.append(FrontendMount("/", app=FrontendFiles(dist), name="frontend"))
    logger.info("Serving the frontend from %s (TV at /, editor at /editor/)", dist)
    return True
