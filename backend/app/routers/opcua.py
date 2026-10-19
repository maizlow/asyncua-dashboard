"""Read-only OPC UA browsing for the editor (etapp 3), behind the editor login.

Under /api/editor because the session cookie is scoped to that path. Only GET: nothing here can
change the PLC (see backend/opc/browse.py for the session model, caps and timeouts).
"""

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.app.routers.editor import require_user
from backend.opc.browse import MAX_CHILDREN, SEARCH_MAX_DEPTH, BrowseError, get_browse_service

router = APIRouter(prefix="/api/editor/opcua", tags=["Editor"])


async def _call(user: str, coro_fn):
    svc = get_browse_service()
    try:
        svc.check_rate(user)
        return await coro_fn(svc)
    except BrowseError as e:
        raise HTTPException(status_code=e.status, detail=e.message) from None


@router.get("/{connection}/browse")
async def browse(
    connection: str,
    node: str | None = Query(None, description="Nod-id att lista barnen till (standard: Objects, i=85)"),
    limit: int = Query(200, ge=1, le=MAX_CHILDREN),
    user: str = Depends(require_user),
):
    """One level of the address space below `node`: Objects and Variables with node id, browse name,
    display name, node class, data type, access level, array flag and whether they have children."""
    return await _call(user, lambda s: s.browse(connection, node, limit))


@router.get("/{connection}/read")
async def read(connection: str, node: str = Query(..., min_length=1), user: str = Depends(require_user)):
    """One Read of a variable (value, data type, access level) for the editor's preview. No subscription."""
    return await _call(user, lambda s: s.read(connection, node))


@router.get("/{connection}/search")
async def search(
    connection: str,
    q: str = Query(..., min_length=2, max_length=100),
    root: str | None = Query(None, description="Sök under denna nod (standard: Objects)"),
    depth: int = Query(5, ge=1, le=SEARCH_MAX_DEPTH),
    user: str = Depends(require_user),
):
    """Find nodes by name or node id below `root`, within caps on depth, visited nodes and time."""
    return await _call(user, lambda s: s.search(connection, q, root, depth))
