import streamlit as st
from streamlit_autorefresh import st_autorefresh

from models import AlarmDetails
from state_store import general_store, alarm_store

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
            padding-top: 1.5rem;
            padding-bottom: 1.5rem;
        }
    </style>
    """,
    unsafe_allow_html=True
)

# ------------------------------------------------------------------
# 🛠️ 1. DEFINING YOUR TWO SPECIFIC VIEWS
# ------------------------------------------------------------------

def show_alarm_view():
    raw_alarms_dict = alarm_store.get_active_alarms()
    active_alarms = sorted(
        raw_alarms_dict.values(), 
        key=lambda alarm: alarm.timestamp, 
        reverse=True
    )
    
    # 🎨 INJECT FIXED SCREEN-EDGE FLASHING ANIMATION
    st.markdown(
        """
        <style>
            @keyframes screen-pulse {
                0% { border-color: rgba(239, 68, 68, 0.1); box-shadow: inset 0 0 20px rgba(239, 68, 68, 0.1); }
                50% { border-color: rgba(239, 68, 68, 1.0); box-shadow: inset 0 0 60px rgba(239, 68, 68, 0.6); }
                100% { border-color: rgba(239, 68, 68, 0.1); box-shadow: inset 0 0 20px rgba(239, 68, 68, 0.1); }
            }

            .fullscreen-flashing-frame {
                position: fixed;
                top: 0;
                left: 0;
                width: 100vw;
                height: 100vh;
                border: 16px solid transparent; /* Thick border for high-visibility on 4K TVs */
                box-sizing: border-box;
                z-index: 999999; /* Forces it above every single Streamlit element */
                pointer-events: none; /* Allows operators to click "through" the border if needed */
                animation: screen-pulse 1.5s infinite ease-in-out;
            }
        </style>
        """,
        unsafe_allow_html=True
    )

    if active_alarms:
        # 🚨 1. Trigger the standalone full-screen frame
        st.markdown('<div class="fullscreen-flashing-frame"></div>', unsafe_allow_html=True)
        
        # 🚨 2. Render your normal layout cleanly underneath it
        html_content = '<div>'
        
        for alarm in active_alarms:
            bg_color = "#19212e"  
            border_color = "#94a3b8"
            row_html = f'<div style="background-color: {bg_color}; border-left: 12px solid {border_color}; padding: 2rem 3.5rem; margin-bottom: 1.5rem; border-radius: 12px; font-size: 180px; font-weight: 600; color: #ffffff; line-height: 1.3;">{alarm.message}</div>'
            html_content += row_html
            
        html_content += '</div>'
        st.markdown(html_content, unsafe_allow_html=True)
        
    else:
        # Clear layout when no faults are active (Frame div is omitted entirely)
        st.markdown(
            '<h1 style="font-size: 5rem; margin-bottom: 2.5rem;">🚨 Live Active Program Alarms</h1>', 
            unsafe_allow_html=True
        )
        st.markdown(
            '<div style="background-color: #042f1a; color: #4ade80; border: 3px solid #22c55e; '
            'padding: 4rem; border-radius: 20px; font-size: 3.5rem; font-weight: bold; text-align: center;">'
            '✅ No active program alarms reported from the PLC.'
            '</div>',
            unsafe_allow_html=True
        )

def show_dashboard_view_one():
    st.title("📊 Dashboard View One")
    st.write("Live operational metrics and telemetry:")
    
    col1, col2, col3 = st.columns(3)
    col1.metric(label="Target Output", value="1,200 pcs/hr")
    col2.metric(label="Current Rate", value="1,145 pcs/hr", delta="-55 pcs/hr")
    col3.metric(label="OEE Status", value="94.2%", delta="1.5%")
    

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
# 🚀 3. RENDER ACTIVE PAGE
# ------------------------------------------------------------------
current_page_number = st.session_state.ActiveScreenNr
render_page = PAGE_MAP.get(current_page_number, show_alarm_view)

render_page()