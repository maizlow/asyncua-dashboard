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
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from backend.dashboard_config import (
    DEFAULT_PATH,
    MAX_LABEL,
    MAX_UNIT,
    OEE_TAGS,
    SHIFT_TAGS,
    Color,
    ConfigError,
    Dashboard,
    ScreenNodes,
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


class HeaderSlot(_Strict):
    kind: Literal["logo", "clock", "text", "title", "none"] = "none"
    asset: Literal["customer", "vendor"] | None = Field(None, description="logo: customer = kundlogotyp, vendor = ABECE")
    text: str | None = Field(None, min_length=1, max_length=40, description="text: fast text")


class Header(_Strict):
    """Header area above the grid, kept while the screens change. Default = today's header."""

    left: HeaderSlot = Field(default_factory=lambda: HeaderSlot(kind="logo", asset="customer"))
    center: HeaderSlot = Field(default_factory=lambda: HeaderSlot(kind="clock"))
    right: HeaderSlot = Field(default_factory=lambda: HeaderSlot(kind="logo", asset="vendor"))


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
    tag: str | None = Field(None, description="Alias under the display's connection")
    unit: str | None = Field(None, max_length=MAX_UNIT)
    decimals: int | None = Field(None, ge=0, le=3)
    target: str | float | None = None
    trend: bool | None = None
    color: Color | None = None
    thresholds: list[float] | None = Field(None, min_length=2, max_length=2)
    better: Literal["high", "low"] | None = None
    states: dict[int, State] | None = None

    @property
    def type(self) -> str:  # same name as Item.type, for the shared rules
        return self.kind


class Screen(_Strict):
    title: str | None = Field(None, max_length=40)
    items: list[Widget] = Field(default_factory=list)


class Display(_Strict):
    """One TV: its own screens, header and theme, reading from one connection."""

    name: str | None = Field(None, max_length=40, description="Visningsnamn, t.ex. 'Linje 3 norr'")
    connection: Id = DEFAULT_CONNECTION
    theme: Literal["abece-dark"] = "abece-dark"
    screen: ScreenNodes = Field(..., description="Screen switching nodes on the connection's PLC (ActiveScreenNr)")
    header: Header = Field(default_factory=Header)
    screens: dict[Annotated[int, Field(ge=1, le=99)], Screen]


class LayoutDocument(_Strict):
    schema_version: Literal[2] = SCHEMA_VERSION
    connections: dict[Id, Connection] = Field(..., min_length=1)
    displays: dict[Id, Display] = Field(..., min_length=1)


_MODELS = (LayoutDocument, Connection, Display, Header, HeaderSlot, Screen, Widget, ScreenNodes, TagSpec, State)


# ===================== migration from dashboard.yaml (version 1) =====================


def grid_placement(n: int) -> list[tuple[int, int, int, int]]:
    """Today's grid screen: 1 item = full size, else 2 columns and ceil(n/2) rows (x, y, w, h)."""
    if n <= 1:
        return [(0, 0, GRID_COLS, GRID_ROWS)]
    rows = (n + 1) // 2
    h = GRID_ROWS // rows
    return [((i % 2) * (GRID_COLS // 2), (i // 2) * h, GRID_COLS // 2, h) for i in range(n)]


def migrate_v1(dash: Dashboard) -> LayoutDocument:
    """dashboard.yaml (version 1) -> document: opc + tags = connection plc1, screens = display tv1."""
    screens: dict[int, Screen] = {}
    for nr, s in sorted(dash.screens.items()):
        if s.type == "grid":
            items = [
                Widget(id=f"s{nr}-{i + 1}", kind=item.type, x=x, y=y, w=w, h=h, **item.model_dump(exclude={"type"}, exclude_defaults=True))
                for i, (item, (x, y, w, h)) in enumerate(zip(s.items, grid_placement(len(s.items)), strict=True))
            ]
        else:
            items = [Widget(id=f"s{nr}-1", kind=s.type, x=0, y=0, w=GRID_COLS, h=GRID_ROWS)]
        screens[nr] = Screen(title=s.title, items=items)
    return LayoutDocument(
        connections={DEFAULT_CONNECTION: Connection(url=dash.opc.url, alarms=dash.opc.alarms, tags=dash.tags)},
        displays={DEFAULT_DISPLAY: Display(connection=DEFAULT_CONNECTION, screen=dash.opc.screen, screens=screens)},
    )


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


def document_problems(doc: LayoutDocument) -> list[tuple[tuple, str]]:
    problems: list[tuple[tuple, str]] = []
    ids: dict[str, tuple] = {}
    for did, d in doc.displays.items():
        dloc = ("displays", did)
        conn = doc.connections.get(d.connection)
        if conn is None:
            problems.append(((*dloc, "connection"), f"okänd anslutning '{d.connection}'{_suggest(d.connection, doc.connections)}"))
        tags = set(conn.tags) if conn else set()
        for side in ("left", "center", "right"):
            slot: HeaderSlot = getattr(d.header, side)
            sloc = (*dloc, "header", side)
            if slot.kind == "logo" and slot.asset is None:
                problems.append(((*sloc, "asset"), "logo behöver asset (customer eller vendor)"))
            if slot.kind != "logo" and slot.asset is not None:
                problems.append(((*sloc, "asset"), "asset används bara med kind: logo"))
            if slot.kind == "text" and not slot.text:
                problems.append(((*sloc, "text"), "text behöver text"))
            if slot.kind != "text" and slot.text is not None:
                problems.append(((*sloc, "text"), "text används bara med kind: text"))
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
                    problems += builtin_tag_problems(wdg.kind, tags, (*loc, "kind"))
                else:
                    for f in ("label", "tag"):
                        if getattr(wdg, f) is None:
                            problems.append(((*loc, f), "saknas (obligatorisk)"))
                    if wdg.w < MIN_VALUE_W or wdg.h < MIN_VALUE_H:
                        problems.append((loc, f"för liten ruta {wdg.w}×{wdg.h} (minst {MIN_VALUE_W}×{MIN_VALUE_H} tills editorns läsbarhetskontroll finns)"))
                    if wdg.tag is not None:
                        problems += item_problems(wdg, tags, loc)
    return problems


def runtime_problems(doc: LayoutDocument) -> list[str]:
    """What today's backend can run (etapp 1): one connection and one display. The model allows more."""
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
    """Screens, header and tag types for one display. No node ids, no URLs."""
    did = display_id or next(iter(doc.displays))
    d = doc.displays[did]
    conn = doc.connections[d.connection]
    return {
        "schema_version": SCHEMA_VERSION,
        "version": version,
        "display": {"id": did, "name": d.name, "theme": d.theme, "header": d.header.model_dump(exclude_none=True)},
        "displays": [{"id": k, "name": v.name} for k, v in doc.displays.items()],
        "grid": {"cols": GRID_COLS, "rows": GRID_ROWS},
        "screens": {str(nr): {"title": s.title, "items": [_widget_json(w) for w in s.items]} for nr, s in sorted(d.screens.items())},
        "tags": {
            name: {
                **{k: v for k, v in conn.tag(name).model_dump(exclude={"node"}).items() if v is not None},
                "placeholder": not conn.tag(name).node.strip(),  # TODO(PLC) tag without node id
            }
            for name in conn.tags
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
