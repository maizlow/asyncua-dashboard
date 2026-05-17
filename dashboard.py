import datetime
from pathlib import Path

import streamlit as st
from streamlit_autorefresh import st_autorefresh
import streamlit.components.v1 as components

from state_store import general_store, alarm_store, data_store

# Set up wide layout for industrial display walls
st.set_page_config(layout="wide", page_title="Line Production TV")

# Hide the Streamlit header, Deploy button, and hamburger menu for a clean TV Wall view
st.markdown(
    """
    <style>
        /* Hide the entire top header bar */
        [data-testid="stHeader"] {
            visibility: hidden;
            height: 0%;
        }
        
        /* Optional: Reduce excess top padding left behind by the hidden header */
        .block-container {
            padding-top: 0rem;
            padding-bottom: 0rem;
        }
    </style>
    """,
    unsafe_allow_html=True
)

ALARM_STATIC_CSS = Path("./templates/AlarmScreen/style.css").read_text(encoding="utf-8")
ALARM_HTML_TEMPLATE = Path("./templates/AlarmScreen/alarm_template.html").read_text(encoding="utf-8")
    
DASHBOARD_STATIC_CSS = Path("./templates/DashboardScreen/style.css").read_text(encoding="utf-8")
DASHBOARD_TEMPLATE = Path("./templates/DashboardScreen/dashboard_template.html").read_text(encoding="utf-8")

RAW_ABECE_LOGO_SVG = Path("./static/abeceLogo.svg").read_text(encoding="utf-8")

# ------------------------------------------------------------------
# 🛠️ 1. DEFINING YOUR TWO SPECIFIC VIEWS
# ------------------------------------------------------------------

# 💡 Note: We now pass the persistent container into the render functions
def show_alarm_view(container):
    raw_alarms_dict = alarm_store.get_active_alarms()
    active_alarms = sorted(
        raw_alarms_dict.values(), 
        key=lambda alarm: alarm.timestamp, 
        reverse=True
    )
    
    if active_alarms:
        rows_pool = [f'<div class="alarm-row">{alarm.message}</div>' for alarm in active_alarms]
        final_render = ALARM_HTML_TEMPLATE.replace("{{ALARMS}}", "".join(rows_pool))
        payload = f"<style>{ALARM_STATIC_CSS}</style>\n{final_render}"
    else:
        payload = (
            '<div style="background-color: #042f1a; color: #4ade80; border: 3px solid #22c55e; '
            'padding: 4rem; border-radius: 20px; font-size: 3.5rem; font-weight: bold; text-align: center;">'
            '✅ No active program alarms reported from the PLC.'
            '</div>'
        )
    
    flattened_html = "".join([line.strip() for line in payload.splitlines()])
    container.markdown(flattened_html, unsafe_allow_html=True)


def show_dashboard_view_one(container):
    # 📝 Fetch live data safely using your updated .get() defaults
    target_val = data_store.get("TargetCount", "1,200 pcs/h")
    rate_val = data_store.get("ProductionCount", "0 pcs/h")
    oee_val = data_store.get("OEE", "0.0%")
    rate_delta = data_store.get("ProductionDelta", "-12%")
    oee_delta = data_store.get("OEEDelta", "+0.4%")
   
    if isinstance(rate_delta, (int, float)):
        # Handle positive trends and neutral zero states safely
        if rate_delta >= 0:
            rate_delta_str = f"+{rate_delta}%"
            rate_class = "delta-positive"  # Green
        else:
            # Drop the minus sign if it's already negative to avoid double negatives like --12%
            clean_val = abs(rate_delta)
            rate_delta_str = f"-{clean_val}%"
            rate_class = "delta-negative"  # Red
    else:
        # Fallback processing if the data store already holds a string payload
        rate_delta_str = str(rate_delta).strip()
        rate_class = "delta-negative" if rate_delta_str.startswith("-") else "delta-positive"

    if isinstance(oee_delta, (int, float)):
        # Handle positive trends and neutral zero states safely
        if oee_delta >= 0:
            oee_delta_str = f"+{oee_delta}%"
            oee_class = "delta-positive"  # Green
        else:
            # Drop the minus sign if it's already negative to avoid double negatives like --12%
            clean_val = abs(oee_delta)
            oee_delta_str = f"-{clean_val}%"
            oee_class = "delta-negative"  # Red
    else:
        # Fallback processing if the data store already holds a string payload
        oee_delta_str = str(oee_delta).strip()
        oee_class = "delta-negative" if oee_delta_str.startswith("-") else "delta-positive"
    
    

    html_content = DASHBOARD_TEMPLATE.replace("{{ABECE_LOGO_SVG}}", RAW_ABECE_LOGO_SVG)
    html_content = html_content.replace("{{TARGET}}", str(target_val))
    html_content = html_content.replace("{{RATE}}", str(rate_val))
    html_content = html_content.replace("{{RATE_DELTA}}", rate_delta_str)
    html_content = html_content.replace("{{OEE}}", str(oee_val))
    html_content = html_content.replace("{{OEE_DELTA}}", oee_delta_str)
    html_content = html_content.replace("{{RATE_CLASS}}", rate_class)
    html_content = html_content.replace("{{OEE_CLASS}}", oee_class)

    current_time = datetime.datetime.now().strftime("%H:%M:%S")
    html_content = html_content.replace("{{CLOCK}}", current_time)

    combined_payload = f"<style>{DASHBOARD_STATIC_CSS}</style>\n{html_content}"
    flattened_html = "".join([line.strip() for line in combined_payload.splitlines()])

    # 🚀 Write directly into the view container to avoid resetting the parent layout DOM
    container.markdown(flattened_html, unsafe_allow_html=True)
    

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

# 🎨 1. Create the distinct placeholder for your changing dashboard data views
view_anchor = st.empty()

current_page_number = st.session_state.ActiveScreenNr
render_page = PAGE_MAP.get(current_page_number, show_alarm_view)

# Execute and inject the UI layout template into the dynamic telemetry anchor
render_page(view_anchor)

# 🚀 2. Standard inline script (No session_state!). 
# Because st_autorefresh ticks every 1 second, Streamlit runs this script 
# perfectly in sync with your data frames!
st.markdown(
    """
    <script>
        var clockElement = document.getElementById('factory-live-clock');
        if (clockElement) {
            var now = new Date();
            var hours = String(now.getHours()).padStart(2, '0');
            var minutes = String(now.getMinutes()).padStart(2, '0');
            var seconds = String(now.getSeconds()).padStart(2, '0');
            clockElement.textContent = hours + ":" + minutes + ":" + seconds;
        }
    </script>
    """,
    unsafe_allow_html=True
)