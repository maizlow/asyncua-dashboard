"""Layout document (schema_version 2): connections (PLCs), displays (TVs), header area and screens
with widgets on a fixed 24x12 grid. See docs/EDITOR-PLAN.md and docs/CONFIG.md.

The document is stored with versions in SQLite (backend/layout_store.py, the source of truth).
YAML is import/export only: today's dashboard.yaml (version 1) is migrated by ``migrate_v1``,
a YAML file with ``schema_version: 2`` is read as is.

    python -m backend.layout_doc [file.yaml]          # validate (v1 or v2), exit 1 on errors
    python -m backend.layout_doc --view [file.yaml]    # print what GET /api/layout returns
    python -m backend.layout_doc --migrate [file.yaml] # print the file as a version 2 document (YAML)
    python -m backend.layout_doc --schema              # JSON schema of the version 2 document
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Annotated, Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from backend.dashboard_config import (
    DEFAULT_PATH,
    MAX_LABEL,
    MAX_UNIT,
    OEE_TAGS,
    SHIFT_TAGS,
    Color,
    ConfigError,
    Dashboard,
    State,
    TagSpec,
    _line_index,
    _locate,
    _message,
    _suggest,
    _UniqueKeyLoader,
    item_problems,
    load_dashboard,
)

SCHEMA_VERSION = 2
GRID_COLS, GRID_ROWS = 24, 12
VALUE_KINDS = ("number", "percent", "counter", "time", "status")
BUILTIN_KINDS = ("alarms", "shift", "oee", "week", "highscore")
# Smallest value tile until the editor's live fit check exists (etapp 2): today's smallest tile
# (2 columns x 3 rows) is 12x4, which is what every hero size and the 6-digit counts are laid out for.
MIN_VALUE_W, MIN_VALUE_H = 12, 4
THEMES = ("abece-dark",)
DEFAULT_CONNECTION, DEFAULT_DISPLAY = "plc1", "tv1"

Id = Annotated[str, Field(pattern=r"^[a-z][a-z0-9_-]{0,31}$")]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Connection(_Strict):
    """One PLC (OPC UA server). Password and certificates stay in .env."""

    name: str | None = Field(None, max_length=40, description="Visningsnamn, t.ex. 'PLC linje 3'")
    url: str | None = Field(None, description="opc.tcp://... (OPC_ENDPOINT_URL in .env takes precedence for the first connection)")
    alarms: str = Field("", description="Program_Alarm server object, e.g. ns=3;i=1815. Empty = no alarms")
    tags: dict[str, TagSpec | str] = Field(default_factory=dict, description="alias: node id (or {node, type, demo})")

    def tag(self, name: str) -> TagSpec:
        spec = self.tags[name]
        return TagSpec(node=spec) if isinstance(spec, str) else spec


LogoAsset = Literal["customer", "vendor", "none"]


class Header(_Strict):
    """Header area above the grid, kept while the screens change: a logo on each side and the clock in
    the middle (always). Default = today's header. none = empty."""

    left: LogoAsset = Field("customer", description="customer = kundens logotyp, vendor = ABECE, none = tom")
    right: LogoAsset = Field("vendor", description="customer = kundens logotyp, vendor = ABECE, none = tom")

    @model_validator(mode="before")
    @classmethod
    def _etapp1_slots(cls, data: Any) -> Any:
        """Versions saved in etapp 1 had three free slots ({kind, asset, text}); keep them loadable."""
        if not isinstance(data, dict) or not any(isinstance(data.get(k), dict) for k in ("left", "center", "right")):
            return data
        out = {}
        for side in ("left", "right"):
            v = data.get(side)
            if isinstance(v, dict):
                out[side] = v.get("asset") if v.get("kind") == "logo" and v.get("asset") in ("customer", "vendor") else "none"
            elif v is not None:
                out[side] = v
        return out


class Widget(_Strict):
    """One element on a screen: position + size in grid cells, and the element's properties."""

    id: str = Field(..., min_length=1, max_length=40)
    kind: Literal["number", "percent", "counter", "time", "status", "alarms", "shift", "oee", "week", "highscore"]
    x: int = Field(..., ge=0, lt=GRID_COLS)
    y: int = Field(..., ge=0, lt=GRID_ROWS)
    w: int = Field(..., ge=1, le=GRID_COLS)
    h: int = Field(..., ge=1, le=GRID_ROWS)
    # Value elements (same meaning as the items in dashboard.yaml, see docs/CONFIG.md)
    label: str | None = Field(None, min_length=1, max_length=MAX_LABEL)
    tag: str | None = Field(None, description="Tagg: plc1.OEE (anslutning.alias), eller bara OEE med displayens default_connection")
    unit: str | None = Field(None, max_length=MAX_UNIT)
    decimals: int | None = Field(None, ge=0, le=3)
    target: str | float | None = Field(None, description="Mål: en tagg (som tag) eller ett fast tal")
    trend: bool | None = None
    color: Color | None = None
    thresholds: list[float] | None = Field(None, min_length=2, max_length=2)
    better: Literal["high", "low"] | None = None
    states: dict[int, State] | None = None
    # Built-in screens: which PLC (line) they show; shift log, OEE, 7 days and highscore are per connection
    connection: Id | None = Field(None, description="Inbyggda skärmar: anslutningen (linjen) de visar, t.ex. plc1")

    @property
    def type(self) -> str:  # same name as Item.type, for the shared rules
        return self.kind


class Screen(_Strict):
    title: str | None = Field(None, max_length=40)
    items: list[Widget] = Field(default_factory=list)


class ScreenControl(_Strict):
    """Screen switching for one display: the PLC asks for a screen (requested), the backend acknowledges
    by writing active. Both nodes are on one explicit connection."""

    connection: Id = Field(..., description="Anslutningen (PLC) som styr displayens skärmväxling")
    active: str = Field(..., min_length=1, description="ActiveScreenNr (written back by the backend)")
    requested: str = Field(..., min_length=1, description="RequestedScreenNr (set by the PLC)")


class Display(_Strict):
    """One TV: its own screens and header. Reads from any number of connections (shared with other
    displays); elements name theirs in the tag reference (plc2.OEE)."""

    name: str | None = Field(None, max_length=40, description="Visningsnamn, t.ex. 'Linje 3 norr'")
    default_connection: Id | None = Field(
        None, description="Anslutning för korta taggnamn (OEE = plc1.OEE). Standard: den enda anslutningen om det bara finns en"
    )
    theme: Literal["abece-dark"] = "abece-dark"
    screen: ScreenControl = Field(..., description="Skärmväxlingens noder (ActiveScreenNr) på en anslutning")
    header: Header = Field(default_factory=Header)
    screens: dict[Annotated[int, Field(ge=1, le=99)], Screen]

    @model_validator(mode="before")
    @classmethod
    def _etapp1_display(cls, data: Any) -> Any:
        """Versions saved in etapp 1 tied a display to one `connection`: it becomes the default
        connection, the screen control's connection and the connection of every built-in."""
        if not isinstance(data, dict) or "connection" not in data:
            return data
        data = dict(data)
        conn = data.pop("connection")
        data.setdefault("default_connection", conn)
        if isinstance(data.get("screen"), dict):
            data["screen"] = {"connection": conn, **data["screen"]}
        if isinstance(data.get("screens"), dict):
            screens = {}
            for nr, scr in data["screens"].items():
                if isinstance(scr, dict) and isinstance(scr.get("items"), list):
                    scr = {**scr, "items": [
                        {"connection": conn, **w} if isinstance(w, dict) and w.get("kind") in BUILTIN_KINDS else w for w in scr["items"]
                    ]}
                screens[nr] = scr
            data["screens"] = screens
        return data


class LayoutDocument(_Strict):
    schema_version: Literal[2] = SCHEMA_VERSION
    connections: dict[Id, Connection] = Field(..., min_length=1)
    displays: dict[Id, Display] = Field(..., min_length=1)


_MODELS = (LayoutDocument, Connection, Display, Header, Screen, Widget, ScreenControl, TagSpec, State)


# ===================== migration from dashboard.yaml (version 1) =====================


def grid_placement(n: int) -> list[tuple[int, int, int, int]]:
    """Today's grid screen: 1 item = full size, else 2 columns and ceil(n/2) rows (x, y, w, h)."""
    if n <= 1:
        return [(0, 0, GRID_COLS, GRID_ROWS)]
    rows = (n + 1) // 2
    h = GRID_ROWS // rows
    return [((i % 2) * (GRID_COLS // 2), (i // 2) * h, GRID_COLS // 2, h) for i in range(n)]


def migrate_v1(dash: Dashboard) -> LayoutDocument:
    """dashboard.yaml (version 1) -> document: opc + tags = connection plc1, screens = display tv1
    (default connection plc1, so the short tag names stay as they are)."""
    screens: dict[int, Screen] = {}
    for nr, s in sorted(dash.screens.items()):
        if s.type == "grid":
            items = [
                Widget(id=f"s{nr}-{i + 1}", kind=item.type, x=x, y=y, w=w, h=h, **item.model_dump(exclude={"type"}, exclude_defaults=True))
                for i, (item, (x, y, w, h)) in enumerate(zip(s.items, grid_placement(len(s.items)), strict=True))
            ]
        else:
            items = [Widget(id=f"s{nr}-1", kind=s.type, x=0, y=0, w=GRID_COLS, h=GRID_ROWS, connection=DEFAULT_CONNECTION)]
        screens[nr] = Screen(title=s.title, items=items)
    return LayoutDocument(
        connections={DEFAULT_CONNECTION: Connection(url=dash.opc.url, alarms=dash.opc.alarms, tags=dash.tags)},
        displays={
            DEFAULT_DISPLAY: Display(
                default_connection=DEFAULT_CONNECTION,
                screen=ScreenControl(connection=DEFAULT_CONNECTION, **dash.opc.screen.model_dump()),
                screens=screens,
            )
        },
    )


# ===================== tag references: plc1.OEE or OEE (display default) =====================


def default_connection(doc: LayoutDocument, d: Display) -> str | None:
    if d.default_connection is not None:
        return d.default_connection
    return next(iter(doc.connections)) if len(doc.connections) == 1 else None


def split_ref(doc: LayoutDocument, d: Display, ref: str) -> tuple[str | None, str]:
    """'plc2.OEE' -> ('plc2', 'OEE'); 'OEE' -> (default connection or None, 'OEE')."""
    conn, sep, name = ref.partition(".")
    if sep:
        return conn, name
    return default_connection(doc, d), ref


def qualify(doc: LayoutDocument, d: Display, ref: str) -> str:
    conn, name = split_ref(doc, d, ref)
    return f"{conn}.{name}"


def display_connections(doc: LayoutDocument, did: str) -> list[str]:
    """Connections one display reads from (default, screen control, tags of its elements, built-ins),
    in the order of the document's connection pool."""
    d = doc.displays[did]
    used = {d.screen.connection}
    if (dc := default_connection(doc, d)) is not None:
        used.add(dc)
    for s in d.screens.values():
        for w in s.items:
            if w.connection:
                used.add(w.connection)
            for ref in (w.tag, w.target if isinstance(w.target, str) else None):
                if ref:
                    used.add(split_ref(doc, d, ref)[0])
    return [c for c in doc.connections if c in used]


def display_keys(doc: LayoutDocument, did: str) -> set[str]:
    """Qualified tags (plc1.OEE) a display shows: what its WebSocket clients need (the backend filters
    per display, etapp 4). Built-ins need their connection's reserved tags."""
    d = doc.displays[did]
    keys: set[str] = set()
    for s in d.screens.values():
        for w in s.items:
            for ref in (w.tag, w.target if isinstance(w.target, str) else None):
                if ref:
                    keys.add(qualify(doc, d, ref))
            if w.connection:
                need = {"shift": SHIFT_TAGS, "week": SHIFT_TAGS, "oee": OEE_TAGS, "highscore": ("ProductionState",)}.get(w.kind, ())
                tags = doc.connections[w.connection].tags
                keys |= {f"{w.connection}.{n}" for n in need if n in tags}
    return keys


def subscription_plan(doc: LayoutDocument) -> dict[str, dict[str, list[str]]]:
    """One OPC UA client per connection, however many displays use it: connection -> node -> the
    qualified tags on that node. Nodes are subscribed once and the values fanned out (etapp 4 runs
    one client per entry; until then the runtime supports one connection). Only connections and tags
    some display uses are included; placeholder tags (no node id) are skipped."""
    needed: set[str] = set()
    for did in doc.displays:
        needed |= display_keys(doc, did)
    plan: dict[str, dict[str, list[str]]] = {}
    for cid, conn in doc.connections.items():
        for name in conn.tags:
            key = f"{cid}.{name}"
            node = conn.tag(name).node.strip()
            if key in needed and node:
                plan.setdefault(cid, {}).setdefault(node, []).append(key)
    return plan


# ===================== rules between fields (pydantic can't express them per field) =====================


def builtin_tag_problems(kind: str, tags: set[str], loc: tuple) -> list[tuple[tuple, str]]:
    need = {"shift": SHIFT_TAGS, "highscore": ("ProductionState",), "oee": OEE_TAGS, "week": SHIFT_TAGS}.get(kind, ())
    problems = []
    missing = [n for n in need if n not in tags]
    if missing:
        problems.append((loc, f"'{kind}' kräver taggarna {', '.join(missing)}"))
    if kind in ("oee", "week") and "GoodCount" not in tags and "ProductionCount" not in tags:
        problems.append((loc, f"'{kind}' kräver taggen GoodCount eller ProductionCount"))
    return problems


_VALUE_FIELDS = ("label", "tag", "unit", "decimals", "target", "trend", "color", "thresholds", "better", "states")


def _ref_problems(doc: LayoutDocument, d: Display, ref: str, loc: tuple) -> list[tuple[tuple, str]]:
    conn_id, name = split_ref(doc, d, ref)
    if conn_id is None:
        ex = next(iter(doc.connections))
        return [(loc, f"ange anslutningen, t.ex. '{ex}.{name}' (eller default_connection på displayen)")]
    conn = doc.connections.get(conn_id)
    if conn is None:
        return [(loc, f"okänd anslutning '{conn_id}'{_suggest(conn_id, doc.connections)}")]
    if name not in conn.tags:
        return [(loc, f"okänd tagg '{name}' i {conn_id}{_suggest(name, conn.tags)}")]
    return []


def document_problems(doc: LayoutDocument) -> list[tuple[tuple, str]]:
    problems: list[tuple[tuple, str]] = []
    ids: dict[str, tuple] = {}

    def conn_problem(cid: str, loc: tuple) -> None:
        if cid not in doc.connections:
            problems.append((loc, f"okänd anslutning '{cid}'{_suggest(cid, doc.connections)}"))

    for did, d in doc.displays.items():
        dloc = ("displays", did)
        if d.default_connection is not None:
            conn_problem(d.default_connection, (*dloc, "default_connection"))
        conn_problem(d.screen.connection, (*dloc, "screen", "connection"))
        for nr, screen in d.screens.items():
            base = (*dloc, "screens", nr)
            if not screen.items:
                problems.append(((*base, "items"), "skärmen har inga objekt"))
            for i, wdg in enumerate(screen.items):
                loc = (*base, "items", i)
                if wdg.id in ids:
                    problems.append(((*loc, "id"), f"id '{wdg.id}' finns redan"))
                ids.setdefault(wdg.id, loc)
                if wdg.x + wdg.w > GRID_COLS or wdg.y + wdg.h > GRID_ROWS:
                    problems.append((loc, f"utanför rutnätet {GRID_COLS}×{GRID_ROWS} (x+w ≤ {GRID_COLS}, y+h ≤ {GRID_ROWS})"))
                for j, other in enumerate(screen.items[:i]):
                    if wdg.x < other.x + other.w and other.x < wdg.x + wdg.w and wdg.y < other.y + other.h and other.y < wdg.y + wdg.h:
                        problems.append((loc, f"överlappar objekt {j + 1} ('{other.id}')"))
                full = (wdg.x, wdg.y, wdg.w, wdg.h) == (0, 0, GRID_COLS, GRID_ROWS)
                if wdg.kind in BUILTIN_KINDS:
                    extra = [f for f in _VALUE_FIELDS if getattr(wdg, f) is not None]
                    if extra:
                        problems.append((loc, f"'{wdg.kind}' har inga egna fält – ta bort {', '.join(extra)}"))
                    if not full or len(screen.items) > 1:
                        why = "larm visas alltid i helskärm" if wdg.kind == "alarms" else "visas i helskärm tills mindre storlekar stöds (etapp 6)"
                        problems.append((loc, f"'{wdg.kind}': {why} – x 0, y 0, w {GRID_COLS}, h {GRID_ROWS} och ensamt på skärmen"))
                    if wdg.connection is None:
                        problems.append(((*loc, "connection"), f"'{wdg.kind}' behöver connection (vilken PLC/linje den visar)"))
                    elif wdg.connection not in doc.connections:
                        conn_problem(wdg.connection, (*loc, "connection"))
                    else:
                        problems += builtin_tag_problems(wdg.kind, set(doc.connections[wdg.connection].tags), (*loc, "kind"))
                else:
                    if wdg.connection is not None:
                        problems.append(((*loc, "connection"), "connection används bara på inbyggda skärmar – skriv anslutningen i tag (plc1.OEE)"))
                    for f in ("label", "tag"):
                        if getattr(wdg, f) is None:
                            problems.append(((*loc, f), "saknas (obligatorisk)"))
                    if wdg.w < MIN_VALUE_W or wdg.h < MIN_VALUE_H:
                        problems.append((loc, f"för liten ruta {wdg.w}×{wdg.h} (minst {MIN_VALUE_W}×{MIN_VALUE_H} tills editorns läsbarhetskontroll finns)"))
                    if wdg.tag is not None:
                        problems += _ref_problems(doc, d, wdg.tag, (*loc, "tag"))
                        if isinstance(wdg.target, str):
                            problems += _ref_problems(doc, d, wdg.target, (*loc, "target"))
                        # value rules shared with dashboard.yaml; tag existence is checked above
                        problems += [p for p in item_problems(wdg, _AnyTags(), loc) if p[0][-1] not in ("tag", "target")]
    return problems


class _AnyTags(set):
    """Tag set that contains everything: item_problems' tag checks are replaced by _ref_problems."""

    def __contains__(self, item: object) -> bool:
        return True


def runtime_problems(doc: LayoutDocument) -> list[str]:
    """What today's backend can run (until etapp 4): one connection and one display. The model allows
    more (shared connections, displays reading several PLCs)."""
    out = []
    if len(doc.connections) > 1:
        out.append(f"connections: {len(doc.connections)} anslutningar – drift med flera PLC:er kommer i etapp 4, en stöds idag")
    if len(doc.displays) > 1:
        out.append(f"displays: {len(doc.displays)} displayer – drift med flera displayer kommer i etapp 4, en stöds idag")
    return out


# ===================== loading =====================


def _message2(err: dict) -> str:
    if err["type"] == "extra_forbidden":
        key = err["loc"][-1]
        known = {f for m in _MODELS for f in m.model_fields}
        return f"okänd nyckel '{key}'{_suggest(key, known)}"
    if err["type"] == "string_pattern_mismatch":
        return "ogiltigt id (små bokstäver, siffror, - och _, börjar med en bokstav)"
    return _message(err)


def validate_document(raw: Any, source: str = "dokumentet", lines: dict[tuple, int] | None = None) -> LayoutDocument:
    """Validate a version 2 document (dict). Raises ConfigError with all problems found."""
    lines = lines or {}

    def fmt(loc: tuple, msg: str) -> str:
        line, keys = _locate(lines, tuple(p for p in loc if p != "[key]"))  # pydantic marks dict-key errors
        return f"{source}:{line} {keys}: {msg}" if line else f"{source} {keys}: {msg}"

    try:
        doc = LayoutDocument.model_validate(raw)
    except ValidationError as e:
        errors, seen = [], set()
        for err in e.errors():
            loc = err["loc"]
            # tag = str | TagSpec reports one error per branch; keep the TagSpec one
            if len(loc) >= 5 and loc[0] == "connections" and loc[2] == "tags" and loc[4] == "str":
                continue
            text_ = fmt(loc, _message2(err))
            if text_ not in seen:
                seen.add(text_)
                errors.append(text_)
        raise ConfigError(Path(source), errors) from None
    errors = [fmt(loc, msg) for loc, msg in document_problems(doc)]
    if errors:
        raise ConfigError(Path(source), errors)
    return doc


def resolve_path(path: str | Path | None = None) -> Path:
    path = Path(path or os.environ.get("DASHBOARD_CONFIG") or DEFAULT_PATH)
    if not path.is_absolute() and not path.exists():
        path = DEFAULT_PATH.parent / path
    return path


def load_document(path: str | Path | None = None) -> LayoutDocument:
    """Read a YAML file: version 2 (schema_version: 2) as is, version 1 (dashboard.yaml) via migrate_v1."""
    path = resolve_path(path)
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as e:
        raise ConfigError(path, [f"kan inte läsa filen: {e}"]) from e
    try:
        node = yaml.compose(text, Loader=_UniqueKeyLoader)
        raw = yaml.load(text, Loader=_UniqueKeyLoader)
    except yaml.YAMLError:
        return migrate_v1(load_dashboard(path))  # the version 1 loader reports YAML errors with line numbers
    if isinstance(raw, dict) and "schema_version" in raw:
        return validate_document(raw, path.name, _line_index(node) if node is not None else None)
    return migrate_v1(load_dashboard(path))


def document_json(doc: LayoutDocument) -> dict[str, Any]:
    """JSON for storage (defaults included, so a stored version never changes meaning)."""
    return doc.model_dump(mode="json", exclude_none=True)


def document_yaml(doc: LayoutDocument) -> str:
    head = "# yaml-language-server: $schema=./docs/layout.schema.json\n# Layoutdokument (schema_version 2). Se docs/CONFIG.md.\n"
    return head + yaml.safe_dump(document_json(doc), allow_unicode=True, sort_keys=False, width=120)


# ===================== what the display gets (GET /api/layout) =====================


def _widget_json(w: Widget) -> dict[str, Any]:
    data = w.model_dump(exclude_none=True)
    if w.kind == "percent" and w.unit is None:
        data["unit"] = "%"
    if w.states is not None:
        data["states"] = {str(k): v.model_dump() for k, v in w.states.items()}
    return data


def layout_view(doc: LayoutDocument, display_id: str | None = None, version: int | None = None) -> dict[str, Any]:
    """Screens, header and tag types for one display. Tag references are qualified (plc1.OEE) so the
    display can tell PLCs apart; only the connections it uses are included. No node ids, no URLs."""
    did = display_id or next(iter(doc.displays))
    d = doc.displays[did]

    def widget(w: Widget) -> dict[str, Any]:
        data = _widget_json(w)
        if w.tag:
            data["tag"] = qualify(doc, d, w.tag)
        if isinstance(w.target, str):
            data["target"] = qualify(doc, d, w.target)
        return data

    used = display_connections(doc, did)
    return {
        "schema_version": SCHEMA_VERSION,
        "version": version,
        "display": {"id": did, "name": d.name, "theme": d.theme, "header": d.header.model_dump()},
        "displays": [{"id": k, "name": v.name} for k, v in doc.displays.items()],
        "connections": {cid: {"name": doc.connections[cid].name} for cid in used},
        "grid": {"cols": GRID_COLS, "rows": GRID_ROWS},
        "screens": {str(nr): {"title": s.title, "items": [widget(w) for w in s.items]} for nr, s in sorted(d.screens.items())},
        "tags": {
            f"{cid}.{name}": {
                **{k: v for k, v in doc.connections[cid].tag(name).model_dump(exclude={"node"}).items() if v is not None},
                "placeholder": not doc.connections[cid].tag(name).node.strip(),  # TODO(PLC) tag without node id
            }
            for cid in used
            for name in doc.connections[cid].tags
        },
    }


def json_schema() -> dict[str, Any]:
    schema = LayoutDocument.model_json_schema()
    schema["$schema"] = "https://json-schema.org/draft/2020-12/schema"
    schema["title"] = "asyncua-dashboard layoutdokument (schema_version 2)"
    return schema


def main(argv: list[str]) -> int:
    if argv[:1] == ["--schema"]:
        print(json.dumps(json_schema(), indent=2, ensure_ascii=False))
        return 0
    mode = argv[0] if argv[:1] and argv[0].startswith("--") else None
    rest = argv[1:] if mode else argv
    try:
        doc = load_document(rest[0] if rest else None)
    except ConfigError as e:
        print(f"FEL: {e}", file=sys.stderr)
        return 1
    if mode == "--view":
        print(json.dumps(layout_view(doc), indent=2, ensure_ascii=False))
    elif mode == "--migrate":
        print(document_yaml(doc), end="")
    else:
        n_items = sum(len(s.items) for d in doc.displays.values() for s in d.screens.values())
        print(f"OK: {len(doc.connections)} anslutning(ar), {len(doc.displays)} display(er), {n_items} objekt")
        for p in runtime_problems(doc):
            print(f"Obs: {p}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
