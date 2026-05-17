
import datetime
from pathlib import Path

import streamlit as st
from streamlit_autorefresh import st_autorefresh
from state_store import general_store, alarm_store, data_store

# Set up wide layout for industrial display walls
st.set_page_config(layout="wide", page_title="Line Production TV")

# Hide the Streamlit header, Deploy button, and hamburger menu for a clean TV Wall view
st.markdown(
    """
    <style>
        [data-testid="stHeader"] { visibility: hidden; height: 0%; }
        .block-container { padding-top: 0rem; padding-bottom: 0rem; }

        /* Style native Streamlit metrics for industrial TV display */
        [data-testid="stMetricValue"] {
            font-size: 6rem !important;
            font-weight: 800;
            font-family: 'Consolas', 'Courier New', monospace;
        }
        [data-testid="stMetricLabel"] {
            font-size: 2rem !important;
            font-weight: 600;
            color: #9ca3af;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        [data-testid="stMetricDelta"] {
            font-size: 2.5rem !important;
            font-weight: 700;
        }
    </style>
    """,
    unsafe_allow_html=True
)

ALARM_STATIC_CSS = Path("./templates/AlarmScreen/style.css").read_text(encoding="utf-8")
ALARM_HTML_TEMPLATE = Path("./templates/AlarmScreen/alarm_template.html").read_text(encoding="utf-8")

HEADER_STATIC_CSS = Path("./templates/Header/style.css").read_text(encoding="utf-8")
HEADER_TEMPLATE = Path("./templates/Header/header_template.html").read_text(encoding="utf-8")

RAW_ABECE_LOGO_SVG = Path("./static/abeceLogo.svg").read_text(encoding="utf-8")


# ------------------------------------------------------------------
# 🏭 SHARED GLOBAL HEADER (Logos + Live Clock)
# ------------------------------------------------------------------
def get_global_header_html():
    """Return the global header HTML + CSS as a single string."""
    current_time = datetime.datetime.now().strftime("%H:%M:%S")

    header_html = HEADER_TEMPLATE.replace("{{CLOCK}}", current_time)
    header_html = header_html.replace("{{ABECE_LOGO_SVG}}", RAW_ABECE_LOGO_SVG)

    combined = f"<style>{HEADER_STATIC_CSS}</style>\n{header_html}"
    return "".join([line.strip() for line in combined.splitlines()])


# ------------------------------------------------------------------
# 🛠️ 1. DEFINING YOUR TWO SPECIFIC VIEWS
# ------------------------------------------------------------------

def show_alarm_view(container):
    # Build header
    header_html = get_global_header_html()

    # Build alarms
    raw_alarms_dict = alarm_store.get_active_alarms()
    active_alarms = sorted(
        raw_alarms_dict.values(),
        key=lambda alarm: alarm.timestamp,
        reverse=True
    )

    if active_alarms:
        rows_pool = [f'<div class="alarm-row">{alarm.message}</div>' for alarm in active_alarms]
        alarm_body = ALARM_HTML_TEMPLATE.replace("{{ALARMS}}", "".join(rows_pool))
    else:
        alarm_body = (
            '<div style="background-color: #042f1a; color: #4ade80; border: 3px solid #22c55e; '
            'padding: 4rem; border-radius: 20px; font-size: 3.5rem; font-weight: bold; text-align: center;">'
            '✅ No active program alarms reported from the PLC.'
            '</div>'
        )

    # Combine header + alarms into ONE payload (required for st.empty)
    all_css = HEADER_STATIC_CSS + "\n" + ALARM_STATIC_CSS
    full_html = f"<style>{all_css}</style>\n{header_html}\n{alarm_body}"

    container.markdown(full_html, unsafe_allow_html=True)


def show_dashboard_view_one(container):
    header_html = get_global_header_html()
    container.markdown(header_html, unsafe_allow_html=True)

    # 📝 Fetch live data from the OPC-UA data store
    target_val = data_store.get("TargetCount", "1,200 pcs/h")
    rate_val = data_store.get("ProductionCount", "0 pcs/h")
    oee_val = data_store.get("OEE", "0.0%")
    rate_delta = data_store.get("ProductionDelta", "-12%")
    oee_delta = data_store.get("OEEDelta", "+0.4%")

    def format_delta(delta):
        """Convert numeric/string delta to display string + Streamlit delta_color."""
        if isinstance(delta, (int, float)):
            if delta >= 0:
                return f"+{delta}%", "normal"
            else:
                return f"{delta}%", "inverse"
        else:
            delta_str = str(delta).strip()
            if delta_str.startswith("-"):
                return delta_str, "inverse"
            elif delta_str.startswith("+"):
                return delta_str, "normal"
            else:
                return delta_str, "normal"

    rate_delta_str, rate_delta_color = format_delta(rate_delta)
    oee_delta_str, oee_delta_color = format_delta(oee_delta)

    # Use native Streamlit metrics in a responsive grid
    col1, col2, col3 = st.columns(3)

    with col1:
        st.metric(
            label="Target Production",
            value=str(target_val),
            delta="STABLE",
            delta_color="normal"
        )

    with col2:
        st.metric(
            label="Current Rate",
            value=str(rate_val),
            delta=rate_delta_str,
            delta_color=rate_delta_color
        )

    with col3:
        st.metric(
            label="OEE Efficiency",
            value=str(oee_val),
            delta=oee_delta_str,
            delta_color=oee_delta_color
        )


# Map the integer IDs matching your PLC's DB logic
PAGE_MAP = {
    1: show_alarm_view,
    2: show_dashboard_view_one
}

# ------------------------------------------------------------------
# 🔄 2. AUTOMATIC HEARTBEAT TIMERS & PLC SYNC
# ------------------------------------------------------------------

st_autorefresh(interval=1000, key="plc_heartbeat_timer")

if "ActiveScreenNr" not in st.session_state:
    plc_current = general_store.get("RequestedScreenNr")
    st.session_state.ActiveScreenNr = plc_current if plc_current is not None else 1

plc_requested = general_store.get("RequestedScreenNr")

if plc_requested is not None and st.session_state.ActiveScreenNr != plc_requested:
    st.session_state.ActiveScreenNr = plc_requested

general_store.set("ActiveScreenNr", st.session_state.ActiveScreenNr)


# ------------------------------------------------------------------
# 🚀 3. RENDER ACTIVE PAGE IN PLACEHOLDER
# ------------------------------------------------------------------

view_anchor = st.empty()

current_page_number = st.session_state.ActiveScreenNr
render_page = PAGE_MAP.get(current_page_number, show_alarm_view)

render_page(view_anchor)