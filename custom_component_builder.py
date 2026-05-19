# custom_component_builder.py

import pandas as pd
import altair as alt
import streamlit as st


def clean_numeric(val, default=0.0):
    """Safely convert a value (string or number) to float."""
    if isinstance(val, (int, float)):
        return float(val)
    try:
        cleaned = ''.join(c for c in str(val) if c.isdigit() or c in '.-')
        return float(cleaned) if cleaned else default
    except:
        return default

#Header
def render_metric_label(label: str):
    """Render the metric label."""
    st.markdown(f"""
        <div style="font-size: 4.4rem; font-weight: 800; 
                    color: #9ca3af; text-transform: uppercase; 
                    letter-spacing: 1px; margin-bottom: 4px;">
            {label}
        </div>
    """, unsafe_allow_html=True)


def render_metric_value(value: str):
    """Render the large main metric value."""
    st.markdown(f"""
        <div style="font-size: 9.5rem; font-weight: 800; 
                    font-family: 'Consolas', 'Courier New', monospace; 
                    line-height: 1.1; margin-bottom: 8px;">
            {value}
        </div>
    """, unsafe_allow_html=True)


def render_delta_pill(delta, show_delta: bool = True):
    """Render the colored delta pill with arrow and optional unit."""
    if delta is None:
        return

    delta_str = str(delta).strip()
    delta_upper = delta_str.upper()

    if delta_upper == "STABLE":
        bg_color = "rgba(156, 163, 175, 0.15)"
        text_color = "#22c55e"
        arrow = ""
        display = "STABLE"
    else:
        delta_num = clean_numeric(delta_str)
        if delta_num > 0:
            bg_color = "rgba(34, 197, 94, 0.15)"
            text_color = "#22c55e"
            arrow = "↑"
        elif delta_num < 0:
            bg_color = "rgba(239, 68, 68, 0.15)"
            text_color = "#ef4444"
            arrow = "↓"
        else:
            bg_color = "rgba(156, 163, 175, 0.15)"
            text_color = "#9ca3af"
            arrow = ""
        display = delta_str

    if show_delta:
        st.markdown(f"""
            <div style="display: inline-block; background-color: {bg_color}; color: {text_color};
                        padding: 10px 34px; border-radius: 9999px; font-size: 6.7rem;
                        font-weight: 700; margin-bottom: 16px; margin-top: 16px;">
                {arrow} {display}
            </div>
        """, unsafe_allow_html=True)
    else:
        st.markdown('<div style="height: 225px; visibility: hidden; clear: both;"></div>', unsafe_allow_html=True)

def render_status_pill(status: str, color: str = "#22c55e", span: int = 4, flash: bool = False):
    style = ""
    if flash:
        style = """
            <style>
            @keyframes flash {
                0%, 100% { opacity: 1; transform: scale(1); }
                50% { opacity: 0.35; transform: scale(0.985); }
            }
            </style>
        """

    left, mid, right = st.columns([1, span, 1])
    with mid:
        st.markdown(f"""
            {style}
            <div style="background-color: {color}20; color: {color};
                        padding: 18px 60px; border-radius: 9999px; 
                        font-family: 'Consolas', 'Courier New', monospace;
                        text-transform: uppercase;
                        font-size: 6.4rem; font-weight: 700; text-align: center;
                        margin-bottom: 36px; margin-top: 16px;
                        {'animation: flash 650ms ease-in-out infinite;' if flash else ''}">
                {status} 
            </div>
        """, unsafe_allow_html=True)

def render_area_chart(chart_data, chart_height: int = 160):
    if not chart_data or len(chart_data) < 8:
        render_spacer(chart_height)
        return

    try:
        clean_history = []
        for v in chart_data:
            val = v[1] if isinstance(v, (list, tuple)) else v
            try:
                clean_history.append(float(val))
            except (ValueError, TypeError):
                continue

        if len(clean_history) < 8:
            render_spacer(chart_height)
            return

        # Normalize
        max_abs = max(abs(v) for v in clean_history) or 1
        normalized = [v / max_abs for v in clean_history]

        df = pd.DataFrame({
            "x": range(len(normalized)),
            "value": normalized
        })

        # Extra safety reset
        df = df.reset_index(drop=True)

        base = alt.Chart(df).encode(
            x=alt.X("x", axis=None),
            y=alt.Y("value", axis=None, scale=alt.Scale(domain=[-1.05, 1.05])),
        )

        # Very safe neutral area
        area = base.mark_area(
            color="#9ca3af",
            opacity=0.12
        )

        chart = area.properties(height=chart_height).configure_view(stroke=None)
        st.altair_chart(chart, width="stretch", theme=None)

    except Exception:
        render_spacer(chart_height)

def render_bar_chart(chart_data, chart_height: int = 160):
    if not chart_data or len(chart_data) < 6:
        render_spacer(chart_height)
        return

    try:
        clean_history = []
        for v in chart_data:
            val = v[1] if isinstance(v, (list, tuple)) else v
            try:
                num = float(val)
                if not (num != num):           # filter NaN
                    clean_history.append(num)
            except (ValueError, TypeError):
                continue

        if len(clean_history) < 6:
            render_spacer(chart_height)
            return

        df = pd.DataFrame({
            "x": range(len(clean_history)),
            "value": clean_history
        })

        df = df.dropna(subset=["value"])
        df = df.reset_index(drop=True)        # extra safety

        if len(df) < 6:
            render_spacer(chart_height)
            return

        color = "#22c55e" if clean_history[-1] > 0 else "#ef4444"

        chart = (
            alt.Chart(df)
            .mark_bar(
                color=color,
                opacity=0.85,
                cornerRadiusEnd=4
            )
            .encode(
                x=alt.X("x:O", axis=None),
                y=alt.Y("value:Q", axis=None, scale=alt.Scale(zero=False))
            )
            .properties(height=chart_height)
            .configure_axis(grid=False)
            .configure_view(stroke=None)
        )

        st.altair_chart(chart, width="stretch", theme=None)

    except Exception:
        render_spacer(chart_height)

def render_progress_bar(value, target, chart_height: int = 160):
    """Render a progress bar showing value vs target."""
    actual_num = clean_numeric(value, default=0.0)
    target_num = clean_numeric(target, default=1.0)

    bar_color = "#22c55e" if actual_num >= 0 else "#ef4444"
    max_domain = max(target_num, actual_num, 1.0)

    df = pd.DataFrame({"Actual": [actual_num], "Target": [target_num]})
    # After creating df
    if len(df) == 0:
        render_spacer(chart_height)
        return
    
    bg_chart = alt.Chart(df).mark_bar(
        color="rgba(156, 163, 175, 0.15)",
        cornerRadius=30,
        size=120
    ).encode(
        x=alt.X("Target:Q", axis=None, scale=alt.Scale(domain=[0, max_domain]))
    )

    fg_chart = alt.Chart(df).mark_bar(
        color=bar_color,
        cornerRadius=30,
        size=100
    ).encode(
        x=alt.X("Actual:Q", axis=None)
    )

    chart = alt.layer(bg_chart, fg_chart).properties(height=chart_height).configure_view(stroke=None)
    st.altair_chart(chart, width="stretch", theme=None)

def render_spacer(chart_height: int = 160):
    """Render an invisible spacer to maintain consistent layout height."""
    total_height = chart_height + 16
    st.markdown(f'<div style="height: {total_height}px; visibility: hidden; clear: both;"></div>', unsafe_allow_html=True)


def render_metric_card(
    label: str,
    value: str,
    delta=None,
    show_delta: bool = True,
    chart_type=None,
    chart_data=None,
    chart_height: int = 160,
    border: bool = True,
    delta_unit: str = "",
    target=None
):
    """Main orchestrator for rendering a full metric card."""
    with st.container(border=border):
        render_metric_label(label)
        render_metric_value(value)
        render_delta_pill(delta, show_delta)

        if chart_type == "area":
            render_area_chart(chart_data, chart_height)
        elif chart_type == "bar":
            render_bar_chart(chart_data, chart_height)
        elif chart_type == "progress":
            render_progress_bar(chart_data, target, chart_height)
        else:
            render_spacer(chart_height)
