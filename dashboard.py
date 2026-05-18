import datetime
from pathlib import Path

import streamlit as st
from streamlit_autorefresh import st_autorefresh

import altair as alt
import pandas as pd

from state_store import general_store, alarm_store, data_store
import config

# Set up wide layout for industrial display walls
st.set_page_config(layout="wide", page_title="Line Production TV")

# Hide the Streamlit header, Deploy button, and hamburger menu for a clean TV Wall view
st.markdown(
    """
    <style>
        [data-testid="stHeader"] { visibility: hidden; height: 0%; }
        .block-container { padding-top: 0rem; padding-bottom: 0rem; }

        /* Style native Streamlit metrics for industrial TV display */
        [data-testid="stMetric"] {
            height: 48rem;
        }
        [data-testid="stMetricValue"] {
            font-size: 10rem !important;
            font-weight: 800;
            font-family: 'Consolas', 'Courier New', monospace;
            margin-bottom: 1.5rem;
        }
        [data-testid="stMetricLabel"] > div {
            color: #9ca3af !important;
            text-transform: uppercase;
            letter-spacing: 0.3px;
            font-family: 'Consolas', 'Courier New', monospace;
            font-size: 5rem !important;
            font-style: bold;
        }
        [data-testid="stMetricDelta"] {
            font-size: 8.5rem !important;
            font-weight: 700;
            padding-left: 1.5rem;
            padding-right: 2rem;
        }
        [data-testid^="stMetricDeltaIcon"] {
            width: 5.2rem !important;
            height: 5.2rem !important;
        }
        [data-testid="stMetricChart"],
        [data-testid="stMetricChart"] .vega-embed,
        [data-testid="stMetricChart"] .marks,
        [data-testid="stMetricChart"] svg {
            height: 160px !important;
            min-height: 160px !important;
            max-height: 160px !important;
        }

        [data-testid="stMetricChart"] svg {
            width: 100% !important;
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


def custom_metric(label, value, delta=None, history=None, 
                  height=500, chart_height=160, 
                  border=True):
    
    with st.container(border=border,):
        st.markdown(f"""
            <div style="
                height: {height}px; 
                max-height: {height}px;
                min-height: {height}px;
                display: flex; 
                flex-direction: column;
                justify-content: space-between;
            ">
        """, unsafe_allow_html=True)

        # Label
        st.markdown(f"""
            <div style="font-size: 4.4rem; font-weight: 800; 
                        color: #9ca3af; text-transform: uppercase; 
                        letter-spacing: 1px; margin-bottom: 4px;">
                {label}
            </div>
        """, unsafe_allow_html=True)

        # Big Value
        st.markdown(f"""
            <div style="font-size: 9.5rem; font-weight: 800; 
                        font-family: 'Consolas', 'Courier New', monospace; 
                        line-height: 1.1; margin-bottom: 8px;">
                {value}
            </div>
        """, unsafe_allow_html=True)

        # Delta with colors (Green = good, Red = bad, Gray = STABLE)
        if delta is not None:
            delta_str = str(delta).strip()

        # Delta with rounded background pill
        if delta is not None:
            delta_str = str(delta).strip()
            delta_upper = delta_str.upper()

            if delta_upper == "STABLE":
                bg_color = "rgba(156, 163, 175, 0.15)"
                text_color = "#9ca3af"
                arrow = ""
                display = "STABLE"
            else:
                try:
                    numeric_part = ''.join(c for c in delta_str if c.isdigit() or c in '.-')
                    delta_num = float(numeric_part) if numeric_part else 0

                    if delta_num > 0:
                        bg_color = "rgba(34, 197, 94, 0.15)"   # Light green
                        text_color = "#22c55e"
                        arrow = "↑"
                    elif delta_num < 0:
                        bg_color = "rgba(239, 68, 68, 0.15)"   # Light red
                        text_color = "#ef4444"
                        arrow = "↓"
                    else:
                        bg_color = "rgba(156, 163, 175, 0.15)"
                        text_color = "#9ca3af"
                        arrow = ""
                    display = delta_str
                except:
                    bg_color = "rgba(156, 163, 175, 0.15)"
                    text_color = "#9ca3af"
                    arrow = ""
                    display = delta_str

            st.markdown(f"""
                <div style="                    
                    display: inline-block;
                    background-color: {bg_color};
                    color: {text_color};
                    padding: 10px 34px;
                    border-radius: 9999px;
                    font-size: 6.7rem;
                    font-weight: 700;
                    margin-bottom: 16px;
                ">
                    {arrow} {display}
                </div>
            """, unsafe_allow_html=True)

        # Clean sparkline (color depends on latest value)
        if history:
            last_value = history[-1] if history else 0

            if last_value > 0:
                area_color = "#22c55e"      # Green
                line_color = "#16a34a"
            else:
                area_color = "#ef4444"      # Red
                line_color = "#dc2626"

            df = pd.DataFrame({
                "x": range(len(history)),
                "value": history
            })
            
            chart = (
                alt.Chart(df)
                .mark_area(
                    color=area_color,
                    opacity=0.25,
                    line={"color": line_color, "strokeWidth": 2.5}
                )
                .encode(
                    x=alt.X("x", axis=None),
                    y=alt.Y("value", axis=None),
                )
                .properties(height=chart_height)
                .configure_axis(grid=False)
                .configure_view(stroke=None)
            )
            
            st.altair_chart(chart, width="stretch", theme=None)

        st.markdown("</div>", unsafe_allow_html=True)

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


def show_dashboard_view_one(container, max_columns=4):
    header_html = get_global_header_html()
    container.markdown(header_html, unsafe_allow_html=True)

    dashboard_items = [
        item for item in config.DASHBOARD_ITEMS
        if item.get("dashboard_view", 1) == 1
    ]
    dashboard_items.sort(key=lambda x: x.get("dashboard_position", 99))

    if not dashboard_items:
        st.info("No dashboard items configured.")
        return

    for i in range(0, len(dashboard_items), max_columns):
        row_items = dashboard_items[i:i + max_columns]
        cols = st.columns(len(row_items))
        for idx, item in enumerate(row_items):
            delta_arrow = "auto"
            with cols[idx]:
                tag_key = item.get("tag")
                value = data_store.get(tag_key, "—")
                delta_config = item.get("delta")
                delta_unit = item.get("deltaUnit", "")
                unit = item.get("unit", "")
                if delta_config == "STABLE" or delta_config is None:
                    delta_value = "STABLE"
                    delta_arrow = "off"
                else:                    
                    delta_value = str(data_store.get(delta_config, None)) + " " + delta_unit
                    
                display_value = f"{value} {unit}".strip() if unit else str(value)

                history = []
                if item.get("historical") is True:
                    history = data_store.get_history(tag_key) or []
                    if not history or all(v == 0 for v in history):
                        history = data_store.get_history(delta_config) or []

                # st.metric(
                #     label=item.get("label", tag_key),
                #     value=display_value,
                #     delta=delta_value,
                #     delta_arrow=delta_arrow,
                #     chart_data=history if history else None,
                #     chart_type="area",
                #     border=True,
                # )
                custom_metric(
                    label=item.get("label", tag_key),
                    value=display_value,
                    delta=delta_value,
                    history=history if history else None,
                    height=340,
                    chart_height=160,        # ← Control chart height here
                    border=True
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
