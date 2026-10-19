"""Editor API under /api/editor (docs/EDITOR-PLAN.md, Backend-API). Everything except /login needs a
session; nothing here talks to the PLC.

Session: random token in the cookie `aud_editor` (HttpOnly, SameSite=Strict, Path=/api/editor), only
its sha256 is stored. CSRF: SameSite=Strict, plus every state-changing request must carry the header
`X-Editor: 1`, which a cross-site form or image can't send and CORS (localhost dev origins only)
doesn't allow from other sites. Login attempts are rate limited per client address.
"""

from __future__ import annotations

import time
from collections import defaultdict, deque

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from backend.layout_doc import document_json
from backend.layout_store import get_runtime
from backend.users import SESSION_HOURS, get_user_store

COOKIE = "aud_editor"
MAX_FAILURES, FAILURE_WINDOW_S = 5, 300

router = APIRouter(prefix="/api/editor", tags=["Editor"])
_failures: dict[str, deque[float]] = defaultdict(deque)


def _client(request: Request) -> str:
    return request.client.host if request.client else "?"


async def require_csrf_header(request: Request) -> None:
    if request.method not in ("GET", "HEAD", "OPTIONS") and request.headers.get("x-editor") != "1":
        raise HTTPException(status_code=403, detail="saknar X-Editor-huvudet")


async def require_user(request: Request) -> str:
    user = await get_user_store().session_user(request.cookies.get(COOKIE))
    if user is None:
        raise HTTPException(status_code=401, detail="inte inloggad")
    return user


class Login(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=1, max_length=256)


@router.post("/login", dependencies=[Depends(require_csrf_header)])
async def login(body: Login, request: Request, response: Response):
    ip, now = _client(request), time.monotonic()
    recent = _failures[ip]
    while recent and now - recent[0] > FAILURE_WINDOW_S:
        recent.popleft()
    if len(recent) >= MAX_FAILURES:
        raise HTTPException(status_code=429, detail="för många försök – vänta 5 minuter")
    store = get_user_store()
    if not await store.verify(body.name, body.password):
        recent.append(now)
        raise HTTPException(status_code=401, detail="fel namn eller lösenord")
    recent.clear()
    token = await store.create_session(body.name)
    response.set_cookie(
        COOKIE, token, max_age=SESSION_HOURS * 3600, httponly=True, samesite="strict",
        secure=request.url.scheme == "https", path="/api/editor",
    )
    return {"user": body.name}


@router.post("/logout", dependencies=[Depends(require_csrf_header)])
async def logout(request: Request, response: Response):
    await get_user_store().delete_session(request.cookies.get(COOKIE))
    response.delete_cookie(COOKIE, path="/api/editor")
    return {"ok": True}


@router.get("/session")
async def session(user: str = Depends(require_user)):
    return {"user": user}


@router.get("/document")
async def document(user: str = Depends(require_user)):
    """The published layout document in full (with node ids: the editor's tag picker shows them)."""
    rt = get_runtime()
    return {"version": rt.version, "document": document_json(rt.doc)}
