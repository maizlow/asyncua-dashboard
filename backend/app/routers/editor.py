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

from backend.dashboard_config import ConfigError
from backend.layout_doc import check_document, document_json, document_yaml, runtime_problems, validate_document
from backend.layout_store import LayoutStore, get_runtime, publish
from backend.users import SESSION_HOURS, get_user_store

COOKIE = "aud_editor"
MAX_FAILURES, FAILURE_WINDOW_S = 5, 300

router = APIRouter(prefix="/api/editor", tags=["Editor"])
MAX_DOC_BYTES = 1_000_000
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


# ---------------------------------------------------------------- drafts, validation, publishing

_store: LayoutStore | None = None


def get_layout_store() -> LayoutStore:
    global _store
    if _store is None:
        _store = LayoutStore()
    return _store


class DocBody(BaseModel):
    document: dict
    base_version: int | None = None


class PublishBody(DocBody):
    comment: str | None = Field(None, max_length=200)


def _check(raw: dict) -> dict:
    doc, problems = check_document(raw)
    runtime = runtime_problems(doc) if doc is not None else []
    return {"ok": doc is not None and not problems and not runtime, "problems": problems, "runtime": runtime}


@router.get("/draft")
async def get_draft(user: str = Depends(require_user)):
    """The saved draft (null if none). `stale`: a newer version was published after it was started."""
    d = await get_layout_store().draft()
    if d is not None:
        d["stale"] = d["base_version"] != get_runtime().version
    return {"draft": d}


@router.put("/draft", dependencies=[Depends(require_csrf_header)])
async def put_draft(body: DocBody, request: Request, user: str = Depends(require_user)):
    if int(request.headers.get("content-length") or 0) > MAX_DOC_BYTES:
        raise HTTPException(status_code=413, detail="dokumentet är för stort")
    saved = await get_layout_store().save_draft(body.document, body.base_version, user)
    return {"saved": saved}


@router.delete("/draft", dependencies=[Depends(require_csrf_header)])
async def delete_draft(user: str = Depends(require_user)):
    await get_layout_store().clear_draft()
    return {"ok": True}


@router.post("/validate", dependencies=[Depends(require_csrf_header)])
async def validate(body: DocBody, user: str = Depends(require_user)):
    return _check(body.document)


@router.post("/publish", dependencies=[Depends(require_csrf_header)])
async def publish_draft(body: PublishBody, user: str = Depends(require_user)):
    """Publish the document as a new version. Refused (409) when someone else published since the
    editor loaded `base_version`, and (422) when it doesn't validate or the runtime can't run it."""
    rt = get_runtime()
    if body.base_version != rt.version:
        raise HTTPException(status_code=409, detail=f"version {rt.version} har publicerats sedan du började – ladda om och gör ändringen igen")
    result = _check(body.document)
    if not result["ok"]:
        raise HTTPException(status_code=422, detail={"message": "dokumentet går inte att publicera", **result})
    doc = validate_document(body.document, "utkastet")
    old_nodes = rt.data_nodes()
    store = get_layout_store()
    new = await publish(store, doc, author=user, comment=(body.comment or "").strip() or None)
    await store.clear_draft()
    return {"version": new.version, "restart_needed": new.data_nodes() != old_nodes}


@router.get("/versions")
async def versions(user: str = Depends(require_user)):
    return {"versions": await get_layout_store().versions(limit=100), "published": get_runtime().version}


async def _version_doc(vid: int):
    raw = await get_layout_store().version(vid)
    if raw is None:
        raise HTTPException(status_code=404, detail=f"version {vid} finns inte")
    try:
        return validate_document(raw, f"version {vid}")  # older versions are migrated when read
    except ConfigError as e:
        raise HTTPException(status_code=422, detail={"message": f"version {vid} är ogiltig", "errors": e.errors}) from None


@router.get("/versions/{vid}")
async def version(vid: int, user: str = Depends(require_user)):
    """One version as a document (to load into the editor as a draft: restoring = publishing it again)."""
    return {"version": vid, "document": document_json(await _version_doc(vid))}


@router.get("/versions/{vid}/export.yaml")
async def export_version(vid: int, user: str = Depends(require_user)):
    body = document_yaml(await _version_doc(vid))
    return Response(body, media_type="application/yaml", headers={"Content-Disposition": f'attachment; filename="layout-v{vid}.yaml"'})
