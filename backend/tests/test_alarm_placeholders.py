from types import SimpleNamespace

from backend.opc.opc_program_alarm_events import AlarmHandler


def variant(v):
    return SimpleNamespace(Value=v)


def test_placeholders_replaced_with_associated_values():
    event = SimpleNamespace(AssociatedValue_01=variant(3), AssociatedValue_02=variant(42))
    msg = AlarmHandler().parse_and_replace_placeholders("Station @1%u@: motor @2%d@ overload", event)
    assert msg == "Station 3: motor 42 overload"


def test_namespaced_attribute_and_width_format():
    event = SimpleNamespace(**{"3_AssociatedValue_05": variant(7)})
    assert AlarmHandler().parse_and_replace_placeholders("Code @5%03u@", event) == "Code 007"


def test_float_and_string_values():
    event = SimpleNamespace(AssociatedValue_01=variant(21.456), AssociatedValue_02=variant("B12"))
    msg = AlarmHandler().parse_and_replace_placeholders("Temp @1%.1f@ in @2%s@", event)
    assert msg == "Temp 21.5 in B12"


def test_missing_value_keeps_placeholder():
    event = SimpleNamespace(AssociatedValue_01=None)
    assert AlarmHandler().parse_and_replace_placeholders("Level @1%u@ @2%u@", event) == "Level @1%u@ @2%u@"


def test_unformattable_value_falls_back_to_str():
    event = SimpleNamespace(AssociatedValue_01=variant("abc"))
    assert AlarmHandler().parse_and_replace_placeholders("Val @1%u@", event) == "Val abc"


def test_event_notification_adds_and_removes_alarm(monkeypatch):
    from backend.opc import opc_program_alarm_events as mod
    from backend.opc.state_store import AlarmStore

    store = AlarmStore()
    monkeypatch.setattr(mod, "alarm_store", store)
    handler = AlarmHandler()

    active = SimpleNamespace(
        Message=SimpleNamespace(Text="Jam at @1%u@"),
        Time=None,
        ID=17,
        DisplayClass=1,
        AssociatedValue_01=variant(4),
        **{"ActiveState/Id": True},
    )
    handler.event_notification(active)
    assert store.get_all()[17].message == "Jam at 4"

    cleared = SimpleNamespace(Message="Jam", Time=None, ID="17", DisplayClass=1, **{"ActiveState/Id": False})
    handler.event_notification(cleared)
    assert store.get_all() == {}
