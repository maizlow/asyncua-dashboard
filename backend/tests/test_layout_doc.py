"""Layout document (schema_version 2), migration from dashboard.yaml and versions in SQLite."""

import json
import textwrap
from pathlib import Path

import pytest

from backend.dashboard_config import BASE_DIR, ConfigError
from backend.layout_doc import (
    display_connections,
    display_keys,
    document_json,
    document_yaml,
    grid_placement,
    layout_view,
    load_document,
    runtime_problems,
    subscription_plan,
    validate_document,
)
from backend.layout_store import LayoutStore, Runtime, bootstrap, publish, restore

EXAMPLE = BASE_DIR / "dashboard.yaml"
STRESS = BASE_DIR / "docs" / "examples" / "stress.yaml"
MULTI = BASE_DIR / "docs" / "examples" / "flera-displayer.yaml"
FIXTURES = BASE_DIR / "frontend" / "src" / "layout" / "fixtures"


def test_grid_placement_matches_todays_two_column_grid():
    assert grid_placement(1) == [(0, 0, 24, 12)]
    assert grid_placement(2) == [(0, 0, 12, 12), (12, 0, 12, 12)]
    assert grid_placement(3) == [(0, 0, 12, 6), (12, 0, 12, 6), (0, 6, 12, 6)]
    assert grid_placement(5)[4] == (0, 8, 12, 4)
    assert grid_placement(6)[5] == (12, 8, 12, 4)


def test_example_migrates_to_one_connection_and_one_display():
    doc = load_document(EXAMPLE)
    assert list(doc.connections) == ["plc1"] and list(doc.displays) == ["tv1"]
    d = doc.displays["tv1"]
    assert d.default_connection == "plc1" and d.screen.active.endswith('"activeScreenNr"')
    assert {nr: [w.kind for w in s.items] for nr, s in d.screens.items()} == {
        1: ["alarms"], 2: ["counter", "number", "percent", "number", "time", "time"], 3: ["shift"], 4: ["oee"], 5: ["week"], 6: ["highscore"]
    }
    first = d.screens[2].items[0]
    assert (first.id, first.x, first.y, first.w, first.h, first.label, first.target) == ("s2-1", 0, 0, 12, 4, "Produktion", "TargetCount")
    assert (d.header.left, d.header.right) == ("customer", "vendor")
    assert d.default_connection == "plc1" and d.screen.connection == "plc1"
    assert d.screens[4].items[0].connection == "plc1"  # built-ins name their PLC
    assert doc.connections["plc1"].alarms == "ns=3;i=1815"


@pytest.mark.parametrize("path,fixture", [(EXAMPLE, "dashboard.view.json"), (STRESS, "stress.view.json")])
def test_view_matches_frontend_fixture(path, fixture):
    """The demo build migrates the same YAML in the browser (src/layout/layout.ts); both must agree.
    Regenerate after changing the YAML: python -m backend.layout_doc --view <file> > frontend/src/layout/fixtures/<name>"""
    view = layout_view(load_document(path))
    assert view == json.loads((FIXTURES / fixture).read_text(encoding="utf-8"))
    assert "node" not in json.dumps(view) and "opc.tcp" not in json.dumps(view)


def test_yaml_export_round_trip(tmp_path):
    for path in (EXAMPLE, STRESS, MULTI):
        doc = load_document(path)
        out = tmp_path / "v2.yaml"
        out.write_text(document_yaml(doc), encoding="utf-8")
        assert document_json(load_document(out)) == document_json(doc)


def test_multi_display_model_is_valid_but_runtime_runs_one():
    doc = load_document(MULTI)
    assert list(doc.connections) == ["plc1", "plc2", "plc3"] and list(doc.displays) == ["tv1", "tv2"]
    assert doc.displays["tv2"].screen.connection == "plc3" and doc.displays["tv2"].header.left == "none"
    assert layout_view(doc, "tv2")["display"]["header"] == {"left": "none", "right": "vendor"}
    assert len(runtime_problems(doc)) == 2
    with pytest.raises(ConfigError) as exc:
        Runtime(doc)
    assert any("etapp 4" in e for e in exc.value.errors)


def test_overlapping_displays_share_one_client_per_plc():
    """tv1 reads plc1, plc2, plc3; tv2 reads plc2, plc3. Each PLC appears once in the subscription
    plan (one OPC UA client), each node once, and each display only gets the tags it shows."""
    doc = load_document(MULTI)
    assert display_connections(doc, "tv1") == ["plc1", "plc2", "plc3"]
    assert display_connections(doc, "tv2") == ["plc2", "plc3"]
    plan = subscription_plan(doc)
    assert list(plan) == ["plc1", "plc2", "plc3"]
    assert plan["plc2"] == {'ns=3;s="DB Glaze"."level"': ["plc2.GlazeLevel"], 'ns=3;s="DB Glaze"."state"': ["plc2.GlazeState"]}
    nodes = [n for c in plan.values() for n in c]
    assert sum(len(c) for c in plan.values()) == len(set(zip([c for c in plan for _ in plan[c]], nodes, strict=True)))
    assert display_keys(doc, "tv2") == {"plc3.PackCount", "plc2.GlazeState", "plc3.ProductionState"}
    assert "plc1.OEE" in display_keys(doc, "tv1") and not any(k.startswith("plc1.") for k in display_keys(doc, "tv2"))
    # views: qualified references, only the PLCs the display uses
    v1, v2 = layout_view(doc, "tv1"), layout_view(doc, "tv2")
    assert [w["tag"] for w in v1["screens"]["2"]["items"]] == ["plc1.ProductionCount", "plc1.OEE", "plc2.GlazeLevel", "plc3.PackCount"]
    assert v1["screens"]["2"]["items"][0]["target"] == "plc1.TargetCount"
    assert list(v2["connections"]) == ["plc2", "plc3"] and "plc1.OEE" not in v2["tags"]
    assert v2["screens"]["2"]["items"][0]["connection"] == "plc3"


def test_two_aliases_on_one_node_are_subscribed_once():
    raw = doc_with("2: { items: [ { id: a, kind: number, x: 0, y: 0, w: 12, h: 12, label: A, tag: Count },"
                   " { id: b, kind: number, x: 12, y: 0, w: 12, h: 12, label: B, tag: Count2 } ] }")
    raw["connections"]["plc1"]["tags"]["Count2"] = 'ns=3;s="c"'
    plan = subscription_plan(validate_document(raw))
    assert plan["plc1"] == {'ns=3;s="c"': ["plc1.Count", "plc1.Count2"]}


def test_tag_references_across_plcs():
    raw = doc_with("""        2:
          items:
            - { id: a, kind: number, x: 0, y: 0, w: 12, h: 6, label: A, tag: plc2.Level }
            - { id: b, kind: number, x: 12, y: 0, w: 12, h: 6, label: B, tag: plc9.Level }
            - { id: c, kind: number, x: 0, y: 6, w: 12, h: 6, label: C, tag: plc2.Levle }
            - { id: d, kind: counter, x: 12, y: 6, w: 12, h: 6, label: D, tag: Count, target: plc2.Nope, connection: plc2 }
        """)
    raw["connections"]["plc2"] = {"tags": {"Level": 'ns=3;s="l"'}}
    errs = errors(raw)
    assert any("items → 1 → tag: okänd anslutning 'plc9' (menade du" in e for e in errs)
    assert any("items → 2 → tag: okänd tagg 'Levle' i plc2 (menade du 'Level'?)" in e for e in errs)
    assert any("items → 3 → target: okänd tagg 'Nope' i plc2" in e for e in errs)
    assert any("items → 3 → connection: connection används bara på inbyggda skärmar" in e for e in errs)
    assert not any("items → 0" in e for e in errs)
    # two connections and no default: a short name must say which PLC
    del raw["displays"]["tv1"]["screens"][2]["items"][1:]
    raw["displays"]["tv1"]["screens"][2]["items"][0]["tag"] = "Count"
    assert any("ange anslutningen, t.ex. 'plc1.Count'" in e for e in errors(raw))
    raw["displays"]["tv1"]["default_connection"] = "plc1"
    assert validate_document(raw).displays["tv1"].default_connection == "plc1"


def test_etapp1_versions_still_load():
    """Documents stored in etapp 1: display.connection, three header slots, built-ins without connection."""
    raw = {
        "schema_version": 2,
        "connections": {"plc1": {"tags": {"ProductionState": 'ns=3;s="p"', "Count": 'ns=3;s="c"'}}},
        "displays": {"tv1": {
            "connection": "plc1",
            "screen": {"active": "a", "requested": "r"},
            "header": {"left": {"kind": "logo", "asset": "customer"}, "center": {"kind": "clock"}, "right": {"kind": "text", "text": "Linje 3"}},
            "screens": {1: {"items": [{"id": "h", "kind": "highscore", "x": 0, "y": 0, "w": 24, "h": 12}]},
                        2: {"items": [{"id": "c", "kind": "number", "x": 0, "y": 0, "w": 24, "h": 12, "label": "C", "tag": "Count"}]}},
        }},
    }
    d = validate_document(raw).displays["tv1"]
    assert (d.default_connection, d.screen.connection, d.screens[1].items[0].connection) == ("plc1", "plc1", "plc1")
    assert (d.header.left, d.header.right) == ("customer", "none")


def doc_with(screens: str, header: str = "") -> dict:
    import yaml

    base = """\
    schema_version: 2
    connections:
      plc1:
        tags: { Count: ns=3;s="c", OEE: ns=3;s="o", ProductionState: ns=3;s="p" }
    displays:
      tv1:
        screen: { connection: plc1, active: ns=3;s="a", requested: ns=3;s="r" }
    """
    raw = yaml.safe_load(textwrap.dedent(base))
    raw["displays"]["tv1"]["screens"] = yaml.safe_load(textwrap.dedent(screens))
    if header:
        raw["displays"]["tv1"]["header"] = yaml.safe_load(textwrap.dedent(header))
    return raw


def errors(raw: dict) -> list[str]:
    with pytest.raises(ConfigError) as exc:
        validate_document(raw)
    return exc.value.errors


def test_widget_rules():
    errs = errors(doc_with("""\
        2:
          items:
            - { id: a, kind: number, x: 0, y: 0, w: 12, h: 6, label: A, tag: Count }
            - { id: b, kind: number, x: 6, y: 0, w: 12, h: 6, label: B, tag: Count }
            - { id: c, kind: number, x: 18, y: 6, w: 12, h: 6, label: C, tag: Nope }
            - { id: a, kind: percent, x: 0, y: 8, w: 8, h: 4, label: D, tag: OEE }
        """))
    assert any("items → 1: överlappar objekt 1 ('a')" in e for e in errs)
    assert any("items → 2: utanför rutnätet 24×12" in e for e in errs)
    assert any("items → 2 → tag: okänd tagg 'Nope' i plc1" in e for e in errs)
    assert any("items → 3 → id: id 'a' finns redan" in e for e in errs)
    assert any("items → 3: för liten ruta 8×4" in e for e in errs)


def test_builtin_rules_alarms_always_full_page():
    errs = errors(doc_with("""\
        1: { items: [ { id: a, kind: alarms, connection: plc1, x: 0, y: 0, w: 24, h: 6 } ] }
        2: { items: [ { id: o, kind: oee, connection: plc1, x: 0, y: 0, w: 24, h: 12, label: X } ] }
        3: { items: [ { id: w, kind: week, connection: plc1, x: 0, y: 0, w: 24, h: 12 } ] }
        4: { items: [ { id: h, kind: highscore, connection: plc1, x: 0, y: 0, w: 24, h: 12 } ] }
        5: { items: [ { id: s, kind: shift, x: 0, y: 0, w: 24, h: 12 } ] }
        6: { items: [ { id: t, kind: shift, connection: plc7, x: 0, y: 0, w: 24, h: 12 } ] }
        """))
    assert any("5 → items → 0 → connection: 'shift' behöver connection" in e for e in errs)
    assert any("6 → items → 0 → connection: okänd anslutning 'plc7'" in e for e in errs)
    assert any("1 → items → 0: 'alarms': larm visas alltid i helskärm" in e for e in errs)
    assert any("2 → items → 0: 'oee' har inga egna fält – ta bort label" in e for e in errs)
    assert any("'oee' kräver taggarna ShiftStart, ShiftEnd, TPM" in e for e in errs)
    assert any("'week' kräver taggen GoodCount eller ProductionCount" in e for e in errs)
    assert not any("highscore" in e for e in errs)  # ProductionState is there


def test_header_and_reference_rules():
    raw = doc_with("2: { items: [ { id: a, kind: number, x: 0, y: 0, w: 24, h: 12, label: A, tag: Count } ] }",
                   "{ left: none, right: customer }")
    raw["displays"]["tv1"]["screen"]["connection"] = "plc9"
    assert any("screen → connection: okänd anslutning 'plc9' (menade du 'plc1'?)" in e for e in errors(raw))
    raw = doc_with("2: { items: [ { id: a, kind: number, x: 0, y: 0, w: 24, h: 12, label: A, tag: Count } ] }",
                   "{ left: kund }")
    assert any("header → left:" in e and "customer" in e for e in errors(raw))
    raw = doc_with("2: { items: [ { id: a, kind: number, x: 0, y: 0, w: 24, h: 12, label: A, tag: Count } ] }",
                   "{ left: customer, center: clock }")
    assert any("header → center: okänd nyckel 'center'" in e for e in errors(raw))


# ---------------------------------------------------------------- versions in SQLite


async def test_bootstrap_imports_once_then_uses_the_database(db, tmp_path):
    store = LayoutStore(db)
    p = tmp_path / "dashboard.yaml"
    p.write_text(EXAMPLE.read_text(encoding="utf-8"), encoding="utf-8")
    rt = await bootstrap(store, p)
    assert rt.version == 1 and rt.display_id == "tv1" and rt.view()["version"] == 1
    # unchanged file: no new version
    rt = await bootstrap(store, p)
    assert rt.version == 1 and len(await store.versions()) == 1
    # a version published by the editor wins while the file is unchanged
    doc = load_document(p)
    doc.displays["tv1"].screens[2].title = "Från editorn"
    await publish(store, doc, author="johan", comment="test")
    rt = await bootstrap(store, p)
    assert rt.version == 2 and rt.screens[2].title == "Från editorn"
    # the file changed, but the editor has published: auto leaves the database alone (logged)
    p.write_text(p.read_text(encoding="utf-8").replace("title: Dashboard", "title: Ny titel"), encoding="utf-8")
    rt = await bootstrap(store, p)
    assert rt.version == 2 and rt.screens[2].title == "Från editorn"
    # always: the changed file is imported as a new version (version 2 stays restorable)
    rt = await bootstrap(store, p, yaml_import="always")
    assert rt.version == 3 and rt.screens[2].title == "Ny titel"
    versions = await store.versions()
    assert [(v["id"], v["source"], v["published"]) for v in versions] == [(3, "yaml", True), (2, "editor", False), (1, "yaml", False)]
    assert versions[1]["author"] == "johan"


async def test_auto_imports_a_changed_file_until_the_editor_publishes(db, tmp_path):
    store = LayoutStore(db)
    p = tmp_path / "dashboard.yaml"
    p.write_text(EXAMPLE.read_text(encoding="utf-8"), encoding="utf-8")
    await bootstrap(store, p)
    p.write_text(p.read_text(encoding="utf-8").replace("title: Dashboard", "title: Andra"), encoding="utf-8")
    rt = await bootstrap(store, p)
    assert rt.version == 2 and rt.screens[2].title == "Andra"
    assert not await store.editor_used()


async def test_bootstrap_import_off_and_invalid_file(db, tmp_path):
    store = LayoutStore(db)
    p = tmp_path / "dashboard.yaml"
    p.write_text(EXAMPLE.read_text(encoding="utf-8"), encoding="utf-8")
    await bootstrap(store, p)
    p.write_text(p.read_text(encoding="utf-8").replace("title: Dashboard", "title: Ignorerad"), encoding="utf-8")
    rt = await bootstrap(store, p, yaml_import="off")
    assert rt.version == 1 and rt.screens[2].title == "Dashboard"
    p.write_text("opc: {}\n", encoding="utf-8")
    with pytest.raises(ConfigError):
        await bootstrap(store, p)  # fail fast like before: an invalid changed file is never published silently
    assert len(await store.versions()) == 1


async def test_bootstrap_without_file_or_database(db, tmp_path):
    with pytest.raises(ConfigError) as exc:
        await bootstrap(LayoutStore(db), tmp_path / "saknas.yaml")
    assert "databasen har ingen publicerad layout" in exc.value.errors[0]


async def test_publish_refuses_what_the_runtime_cannot_run(db):
    store = LayoutStore(db)
    await store.init_db()
    with pytest.raises(ConfigError):
        await publish(store, load_document(MULTI), author="johan")
    assert await store.versions() == []


def test_layout_versions_survive_retention(db):
    """layout_versions is not touched by the data_points retention."""
    import asyncio

    from backend.opc.data_logger import DataLogger

    async def run():
        store = LayoutStore(db)
        await store.init_db()
        await store.add_version(load_document(EXAMPLE), "yaml")
        logger = DataLogger(db)
        await logger.init_db()
        await logger.purge_older_than(0)
        return await store.versions()

    assert len(asyncio.run(run())) == 1


def test_runtime_data_nodes_like_before():
    rt = Runtime(load_document(EXAMPLE))
    nodes = {n["alias"]: n for n in rt.data_nodes()}
    assert nodes["GoodCount"]["placeholder"] and not nodes["OEE"]["placeholder"]
    assert nodes["CurrentRuntime"]["datatype"] == "Time_Of_Day"
    assert rt.has_kind("week") and not rt.has_kind("gauge")
    assert isinstance(Path(MULTI), Path)


async def test_restore_publishes_old_version_again(db, tmp_path):
    store = LayoutStore(db)
    p = tmp_path / "dashboard.yaml"
    p.write_text(EXAMPLE.read_text(encoding="utf-8"), encoding="utf-8")
    first = await bootstrap(store, p)
    p.write_text(EXAMPLE.read_text(encoding="utf-8").replace("title: Dashboard", "title: Linje 3"), encoding="utf-8")
    await bootstrap(store, p)
    vid = await restore(store, first.version, author="johan")
    assert vid == 3
    assert (await store.versions())[0] | {"created": None} == {
        "id": 3, "created": None, "author": "johan", "source": "restore", "comment": "återställd från version 1", "published": True,
    }
    rt = await bootstrap(store, p)  # file unchanged since the last import: the restored version stays
    assert rt.version == 3
    assert rt.screens[2].title == "Dashboard"
    with pytest.raises(KeyError):
        await restore(store, 99)
