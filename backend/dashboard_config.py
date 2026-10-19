"""dashboard.yaml, version 1 of the configuration: OPC UA nodes, tags and screens.

Loaded and validated here (pydantic); errors point at the file line and key path. Secrets
(password, certificate paths) stay in .env. The running backend uses the layout document
(backend/layout_doc.py, stored with versions in SQLite); this file is imported into it via
``layout_doc.migrate_v1`` (see backend/layout_store.py and docs/CONFIG.md).

    python -m backend.dashboard_config [dashboard.yaml]     # validate, exit 1 on errors
    python -m backend.dashboard_config --schema              # print the JSON schema
"""

from __future__ import annotations

import difflib
import json
import os
import sys
from pathlib import Path
from typing import Annotated, Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError

BASE_DIR = Path(__file__).resolve().parent.parent
DEFAULT_PATH = BASE_DIR / "dashboard.yaml"

# Fixed for every OPC UA server (base ConditionType, used for ConditionRefresh on alarms)
CONDITION_TYPE_NODE = "ns=0;i=2782"

# Limits that keep every grid screen legible from 8-10 m and free of overflow (see docs/CONFIG.md)
MAX_GRID_ITEMS = 6
MAX_LABEL = 20
MAX_UNIT = 6
MAX_STATE_TEXT = 10

# Tags the built-in screens read by name (required for those screen types). Optional reserved tags,
# read by name when present: GoodCount, ProductionCount, RejectCount, ShiftTarget, OeeTarget (docs/BERAKNINGAR.md)
SHIFT_TAGS = ("ShiftStart", "ShiftEnd", "ProductionState")
OEE_TAGS = (*SHIFT_TAGS, "TPM")

Color = Literal["white", "green", "amber", "red", "grey"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TagSpec(_Strict):
    """A PLC tag. Short form in YAML: `Name: 'ns=3;s="DB"."tag"'`."""

    node: str = Field("", description='OPC UA node id, e.g. ns=3;s="DB Production TV"."dashboardData"."oee". Empty = not configured yet (skipped).')
    type: Literal["auto", "time"] = Field("auto", description="time = S7 Time_Of_Day (ms) shown as hh:mm:ss")
    demo: float | list[float] | None = Field(None, description="Demo mode only: fixed value or [min, max] for a simulated value")


class State(_Strict):
    text: str = Field(..., min_length=1, max_length=MAX_STATE_TEXT)
    color: Color = "white"


class Item(_Strict):
    """One tile on a grid screen."""

    type: Literal["number", "percent", "counter", "time", "status"] = "number"
    label: str = Field(..., min_length=1, max_length=MAX_LABEL, description="Rubrik (svenska)")
    tag: str = Field(..., description="Name of a tag under `tags`")
    unit: str | None = Field(None, max_length=MAX_UNIT, description='Enhet, e.g. "st". percent defaults to "%"')
    decimals: int | None = Field(None, ge=0, le=3, description="Fixed decimals, shown with decimal comma even when 0 (82,0). Default: percent 1, number 1 once the tag delivers a decimal value, else 0. Ignored for counter (always 0)")
    target: str | float | None = Field(None, description="Mål: a tag name or a fixed number; shows Mål + progress bar")
    trend: bool = Field(False, description="Show the latest change as a large ▲/▼ value")
    color: Color | None = Field(None, description="Fixed value colour (ignored when thresholds are set)")
    thresholds: list[float] | None = Field(None, min_length=2, max_length=2, description="[lower, upper], compared with the value as displayed (rounded to its decimals). better high: >= upper green, >= lower amber, else red (+ ▼). better low: <= lower green, <= upper amber, else red (+ ▲)")
    better: Literal["high", "low"] = Field("high", description="high: higher is better (OEE); low: lower is better (kassation)")
    states: dict[int, State] | None = Field(None, description="status: PLC value -> text + colour")


class Screen(_Strict):
    type: Literal["grid", "alarms", "shift", "oee", "week", "highscore"] = Field("grid", description="grid = own items; alarms; shift = shift pattern; oee = OEE details; week = today + previous 6 days from the history; highscore = longest runs without a stop (top 5)")
    title: str | None = Field(None, max_length=40)
    items: list[Item] = Field(default_factory=list)


class ScreenNodes(_Strict):
    active: str = Field(..., min_length=1, description="ActiveScreenNr (written back by the backend)")
    requested: str = Field(..., min_length=1, description="RequestedScreenNr (set by the PLC)")


class Opc(_Strict):
    url: str | None = Field(None, description="opc.tcp://... (OPC_ENDPOINT_URL in .env takes precedence)")
    alarms: str = Field("", description="Program_Alarm server object, e.g. ns=3;i=1815. Empty = no alarms")
    screen: ScreenNodes


class Dashboard(_Strict):
    opc: Opc
    tags: dict[str, TagSpec | str] = Field(default_factory=dict)
    screens: dict[Annotated[int, Field(ge=1, le=99)], Screen]

    def tag(self, name: str) -> TagSpec:
        spec = self.tags[name]
        return TagSpec(node=spec) if isinstance(spec, str) else spec

    # ----- views used by the rest of the backend -----

    def layout(self) -> dict[str, Any]:
        """What the frontend needs (GET /api/layout): screens + tag types. No node ids."""
        return {
            "screens": {
                str(nr): {
                    "type": s.type,
                    "title": s.title,
                    "items": [_item_json(i) for i in s.items],
                }
                for nr, s in sorted(self.screens.items())
            },
            "tags": {
                name: {
                    **{k: v for k, v in self.tag(name).model_dump(exclude={"node"}).items() if v is not None},
                    # TODO(PLC) tag without node id: never gets a value (shown as "–")
                    "placeholder": not self.tag(name).node.strip(),
                }
                for name in self.tags
            },
        }

    def data_nodes(self) -> list[dict[str, Any]]:
        """Subscriptions for opc_data_tags (empty node = placeholder, skipped)."""
        out = []
        for name in self.tags:
            spec = self.tag(name)
            out.append(
                {
                    "nodeid": spec.node.strip(),
                    "datatype": "Time_Of_Day" if spec.type == "time" else "Auto",
                    "alias": name,
                    "placeholder": not spec.node.strip(),
                }
            )
        return out


def _item_json(item: Item) -> dict[str, Any]:
    data = item.model_dump(exclude_none=True)
    if item.type == "percent" and item.unit is None:
        data["unit"] = "%"
    if item.states is not None:
        data["states"] = {str(k): v.model_dump() for k, v in item.states.items()}
    return data


class ConfigError(Exception):
    """Invalid dashboard.yaml. `errors` are human-readable lines (file:line path: message)."""

    def __init__(self, path: Path, errors: list[str]):
        self.path = path
        self.errors = errors
        super().__init__(f"{path}: {len(errors)} fel i konfigurationen\n" + "\n".join(f"  - {e}" for e in errors))


# ===================== YAML loading with line numbers =====================


class _UniqueKeyLoader(yaml.SafeLoader):
    """SafeLoader that rejects duplicate keys (PyYAML silently keeps the last one)."""


def _construct_mapping(loader: _UniqueKeyLoader, node: yaml.MappingNode, deep: bool = False):
    seen: dict[Any, int] = {}
    for key_node, _ in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if key in seen:
            raise yaml.constructor.ConstructorError(
                None, None, f"nyckeln {key!r} finns redan (rad {seen[key] + 1})", key_node.start_mark
            )
        seen[key] = key_node.start_mark.line
    return loader.construct_mapping(node, deep=deep)


_UniqueKeyLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, _construct_mapping)


def _line_index(node: yaml.Node, path: tuple = (), out: dict | None = None) -> dict[tuple, int]:
    """Map every key path (all keys as str) to its 1-based line in the file."""
    out = {} if out is None else out
    out.setdefault(path, node.start_mark.line + 1)
    if isinstance(node, yaml.MappingNode):
        for k, v in node.value:
            p = (*path, str(k.value))
            out[p] = k.start_mark.line + 1
            _line_index(v, p, out)
    elif isinstance(node, yaml.SequenceNode):
        for i, v in enumerate(node.value):
            _line_index(v, (*path, str(i)), out)
    return out


# Names pydantic puts in error locations for union branches (tag: str | TagSpec, demo: float | list)
_UNION_BRANCHES = {"TagSpec", "str", "float", "int", "list[float]", "bool", "none"}


def _locate(lines: dict[tuple, int], loc: tuple) -> tuple[int | None, str]:
    """Best line + readable key path for a pydantic/validation location."""
    keys = tuple(str(p) for p in loc if str(p) not in _UNION_BRANCHES)
    found = keys
    while found and found not in lines:  # a missing key has no line: use its parent's
        found = found[:-1]
    return lines.get(found), " → ".join(keys) or "(roten)"


def _suggest(word: str, options) -> str:
    match = difflib.get_close_matches(str(word), [str(o) for o in options], n=1)
    return f" (menade du '{match[0]}'?)" if match else ""


_FIELDS: dict[type, list[str]] = {}


def _known_fields(model: type[BaseModel]) -> list[str]:
    return _FIELDS.setdefault(model, list(model.model_fields))


def _message(err: dict) -> str:
    t, ctx = err["type"], err.get("ctx") or {}
    if t == "missing":
        return "saknas (obligatorisk)"
    if t == "extra_forbidden":
        key = err["loc"][-1]
        known = {f for m in (Dashboard, Opc, ScreenNodes, TagSpec, Screen, Item, State) for f in _known_fields(m)}
        return f"okänd nyckel '{key}'{_suggest(key, known)}"
    if t == "literal_error":
        return f"ogiltigt värde {err.get('input')!r}, tillåtet: {str(ctx.get('expected')).replace(' or ', ' eller ')}"
    if t == "string_too_long":
        return f"för lång text ({len(str(err.get('input')))} tecken, max {ctx.get('max_length')} för att få plats på TV:n)"
    if t in ("too_short", "too_long"):
        return f"fel antal värden (ska vara {ctx.get('min_length', '')}–{ctx.get('max_length', '')})"
    return err["msg"]


def load_dashboard(path: str | Path | None = None) -> Dashboard:
    """Load + validate dashboard.yaml. Raises ConfigError with all problems found."""
    path = Path(path or os.environ.get("DASHBOARD_CONFIG") or DEFAULT_PATH)
    if not path.is_absolute() and not path.exists():
        path = DEFAULT_PATH.parent / path  # relative to the project root
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as e:
        raise ConfigError(path, [f"kan inte läsa filen: {e}"]) from e
    try:
        node = yaml.compose(text, Loader=_UniqueKeyLoader)
        raw = yaml.load(text, Loader=_UniqueKeyLoader)
    except yaml.YAMLError as e:
        mark = getattr(e, "problem_mark", None) or getattr(e, "context_mark", None)
        where = f"{path.name}:{mark.line + 1}" if mark else path.name
        problem = getattr(e, "problem", None) or str(e)
        raise ConfigError(path, [f"{where}: YAML-syntaxfel: {problem}"]) from e
    if not isinstance(raw, dict) or node is None:
        raise ConfigError(path, [f"{path.name}: filen måste innehålla opc, tags och screens"])
    lines = _line_index(node)

    def fmt(loc: tuple, msg: str) -> str:
        line, keys = _locate(lines, loc)
        return f"{path.name}:{line} {keys}: {msg}" if line else f"{path.name} {keys}: {msg}"

    try:
        dash = Dashboard.model_validate(raw)
    except ValidationError as e:
        errors, seen = [], set()
        for err in e.errors():
            # Unions (tag = str | TagSpec) report one error per branch; keep the TagSpec one
            if err["loc"][:1] == ("tags",) and len(err["loc"]) >= 3 and err["loc"][2] == "str":
                continue
            text_ = fmt(err["loc"], _message(err))
            if text_ not in seen:
                seen.add(text_)
                errors.append(text_)
        raise ConfigError(path, errors) from None

    errors = [fmt(loc, msg) for loc, msg in _cross_check(dash)]
    if errors:
        raise ConfigError(path, errors)
    return dash


def _cross_check(d: Dashboard) -> list[tuple[tuple, str]]:
    """Rules pydantic can't express per field: references between tags and items, layout limits."""
    problems: list[tuple[tuple, str]] = []
    tags = set(d.tags)

    def need_tags(nr: int, kind: str, names) -> None:
        missing = [n for n in names if n not in tags]
        if missing:
            problems.append((("screens", nr, "type"), f"skärmtypen '{kind}' kräver taggarna {', '.join(missing)}"))

    for nr, screen in d.screens.items():
        base = ("screens", nr)
        if screen.type == "grid":
            if not 1 <= len(screen.items) <= MAX_GRID_ITEMS:
                problems.append(((*base, "items"), f"en grid-skärm ska ha 1–{MAX_GRID_ITEMS} objekt (har {len(screen.items)})"))
        elif screen.items:
            problems.append(((*base, "items"), f"skärmtypen '{screen.type}' har inga egna objekt – ta bort items"))
        if screen.type == "shift":
            need_tags(nr, "shift", SHIFT_TAGS)
        if screen.type == "highscore":
            need_tags(nr, "highscore", ("ProductionState",))
        if screen.type in ("oee", "week"):
            need_tags(nr, screen.type, OEE_TAGS if screen.type == "oee" else SHIFT_TAGS)
            if "GoodCount" not in tags and "ProductionCount" not in tags:
                problems.append(
                    ((*base, "type"), f"skärmtypen '{screen.type}' kräver taggen GoodCount eller ProductionCount")
                )

        for i, item in enumerate(screen.items):
            problems += item_problems(item, tags, (*base, "items", i))
    return problems


def item_problems(item, tags: set[str], loc: tuple) -> list[tuple[tuple, str]]:
    """Rules for one value element (version 1 items and version 2 widgets, see layout_doc)."""
    problems: list[tuple[tuple, str]] = []
    if item.tag not in tags:
        problems.append(((*loc, "tag"), f"okänd tagg '{item.tag}'{_suggest(item.tag, tags)}"))
    if isinstance(item.target, str) and item.target not in tags:
        problems.append(((*loc, "target"), f"okänd tagg '{item.target}'{_suggest(item.target, tags)}"))
    if item.thresholds and item.thresholds[0] > item.thresholds[1]:
        problems.append(((*loc, "thresholds"), "skriv [varning, bra] med det lägre värdet först"))
    if item.type == "status" and not item.states:
        problems.append(((*loc, "states"), "status-objekt behöver states (PLC-värde → text och färg)"))
    if item.type != "status" and item.states:
        problems.append(((*loc, "states"), "states används bara med type: status"))
    if item.type in ("time", "status") and (item.target is not None or item.trend or item.thresholds):
        problems.append((loc, f"type: {item.type} stöder inte target/trend/thresholds"))
    return problems


def json_schema() -> dict[str, Any]:
    schema = Dashboard.model_json_schema()
    schema["properties"]["screens"]["propertyNames"] = {"pattern": "^[1-9][0-9]?$"}  # screen number 1-99
    schema["$schema"] = "https://json-schema.org/draft/2020-12/schema"
    schema["title"] = "asyncua-dashboard dashboard.yaml"
    return schema


def main(argv: list[str]) -> int:
    if argv[:1] == ["--schema"]:
        print(json.dumps(json_schema(), indent=2, ensure_ascii=False))
        return 0
    try:
        dash = load_dashboard(argv[0] if argv else None)
    except ConfigError as e:
        print(f"FEL: {e}", file=sys.stderr)
        return 1
    grid_items = sum(len(s.items) for s in dash.screens.values())
    placeholders = [n["alias"] for n in dash.data_nodes() if n["placeholder"]]
    print(f"OK: {len(dash.screens)} skärmar, {grid_items} objekt, {len(dash.tags)} taggar")
    if placeholders:
        print(f"Obs: taggar utan nod-id (hoppas över tills de fylls i): {', '.join(placeholders)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
