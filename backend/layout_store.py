"""Layout document with versions in SQLite (table layout_versions), the source of truth.

At startup ``bootstrap`` publishes dashboard.yaml as version 1 the first time. Later the file is
imported again only when it has changed since the last import (sha256 in the meta table):
LAYOUT_YAML_IMPORT=auto (default) does that until the first publish from the editor, after which
the editor is the way to change the layout (a changed file is only logged); always keeps importing
a changed file, off never reads it again. Every import or publish is a new version; nothing is
ever deleted.

The running backend reads the published document through ``get_runtime()``.
"""

from __future__ import annotations

import hashlib
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.dashboard_config import ConfigError
from backend.layout_doc import (
    Connection,
    Display,
    LayoutDocument,
    document_json,
    document_yaml,
    layout_view,
    load_document,
    resolve_path,
    runtime_problems,
    validate_document,
)

logger = logging.getLogger(__name__)


class LayoutStore:
    def __init__(self, db=None):
        self._db = db

    @property
    def db(self):
        if self._db is None:
            from backend.opc.database import default_database

            self._db = default_database()
        return self._db

    async def init_db(self) -> None:
        def _init(conn):
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS layout_versions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    created_ts TEXT NOT NULL,
                    author TEXT,
                    source TEXT NOT NULL,
                    comment TEXT,
                    yaml_sha256 TEXT,
                    doc TEXT NOT NULL
                )
                """
            )
            conn.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)")

        await self.db.run_async(_init)

    async def get_meta(self, key: str) -> str | None:
        row = await self.db.run_async(lambda c: c.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone())
        return row[0] if row else None

    async def published(self) -> tuple[int, dict[str, Any]] | None:
        def _q(c):
            row = c.execute("SELECT value FROM meta WHERE key = 'layout_published'").fetchone()
            if not row:
                return None
            v = c.execute("SELECT id, doc FROM layout_versions WHERE id = ?", (int(row[0]),)).fetchone()
            return (v[0], json.loads(v[1])) if v else None

        return await self.db.run_async(_q)

    async def add_version(
        self,
        doc: LayoutDocument,
        source: str,
        author: str | None = None,
        comment: str | None = None,
        yaml_sha256: str | None = None,
        publish: bool = True,
    ) -> int:
        created = datetime.now(timezone.utc).isoformat(timespec="seconds")
        body = json.dumps(document_json(doc), ensure_ascii=False)

        def _ins(c):
            cur = c.execute(
                "INSERT INTO layout_versions (created_ts, author, source, comment, yaml_sha256, doc) VALUES (?, ?, ?, ?, ?, ?)",
                (created, author, source, comment, yaml_sha256, body),
            )
            vid = cur.lastrowid
            if publish:
                c.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ('layout_published', ?)", (str(vid),))
            if yaml_sha256:
                c.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ('layout_yaml_sha256', ?)", (yaml_sha256,))
            c.commit()
            return vid

        return await self.db.run_async(_ins)

    async def editor_used(self) -> bool:
        """True once anything has been published from the editor: from then on the database is edited
        in the editor and LAYOUT_YAML_IMPORT=auto no longer imports dashboard.yaml."""
        row = await self.db.run_async(lambda c: c.execute("SELECT 1 FROM layout_versions WHERE source = 'editor' LIMIT 1").fetchone())
        return row is not None

    async def version(self, vid: int) -> dict[str, Any] | None:
        row = await self.db.run_async(lambda c: c.execute("SELECT doc FROM layout_versions WHERE id = ?", (vid,)).fetchone())
        return json.loads(row[0]) if row else None

    async def versions(self, limit: int = 50) -> list[dict[str, Any]]:
        def _q(c):
            pub = c.execute("SELECT value FROM meta WHERE key = 'layout_published'").fetchone()
            rows = c.execute(
                "SELECT id, created_ts, author, source, comment FROM layout_versions ORDER BY id DESC LIMIT ?", (limit,)
            ).fetchall()
            return [
                {"id": r[0], "created": r[1], "author": r[2], "source": r[3], "comment": r[4], "published": bool(pub) and int(pub[0]) == r[0]}
                for r in rows
            ]

        return await self.db.run_async(_q)


class Runtime:
    """The published document as the running backend sees it: one connection and one display until
    etapp 4. The data store keys values by the short tag name; WebSocket messages carry the
    connection id so the displays (which reference plc1.OEE) can tell PLCs apart."""

    def __init__(self, doc: LayoutDocument, version: int | None = None):
        problems = runtime_problems(doc)
        if problems:
            raise ConfigError(Path("layout"), problems)
        self.doc = doc
        self.version = version
        self.display_id, self.display = next(iter(doc.displays.items()))
        self.connection_id = next(iter(doc.connections))  # the only one until etapp 4
        self.connection: Connection = doc.connections[self.connection_id]

    @property
    def screens(self) -> dict:
        return self.display.screens

    @property
    def tags(self) -> dict:
        return self.connection.tags

    def has_kind(self, kind: str) -> bool:
        return any(w.kind == kind for s in self.display.screens.values() for w in s.items)

    def data_nodes(self) -> list[dict[str, Any]]:
        """Subscriptions for opc_data_tags (empty node = TODO(PLC) placeholder, skipped)."""
        out = []
        for name in self.connection.tags:
            spec = self.connection.tag(name)
            node = spec.node.strip()
            out.append({"nodeid": node, "datatype": "Time_Of_Day" if spec.type == "time" else "Auto", "alias": name, "placeholder": not node})
        return out

    def view(self, display_id: str | None = None) -> dict[str, Any]:
        if display_id is not None and display_id not in self.doc.displays:
            raise KeyError(display_id)
        return layout_view(self.doc, display_id, self.version)

    def display_for(self, display_id: str) -> Display:
        return self.doc.displays[display_id]


_runtime: Runtime | None = None


def set_runtime(rt: Runtime) -> None:
    global _runtime
    _runtime = rt


def get_runtime() -> Runtime:
    """The published layout. Before ``bootstrap`` (tests, CLI tools) it is read from dashboard.yaml
    without the database. Raises ConfigError if invalid."""
    global _runtime
    if _runtime is None:
        _runtime = Runtime(load_document(_config_path()))
    return _runtime


def _config_path() -> str | None:
    try:
        from backend.settings import settings

        return settings.dashboard_config
    except Exception:  # settings need .env values; the YAML itself doesn't
        return None


def file_sha256(path: Path) -> str | None:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError:
        return None


async def bootstrap(store: LayoutStore, path: str | Path | None = None, yaml_import: str = "auto") -> Runtime:
    """Load the published version, importing dashboard.yaml first if needed (see module docstring)."""
    await store.init_db()
    path = resolve_path(path if path is not None else _config_path())
    sha = file_sha256(path)
    pub = await store.published()
    if pub is None:
        if sha is None:
            raise ConfigError(path, ["filen finns inte och databasen har ingen publicerad layout"])
        doc = load_document(path)
        vid = await store.add_version(doc, "yaml", author=path.name, comment=f"första import av {path.name}", yaml_sha256=sha)
        logger.info("Layout: %s importerad och publicerad som version %d", path.name, vid)
    elif (
        yaml_import in ("auto", "always")
        and sha is not None
        and sha != await store.get_meta("layout_yaml_sha256")
        and not (yaml_import == "auto" and await store.editor_used())
    ):
        doc = load_document(path)
        vid = await store.add_version(doc, "yaml", author=path.name, comment=f"{path.name} ändrad", yaml_sha256=sha)
        logger.info("Layout: %s har ändrats sedan senaste importen – publicerad som version %d (version %d kan återställas)", path.name, vid, pub[0])
    else:
        vid, raw = pub
        if yaml_import == "auto" and sha is not None and sha != await store.get_meta("layout_yaml_sha256"):
            logger.warning(
                "Layout: %s har ändrats men importeras inte: layouten har publicerats i editorn (källan är databasen). "
                "Importera filen i editorn, eller sätt LAYOUT_YAML_IMPORT=always för en omstart",
                path.name,
            )
        doc = validate_document(raw, f"databasen (layoutversion {vid})")
        logger.info("Layout: version %d från databasen", vid)
    rt = Runtime(doc, vid)
    set_runtime(rt)
    return rt


async def publish(store: LayoutStore, doc: LayoutDocument, author: str, comment: str | None = None, source: str = "editor") -> Runtime:
    """New published version (used by the editor from etapp 2). The displays reload the layout;
    changed tags need a backend restart until the subscriptions are reloaded live."""
    rt = Runtime(doc)  # refuse what the runtime can't run before storing anything
    old = get_runtime() if _runtime is not None else None
    vid = await store.add_version(doc, source, author=author, comment=comment)
    rt.version = vid
    set_runtime(rt)
    if old is not None and old.data_nodes() != rt.data_nodes():
        logger.warning("Layout version %d ändrar taggar – starta om backend för att prenumerera på dem", vid)
    try:
        from backend.app.routers.websocket import broadcaster

        broadcaster.publish({"type": "layout_changed", "version": vid})
    except Exception:  # no running app (tests, CLI)
        logger.debug("layout_changed not broadcast", exc_info=True)
    return rt


async def restore(store: LayoutStore, vid: int, author: str | None = None) -> int:
    """Publish an older version again, as a new version (nothing is overwritten)."""
    raw = await store.version(vid)
    if raw is None:
        raise KeyError(vid)
    doc = validate_document(raw, f"layoutversion {vid}")
    Runtime(doc)
    return await store.add_version(doc, "restore", author=author, comment=f"återställd från version {vid}")


def _cli(argv: list[str]) -> int:
    """python -m backend.layout_store list | show N | restore N  (the database in DB_PATH)."""
    import asyncio
    import getpass

    store = LayoutStore()

    async def run() -> int:
        await store.init_db()
        if argv[:1] in ([], ["list"]):
            for v in await store.versions():
                mark = "*" if v["published"] else " "
                local = datetime.fromisoformat(v["created"]).astimezone().strftime("%Y-%m-%d %H:%M")  # computer's zone
                print(f"{mark} {v['id']:>4}  {local}  {v['source']:<8} {v['author'] or '':<16} {v['comment'] or ''}")
            return 0
        if len(argv) == 2 and argv[0] in ("show", "restore") and argv[1].isdigit():
            vid = int(argv[1])
            raw = await store.version(vid)
            if raw is None:
                print(f"FEL: version {vid} finns inte", file=sys.stderr)
                return 1
            if argv[0] == "show":
                print(document_yaml(validate_document(raw, f"layoutversion {vid}")), end="")
                return 0
            new = await restore(store, vid, author=getpass.getuser())
            print(f"Version {vid} publicerad igen som version {new}. Starta om backend för att visa den.")
            return 0
        print(_cli.__doc__, file=sys.stderr)
        return 2

    try:
        return asyncio.run(run())
    except ConfigError as e:
        print(f"FEL: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(_cli(sys.argv[1:]))
