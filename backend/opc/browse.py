"""Read-only browsing of a PLC's OPC UA address space for the editor (etapp 3).

Strictly read-only: this module only sends Browse, BrowseNext (to release continuation points) and
Read requests. It never writes, never calls methods and never creates subscriptions; a test enforces
that by checking the source and by trapping asyncua's write and subscription calls.

Session model: the running dashboard keeps its own client on the OPC thread (one PLC until etapp 4).
Browsing uses a separate, short-lived session per PLC on the API's event loop, opened on the first
request and closed after IDLE_S seconds without one, so the editor can never disturb the TV's
subscriptions and nothing stays connected when nobody edits. Requests on one session are serialised
(one at a time towards the PLC), each has a timeout, and every result is capped (big S7-1500 trees:
DataBlocksGlobal with hundreds of DBs, ServerInterfaces, the server's own diagnostics).
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections import deque
from contextlib import suppress
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from asyncua import Client, ua
from asyncua.ua import uaerrors

logger = logging.getLogger(__name__)

CONNECT_TIMEOUT_S = 6.0
REQUEST_TIMEOUT_S = 8.0
IDLE_S = 60.0
MAX_CHILDREN = 500           # per browse call (default 200)
BATCH = 100                  # node ids per Browse/Read request (well under S7-1500 operation limits)
SEARCH_MAX_NODES = 3000      # nodes visited by one search
SEARCH_MAX_DEPTH = 8
SEARCH_MAX_RESULTS = 100
SEARCH_TIME_S = 10.0
RATE_WINDOW_S = 10.0
RATE_MAX = 40                # requests per user per window
OBJECTS = "i=85"
SERVER_OBJECT = ua.NodeId(ua.ObjectIds.Server)  # the server's own diagnostics: large, never useful for tags

_MASK = int(ua.NodeClass.Object) | int(ua.NodeClass.Variable)
_HIERARCHICAL = ua.NodeId(ua.ObjectIds.HierarchicalReferences)
_A = ua.AttributeIds


class BrowseError(Exception):
    """An error for the editor: HTTP status + a Swedish message."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


# ----------------------------------------------------------------------------- client factory

async def make_client(url: str) -> Client:
    """A client with the same security and credentials as the dashboard's own (see opc_client_manager).
    No load_data_type_definitions: browsing doesn't need it and it is slow on an S7-1500."""
    from asyncua.crypto.security_policies import SecurityPolicyBasic256Sha256

    from backend.settings import settings

    client = Client(url, timeout=REQUEST_TIMEOUT_S)
    client.application_uri = "urn:asyncua-dashboard:client"
    await client.set_security(SecurityPolicyBasic256Sha256, certificate=settings.client_cert_path, private_key=settings.client_key_path)
    if settings.opc_username:
        client.set_user(settings.opc_username)
        client.set_password(settings.opc_password)
    return client


def connection_url(cid: str) -> str:
    """The PLC's url from the published layout (OPC_ENDPOINT_URL wins for the running connection, as
    in the dashboard itself)."""
    from backend.layout_store import get_runtime
    from backend.settings import settings

    rt = get_runtime()
    conn = rt.doc.connections.get(cid)
    if conn is None:
        known = ", ".join(rt.doc.connections) or "inga"
        raise BrowseError(404, f"PLC:n '{cid}' finns inte i den publicerade layouten (finns: {known}). Publicera först om du lagt till den.")
    url = (settings.opc_endpoint_url if cid == rt.connection_id and settings.opc_endpoint_url else None) or conn.url
    if not url:
        raise BrowseError(400, f"PLC:n '{cid}' har ingen url (connections → {cid} → url).")
    return url


# ----------------------------------------------------------------------------- helpers

def parse_node(text: str | None) -> ua.NodeId:
    text = (text or OBJECTS).strip()
    try:
        return ua.NodeId.from_string(text)
    except Exception:
        raise BrowseError(400, f"Ogiltigt nod-id: {text!r}. Exempel: ns=3;s=\"DB Production TV\".\"dashboardData\".\"oee\" eller i=85.") from None


def json_value(v: Any) -> Any:
    """An OPC UA value as JSON (preview only)."""
    if v is None or isinstance(v, (bool, int, float, str)):
        return v
    if isinstance(v, datetime):
        return v.isoformat()
    if isinstance(v, (bytes, bytearray)):
        return v[:32].hex() + ("…" if len(v) > 32 else "")
    if isinstance(v, ua.LocalizedText):
        return v.Text
    if isinstance(v, ua.QualifiedName):
        return v.Name
    if isinstance(v, (list, tuple)):
        return [json_value(x) for x in v[:10]] + (["…"] if len(v) > 10 else [])
    if isinstance(v, ua.NodeId):
        return v.to_string()
    return str(v)[:200]


def _status_name(code: ua.StatusCode) -> str:
    try:
        return code.name
    except Exception:
        return hex(code.value)


def _access(level: Any) -> tuple[bool, bool]:
    try:
        n = int(level)
    except (TypeError, ValueError):
        return False, False
    return bool(n & (1 << ua.AccessLevel.CurrentRead)), bool(n & (1 << ua.AccessLevel.CurrentWrite))


def _chunks(seq: list, n: int = BATCH):
    for i in range(0, len(seq), n):
        yield seq[i : i + n]


# ----------------------------------------------------------------------------- session

@dataclass
class _Session:
    url: str
    client: Client
    loop: asyncio.AbstractEventLoop
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    timer: asyncio.TimerHandle | None = None
    type_names: dict[str, str] = field(default_factory=dict)


class BrowseService:
    def __init__(self) -> None:
        self._sessions: dict[str, _Session] = {}
        self._opening: dict[str, asyncio.Lock] = {}
        self._calls: dict[str, deque] = {}

    # rate limit per editor user
    def check_rate(self, user: str) -> None:
        now = time.monotonic()
        q = self._calls.setdefault(user, deque())
        while q and now - q[0] > RATE_WINDOW_S:
            q.popleft()
        if len(q) >= RATE_MAX:
            raise BrowseError(429, "För många anrop mot PLC:n – vänta några sekunder.")
        q.append(now)

    async def _session(self, cid: str) -> _Session:
        url = connection_url(cid)
        loop = asyncio.get_running_loop()
        s = self._sessions.get(cid)
        if s and (s.loop is not loop or s.url != url):
            self._sessions.pop(cid, None)  # another event loop (tests) or a changed url: start over
            if s.loop is loop:
                await self._disconnect(s)
            s = None
        if s:
            return s
        lock = self._opening.setdefault(cid, asyncio.Lock())
        async with lock:
            s = self._sessions.get(cid)
            if s and s.loop is loop:
                return s
            client = await make_client(url)
            try:
                await asyncio.wait_for(client.connect(), CONNECT_TIMEOUT_S)
            except Exception as e:
                with suppress(Exception):
                    await client.disconnect()
                raise BrowseError(503, _unreachable(cid, url, e)) from None
            s = _Session(url=url, client=client, loop=loop)
            self._sessions[cid] = s
            logger.info("OPC browse session opened to %s (%s)", cid, url)
            return s

    def _touch(self, cid: str, s: _Session) -> None:
        if s.timer:
            s.timer.cancel()
        s.timer = s.loop.call_later(IDLE_S, lambda: asyncio.ensure_future(self.close(cid)))

    async def _disconnect(self, s: _Session) -> None:
        if s.timer:
            s.timer.cancel()
        with suppress(Exception):
            await asyncio.wait_for(s.client.disconnect(), 3)

    async def close(self, cid: str | None = None) -> None:
        for k in [cid] if cid else list(self._sessions):
            s = self._sessions.pop(k, None)
            if s:
                await self._disconnect(s)
                logger.info("OPC browse session to %s closed", k)

    async def _run(self, cid: str, fn):
        """Run fn(session) with the session lock and a timeout; connection errors close the session."""
        s = await self._session(cid)
        async with s.lock:
            try:
                return await asyncio.wait_for(fn(s), REQUEST_TIMEOUT_S * 2)
            except BrowseError:
                raise
            except (uaerrors.BadNodeIdUnknown, uaerrors.BadNodeIdInvalid):
                raise BrowseError(404, "Noden finns inte i PLC:n.") from None
            except (uaerrors.BadUserAccessDenied, uaerrors.BadNotReadable):
                raise BrowseError(403, "PLC:n tillåter inte att noden läses med dashboardens användare.") from None
            except uaerrors.UaStatusCodeError as e:
                raise BrowseError(502, f"PLC:n svarade med fel: {_status_name(ua.StatusCode(e.code))}.") from None
            except (asyncio.TimeoutError, TimeoutError):
                self._sessions.pop(cid, None)
                await self._disconnect(s)
                raise BrowseError(504, f"PLC:n '{cid}' svarade inte inom {REQUEST_TIMEOUT_S * 2:.0f} s. Försök igen.") from None
            except (ConnectionError, OSError) as e:
                self._sessions.pop(cid, None)
                await self._disconnect(s)
                raise BrowseError(503, _unreachable(cid, s.url, e)) from None
            finally:
                if cid in self._sessions:
                    self._touch(cid, s)

    # ------------------------------------------------------------------------- low level (read-only)

    async def _browse_many(self, s: _Session, nodes: list[ua.NodeId], max_refs: int) -> list[tuple[list[ua.ReferenceDescription], bool]]:
        """One level below each node (Objects and Variables over hierarchical references), at most
        max_refs per node; returns (references, truncated). Continuation points are released."""
        out: list[tuple[list[ua.ReferenceDescription], bool]] = []
        for part in _chunks(nodes):
            params = ua.BrowseParameters()
            params.View = ua.ViewDescription()
            params.RequestedMaxReferencesPerNode = max_refs + 1  # one extra: tells us there are more
            for nid in part:
                d = ua.BrowseDescription()
                d.NodeId = nid
                d.BrowseDirection = ua.BrowseDirection.Forward
                d.ReferenceTypeId = _HIERARCHICAL
                d.IncludeSubtypes = True
                d.NodeClassMask = _MASK
                d.ResultMask = ua.BrowseResultMask.All
                params.NodesToBrowse.append(d)
            results = await s.client.uaclient.browse(params)
            cps = []
            for r in results:
                if not r.StatusCode.is_good():
                    if len(part) == 1:
                        r.StatusCode.check()
                    out.append(([], False))
                    continue
                refs = [ref for ref in r.References if ref.IsForward]
                if r.ContinuationPoint:
                    cps.append(r.ContinuationPoint)
                # Servers may ignore the requested maximum (asyncua's does): cap here as well
                out.append((refs[:max_refs], bool(r.ContinuationPoint) or len(refs) > max_refs))
            if cps:
                nxt = ua.BrowseNextParameters()
                nxt.ReleaseContinuationPoints = True
                nxt.ContinuationPoints = cps
                with suppress(Exception):
                    await s.client.uaclient.browse_next(nxt)
        return out

    async def _read(self, s: _Session, items: list[tuple[ua.NodeId, int]]) -> list[ua.DataValue]:
        out: list[ua.DataValue] = []
        for part in _chunks(items, BATCH * 2):
            params = ua.ReadParameters()
            for nid, attr in part:
                rv = ua.ReadValueId()
                rv.NodeId = nid
                rv.AttributeId = attr
                params.NodesToRead.append(rv)
            out.extend(await s.client.uaclient.read(params))
        return out

    async def _type_names(self, s: _Session, type_ids: list[ua.NodeId]) -> None:
        unknown = []
        for t in type_ids:
            k = t.to_string()
            if k in s.type_names:
                continue
            if t.NamespaceIndex == 0 and isinstance(t.Identifier, int) and t.Identifier in ua.ObjectIdNames:
                s.type_names[k] = ua.ObjectIdNames[t.Identifier]
            else:
                unknown.append(t)
        unknown = list({t.to_string(): t for t in unknown}.values())
        if unknown:
            for t, dv in zip(unknown, await self._read(s, [(t, _A.BrowseName) for t in unknown]), strict=True):
                name = dv.Value.Value if dv.StatusCode.is_good() and dv.Value else None
                s.type_names[t.to_string()] = name.Name if isinstance(name, ua.QualifiedName) else t.to_string()

    async def _describe(self, s: _Session, refs: list[ua.ReferenceDescription], children: bool = True) -> list[dict[str, Any]]:
        """Children as JSON: variables get data type, access and array flag (one batched Read), and
        every node gets has_children (one batched Browse with one reference per node)."""
        nodes = [r.NodeId for r in refs]
        variables = [r.NodeId for r in refs if r.NodeClass == ua.NodeClass.Variable]
        attrs: dict[str, tuple] = {}
        if variables:
            dvs = await self._read(s, [(n, a) for n in variables for a in (_A.DataType, _A.AccessLevel, _A.ValueRank)])
            for i, n in enumerate(variables):
                dt, al, vr = (dvs[3 * i + k] for k in range(3))
                attrs[n.to_string()] = (
                    dt.Value.Value if dt.StatusCode.is_good() and dt.Value else None,
                    al.Value.Value if al.StatusCode.is_good() and al.Value else 0,
                    vr.Value.Value if vr.StatusCode.is_good() and vr.Value else -1,
                )
            await self._type_names(s, [a[0] for a in attrs.values() if isinstance(a[0], ua.NodeId)])
        has = [bool(r) for r, _ in await self._browse_many(s, nodes, 1)] if children and nodes else [False] * len(nodes)
        out = []
        for ref, h in zip(refs, has, strict=True):
            k = ref.NodeId.to_string()
            item: dict[str, Any] = {
                "node_id": k,
                "browse_name": ref.BrowseName.Name,
                "display_name": ref.DisplayName.Text or ref.BrowseName.Name,
                "node_class": ref.NodeClass.name,
                "has_children": h,
            }
            if k in attrs:
                dt, al, vr = attrs[k]
                readable, writable = _access(al)
                item.update(
                    data_type=s.type_names.get(dt.to_string(), dt.to_string()) if isinstance(dt, ua.NodeId) else None,
                    readable=readable,
                    writable=writable,
                    array=isinstance(vr, int) and vr >= 0,
                )
            out.append(item)
        return out

    # ------------------------------------------------------------------------- API

    async def browse(self, cid: str, node: str | None, limit: int = 200) -> dict[str, Any]:
        nid = parse_node(node)
        limit = max(1, min(limit, MAX_CHILDREN))

        async def fn(s: _Session):
            [(refs, truncated)] = await self._browse_many(s, [nid], limit)
            refs.sort(key=lambda r: (r.NodeId == SERVER_OBJECT, r.NodeClass != ua.NodeClass.Object, (r.DisplayName.Text or r.BrowseName.Name or "").lower()))
            return {"connection": cid, "node": nid.to_string(), "children": await self._describe(s, refs), "truncated": truncated, "limit": limit}

        return await self._run(cid, fn)

    async def read(self, cid: str, node: str) -> dict[str, Any]:
        nid = parse_node(node)

        async def fn(s: _Session):
            names = (_A.NodeClass, _A.DisplayName, _A.BrowseName, _A.DataType, _A.AccessLevel, _A.ValueRank, _A.Value)
            nc, dn, bn, dt, al, vr, val = await self._read(s, [(nid, a) for a in names])
            if not nc.StatusCode.is_good():
                nc.StatusCode.check()
            node_class = ua.NodeClass(nc.Value.Value).name
            if node_class != "Variable":
                raise BrowseError(400, f"Noden är en {node_class}, inte en variabel – välj en variabel för att läsa ett värde.")
            dtype = dt.Value.Value if dt.StatusCode.is_good() and dt.Value else None
            if isinstance(dtype, ua.NodeId):
                await self._type_names(s, [dtype])
            readable, writable = _access(al.Value.Value if al.StatusCode.is_good() and al.Value else 0)
            good = val.StatusCode.is_good()
            return {
                "connection": cid,
                "node_id": nid.to_string(),
                "display_name": dn.Value.Value.Text if dn.StatusCode.is_good() and dn.Value else None,
                "browse_name": bn.Value.Value.Name if bn.StatusCode.is_good() and bn.Value else None,
                "data_type": s.type_names.get(dtype.to_string()) if isinstance(dtype, ua.NodeId) else None,
                "readable": readable,
                "writable": writable,
                "array": isinstance(vr.Value.Value if vr.Value else None, int) and vr.Value.Value >= 0,
                "value": json_value(val.Value.Value) if good and val.Value else None,
                "status": _status_name(val.StatusCode),
                "source_time": val.SourceTimestamp.isoformat() if val.SourceTimestamp else None,
            }

        return await self._run(cid, fn)

    async def search(self, cid: str, q: str, root: str | None = None, depth: int = 5) -> dict[str, Any]:
        """Breadth-first walk below root (default: Objects, without the server's diagnostics) matching
        q in browse name, display name and node id, within node, depth and time caps."""
        q = (q or "").strip().lower()
        if len(q) < 2:
            raise BrowseError(400, "Sök på minst 2 tecken.")
        start = parse_node(root)
        depth = max(1, min(depth, SEARCH_MAX_DEPTH))

        async def fn(s: _Session):
            deadline = time.monotonic() + SEARCH_TIME_S
            level: list[tuple[ua.NodeId, list[str]]] = [(start, [])]
            seen = {start.to_string()}
            matches: list[tuple[ua.ReferenceDescription, list[str]]] = []
            visited, complete, reason = 0, True, None
            for _ in range(depth):
                if not level:
                    break
                nxt: list[tuple[ua.NodeId, list[str]]] = []
                for part in _chunks(level, 50):
                    if time.monotonic() > deadline:
                        complete, reason = False, "tid"
                        break
                    for (_nid, path), (refs, _t) in zip(part, await self._browse_many(s, [n for n, _ in part], MAX_CHILDREN), strict=True):
                        for r in refs:
                            k = r.NodeId.to_string()
                            if k in seen or r.NodeId == SERVER_OBJECT:
                                continue
                            seen.add(k)
                            visited += 1
                            name = r.DisplayName.Text or r.BrowseName.Name or ""
                            p = [*path, name]
                            if q in name.lower() or q in (r.BrowseName.Name or "").lower() or q in k.lower():
                                matches.append((r, path))
                            nxt.append((r.NodeId, p))
                    if visited >= SEARCH_MAX_NODES or len(matches) >= SEARCH_MAX_RESULTS:
                        complete, reason = False, "antal"
                        break
                if not complete:
                    break
                level = nxt
            else:
                if level:
                    complete, reason = False, "djup"
            matches = matches[:SEARCH_MAX_RESULTS]
            described = await self._describe(s, [m[0] for m in matches], children=False)
            for d, (_r, path) in zip(described, matches, strict=True):
                d["path"] = path
            return {"connection": cid, "root": start.to_string(), "q": q, "results": described, "visited": visited, "complete": complete, "stopped_by": reason}

        return await self._run(cid, fn)


def _unreachable(cid: str, url: str, e: BaseException) -> str:
    why = {
        ConnectionRefusedError: "anslutningen nekades (fel port eller OPC UA-servern är avstängd)",
        TimeoutError: f"inget svar inom {CONNECT_TIMEOUT_S:.0f} s (fel adress eller nätverket når inte PLC:n)",
        asyncio.TimeoutError: f"inget svar inom {CONNECT_TIMEOUT_S:.0f} s (fel adress eller nätverket når inte PLC:n)",
    }.get(type(e))
    if why is None and isinstance(e, OSError):
        why = f"nätverksfel ({e.strerror or e})"
    if why is None and isinstance(e, uaerrors.UaStatusCodeError):
        why = f"PLC:n nekade sessionen ({_status_name(ua.StatusCode(e.code))}) – kontrollera certifikat och användare"
    return f"Kan inte nå PLC:n '{cid}' ({url}): {why or type(e).__name__}. Kontrollera att PLC:n är på och nås från servern."


_service: BrowseService | None = None


def get_browse_service() -> BrowseService:
    global _service
    if _service is None:
        _service = BrowseService()
    return _service
