"""Chart/KPI elements in the layout document: shared catalogue, field rules, minimum sizes, examples."""

from pathlib import Path

import pytest

from backend.layout_doc import CHART_CATALOG, CHART_KINDS, Widget, check_document, load_document

BASE = Path(__file__).resolve().parents[2]
EXAMPLES = ["oee-element.yaml", "7dagar-element.yaml", "diagram.yaml"]


def doc(*items, tags=("OEE", "TPM", "GoodCount", "ShiftStart", "ShiftEnd", "ProductionState")):
    return {
        "schema_version": 2,
        "connections": {"plc1": {"tags": {t: f"ns=3;s={t}" for t in tags}}},
        "displays": {"tv1": {"screen": {"connection": "plc1", "active": "a", "requested": "r"}, "screens": {1: {"items": list(items)}}}},
    }


def problems(*items):
    _, out = check_document(doc(*items))
    return [p["message"] for p in out]


def W(kind, x=0, y=0, w=None, h=None, **kw):
    dw, dh = CHART_CATALOG["kinds"][kind]["default"] if kind in CHART_KINDS else (12, 4)
    return {"id": f"e-{kind}-{x}-{y}", "kind": kind, "x": x, "y": y, "w": w or dw, "h": h or dh, **kw}


@pytest.mark.parametrize("name", EXAMPLES)
def test_examples_are_valid(name):
    d = load_document(BASE / "docs" / "examples" / name)
    kinds = {w.kind for s in d.displays["tv1"].screens.values() for w in s.items}
    assert kinds & set(CHART_KINDS)


def test_every_catalogue_kind_is_a_widget_kind_and_metric_formats_known():
    allowed = Widget.model_fields["kind"].annotation.__args__
    assert set(CHART_KINDS) <= set(allowed)
    assert {m["format"] for m in CHART_CATALOG["metrics"].values()} <= {"pct", "int", "dec1", "minutes", "hm", "clock"}
    for kind, spec in CHART_CATALOG["kinds"].items():
        assert spec["min"][0] <= spec["default"][0] and spec["min"][1] <= spec["default"][1], kind
        assert set(spec["fields"]) <= set(Widget.model_fields), kind


def test_defaults_of_every_kind_are_valid():
    for kind in CHART_KINDS:
        extra = {"metric": "oee"} if kind in ("kpi", "gauge", "trend") else {}
        w, h = CHART_CATALOG["kinds"][kind]["default"]
        _, out = check_document(doc(W(kind, 0, 0, w, h, **extra)))
        assert out == [], (kind, out)


def test_minimum_size_per_kind():
    for kind in CHART_KINDS:
        mw, mh = CHART_CATALOG["kinds"][kind]["min"]
        extra = {"metric": "oee"} if kind in ("kpi", "gauge", "trend") else {}
        assert problems(W(kind, w=mw, h=mh, **extra)) == [], kind
        msgs = problems(W(kind, w=mw - 1, h=mh, **extra))
        assert any(f"minst {mw}×{mh} för '{kind}'" in m for m in msgs), (kind, msgs)


def test_metric_and_period_rules():
    assert "okänt värde 'oe' (menade du 'oee'?)" in problems(W("kpi", metric="oe"))
    assert any("finns bara för pågående skift" in m for m in problems(W("kpi", metric="prognosis", period="7d")))
    assert problems(W("kpi", metric="prognosis", period="shift")) == []
    assert any("finns bara för pågående skift" in m for m in problems(W("bars", metric="speed")))
    assert problems(W("kpi", metric="oee", period="30d", target_metric="oee_target", sub_metric="scrap_pct")) == []
    assert any("saknas" in m for m in problems(W("kpi")))
    assert any("target eller target_metric" in m for m in problems(W("kpi", metric="good", target=100, target_metric="target")))


def test_tag_source_and_references():
    assert problems(W("kpi", source="tag", tag="OEE", unit="%", thresholds=[75, 85])) == []
    assert any("okänd tagg 'OEX'" in m for m in problems(W("kpi", source="tag", tag="OEX")))
    assert any("obligatorisk med source: tag" in m for m in problems(W("kpi", source="tag")))
    assert any("tag används bara med source: tag" in m for m in problems(W("kpi", metric="oee", tag="OEE")))
    assert any("ta bort metric/period" in m for m in problems(W("kpi", source="tag", tag="OEE", metric="oee")))
    assert problems(W("trend", source="tag", tag="TPM")) == []


def test_fields_per_kind_and_series_rules():
    assert any("har inte fälten states" in m for m in problems(W("kpi", metric="oee", states={1: {"text": "A"}})))
    assert any("har inte fälten columns" in m for m in problems(W("bars", columns=["good"])))
    assert any("högst 14 för series: shifts" in m for m in problems(W("bars", series="shifts", count=20)))
    assert problems(W("bars", series="days", count=30)) == []
    assert any("okänd kolumn 'goods'" in m for m in problems(W("table", columns=["label", "goods"])))
    assert any("[varning, bra]" in m for m in problems(W("gauge", metric="oee", thresholds=[90, 80])))
    assert any("ange max" in m for m in problems(W("gauge", metric="good")))
    assert any("historik och beräknade värden" in m for m in problems(W("timeline", connection="plc1")))


def test_value_elements_keep_their_rules():
    long = "x" * 21
    assert any("för lång text (21 tecken, max 20" in m for m in problems(W("number", label=long, tag="OEE")))
    assert problems(W("bars", label="7 dagar · OEE % · godkända st och mer")) == []
    assert any("bara diagram och KPI" in m for m in problems(W("number", label="OEE", tag="OEE", period="7d")))
    assert any("inga egna fält" in m for m in problems({"id": "o", "kind": "oee", "connection": "plc1", "x": 0, "y": 0, "w": 24, "h": 12, "period": "7d"}))
