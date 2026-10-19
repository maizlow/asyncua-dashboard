import json
import textwrap
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.dashboard_config import BASE_DIR, ConfigError, json_schema, load_dashboard

EXAMPLE = BASE_DIR / "dashboard.yaml"
STRESS = BASE_DIR / "docs" / "examples" / "stress.yaml"

HEADER = """\
opc:
  screen:
    active: ns=3;s="DB"."active"
    requested: ns=3;s="DB"."requested"
tags:
  Count: ns=3;s="DB"."count"
  OEE: { node: ns=3;s="DB"."oee" }
  Run: { node: ns=3;s="DB"."run", type: time }
  Later: ""
"""


def write(tmp_path: Path, body: str) -> Path:
    p = tmp_path / "dashboard.yaml"
    p.write_text(HEADER + textwrap.dedent(body), encoding="utf-8")
    return p


def errors_for(tmp_path: Path, body: str) -> list[str]:
    with pytest.raises(ConfigError) as exc:
        load_dashboard(write(tmp_path, body))
    return exc.value.errors


def test_example_matches_current_screens():
    d = load_dashboard(EXAMPLE)
    assert {nr: s.type for nr, s in d.screens.items()} == {1: "alarms", 2: "grid", 3: "shift", 4: "oee", 5: "week", 6: "highscore"}
    labels = [i.label for i in d.screens[2].items]
    assert labels == ["Produktion", "Delta", "OEE", "Linjehastighet", "Aktuell körtid", "Total stopptid"]
    assert d.opc.alarms == "ns=3;i=1815"


def test_example_placeholders_are_skipped():
    nodes = {n["alias"]: n for n in load_dashboard(EXAMPLE).data_nodes()}
    assert nodes["GoodCount"]["placeholder"] and nodes["RejectCount"]["placeholder"]
    assert not nodes["OEE"]["placeholder"]
    assert nodes["CurrentRuntime"]["datatype"] == "Time_Of_Day"
    assert nodes["ProductionCount"]["nodeid"] == 'ns=3;s="DB Production TV"."dashboardData"."actual"'


def test_stress_example_is_valid():
    d = load_dashboard(STRESS)
    assert len(d.screens) == 8


def test_legacy_config_module_reads_yaml():
    import backend.config as config

    assert config.SCREEN_NODES["ActiveScreenNr"].endswith('"activeScreenNr"')
    assert config.DEFAULT_NODES == {"ConditionType": "ns=0;i=2782", "ProgramAlarms": "ns=3;i=1815"}
    assert any(n["alias"] == "TPM" for n in config.DASHBOARD_DATA_NODES)


def test_layout_has_no_node_ids_and_applies_defaults(tmp_path):
    d = load_dashboard(write(tmp_path, """\
        screens:
          2:
            items:
              - { label: OEE, tag: OEE, type: percent }
        """))
    layout = d.layout()
    assert "node" not in json.dumps(layout)
    item = layout["screens"]["2"]["items"][0]
    assert item["unit"] == "%" and item["type"] == "percent" and layout["screens"]["2"]["type"] == "grid"
    assert layout["tags"]["Run"] == {"type": "time", "placeholder": False}
    assert layout["tags"]["Later"]["placeholder"] is True


def test_unknown_tag_points_at_line_and_suggests(tmp_path):
    errs = errors_for(tmp_path, """\
        screens:
          2:
            items:
              - { label: Antal, tag: Cuont }
        """)
    assert errs == ["dashboard.yaml:13 screens → 2 → items → 0 → tag: okänd tagg 'Cuont' (menade du 'Count'?)"]


def test_typo_in_key_is_reported(tmp_path):
    errs = errors_for(tmp_path, """\
        screens:
          2:
            items:
              - lable: Antal
                tag: Count
        """)
    assert any("okänd nyckel 'lable' (menade du 'label'?)" in e and ":13 " in e for e in errs)
    assert any("label: saknas" in e for e in errs)


def test_duplicate_key_is_an_error(tmp_path):
    errs = errors_for(tmp_path, """\
        screens:
          2: { items: [ { label: A, tag: Count } ] }
          2: { type: oee }
        """)
    assert len(errs) == 1 and "dashboard.yaml:12" in errs[0] and "finns redan" in errs[0]


def test_yaml_syntax_error_has_line(tmp_path):
    errs = errors_for(tmp_path, """\
        screens:
          2:
            items:
              - { label: A, tag: Count
        """)
    assert errs[0].startswith("dashboard.yaml:") and "YAML-syntaxfel" in errs[0]


def test_layout_limits(tmp_path):
    items = "\n".join(f"      - {{ label: A{i}, tag: Count }}" for i in range(7))
    errs = errors_for(tmp_path, f"""\
screens:
  2:
    items:
{items}
  4: {{ type: oee }}
""")
    joined = "\n".join(errs)
    assert "1–6 objekt (har 7)" in joined
    assert "skärmtypen 'oee' kräver taggarna ShiftStart, ShiftEnd, ProductionState, TPM" in joined


def test_text_length_limits(tmp_path):
    # Field errors are reported first; reference/layout rules run once the fields are valid
    errs = errors_for(tmp_path, """\
        screens:
          3:
            items:
              - { label: Den här rubriken är för lång, tag: Count, unit: kilogram }
        """)
    assert errs == [
        "dashboard.yaml:13 screens → 3 → items → 0 → label: för lång text (28 tecken, max 20 för att få plats på TV:n)",
        "dashboard.yaml:13 screens → 3 → items → 0 → unit: för lång text (8 tecken, max 6 för att få plats på TV:n)",
    ]


def test_item_rules(tmp_path):
    errs = errors_for(tmp_path, """\
        screens:
          2:
            items:
              - { label: Läge, tag: Count, type: status }
              - { label: OEE, tag: OEE, thresholds: [85, 75] }
              - { label: Tid, tag: Run, type: time, trend: true }
              - { label: Mål, tag: Count, type: counter, target: Mal }
        """)
    joined = "\n".join(errs)
    assert "states: status-objekt behöver states" in joined
    assert "thresholds: skriv [varning, bra]" in joined
    assert "type: time stöder inte" in joined
    assert "target: okänd tagg 'Mal'" in joined


def test_invalid_item_type(tmp_path):
    errs = errors_for(tmp_path, """\
        screens:
          2:
            items:
              - { label: Fel, tag: Count, type: gauge }
        """)
    assert errs == [
        "dashboard.yaml:13 screens → 2 → items → 0 → type: ogiltigt värde 'gauge', "
        "tillåtet: 'number', 'percent', 'counter', 'time' eller 'status'"
    ]


def test_missing_screen_nodes(tmp_path):
    p = tmp_path / "d.yaml"
    p.write_text("opc: {}\nscreens: { 1: { type: alarms } }\n", encoding="utf-8")
    with pytest.raises(ConfigError) as exc:
        load_dashboard(p)
    assert exc.value.errors == ["d.yaml:1 opc → screen: saknas (obligatorisk)"]


def test_committed_json_schema_is_up_to_date():
    committed = json.loads((BASE_DIR / "docs" / "dashboard.schema.json").read_text(encoding="utf-8"))
    assert committed == json_schema(), "run: python -m backend.dashboard_config --schema > docs/dashboard.schema.json"


def test_layout_endpoint():
    from backend.app.main import create_app

    client = TestClient(create_app())
    res = client.get("/api/layout")
    assert res.status_code == 200
    assert res.json()["screens"]["4"]["items"][0]["kind"] == "oee"
    assert client.get("/api/layout?display=tv1").json() == res.json()
    missing = client.get("/api/layout?display=nope")
    assert missing.status_code == 404 and "okänd display 'nope'" in missing.json()["details"][0]
    assert client.get("/api/displays").json() == [{"id": "tv1", "name": None}]


def test_week_screen_needs_shift_and_count_tags(tmp_path):
    errs = errors_for(tmp_path, """\
        screens:
          5: { type: week }
        """)
    assert any("skärmtypen 'week' kräver taggarna ShiftStart, ShiftEnd, ProductionState" in e for e in errs)
    assert any("skärmtypen 'week' kräver taggen GoodCount eller ProductionCount" in e for e in errs)


def test_week_screen_layout_type(tmp_path):
    p = tmp_path / "dashboard.yaml"
    p.write_text(
        HEADER.replace("tags:\n", "tags:\n  ShiftStart: a\n  ShiftEnd: b\n  ProductionState: c\n  GoodCount: d\n")
        + "screens:\n  5: { type: week, title: Senaste 7 dagarna }\n",
        encoding="utf-8",
    )
    assert load_dashboard(p).layout()["screens"]["5"]["type"] == "week"


def test_highscore_screen_needs_production_state(tmp_path):
    errs = errors_for(tmp_path, """\
        screens:
          6: { type: highscore }
        """)
    assert any("skärmtypen 'highscore' kräver" in e and "ProductionState" in e for e in errs)
