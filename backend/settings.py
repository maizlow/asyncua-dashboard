from pathlib import Path
from typing import Literal, Optional

from pydantic import Field
from pydantic_settings import BaseSettings

# Get the project root (go up from backend/settings.py)
BASE_DIR = Path(__file__).resolve().parent.parent

class Settings(BaseSettings):
    # ===================== OPC UA =====================
    # Optional: falls back to opc.url in dashboard.yaml (see backend/dashboard_config.py)
    opc_endpoint_url: Optional[str] = Field(default=None, alias="OPC_ENDPOINT_URL")
    # Dashboard layout + PLC tags (YAML). Default: dashboard.yaml in the project root
    dashboard_config: Optional[str] = Field(default=None, alias="DASHBOARD_CONFIG")
    opc_username: Optional[str] = Field(default=None, alias="OPC_USERNAME")
    opc_password: Optional[str] = Field(default=None, alias="OPC_PASSWORD")

    # Certificates
    certs_dir: str = Field(default="certificates", alias="CERTS_DIR")
    client_cert: str = Field(..., alias="CLIENT_CERT")
    client_key: str = Field(..., alias="CLIENT_KEY")

    # ===================== Application =====================
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")
    app_name: str = Field(default="Production Dashboard", alias="APP_NAME")
    refresh_interval_ms: int = Field(default=1000, alias="REFRESH_INTERVAL_MS")
    snapshot_interval_ms: int = Field(default=10000, alias="SNAPSHOT_INTERVAL_MS")

    client_cert_path: Optional[Path] = None
    client_key_path: Optional[Path] = None

    db_path: str = Field(default="data.db", alias="DB_PATH")
    # How long raw metric history (data_points) is kept
    retention_days: int = Field(default=30, alias="RETENTION_DAYS")
    retention_cleanup_interval_s: int = Field(default=3600, alias="RETENTION_CLEANUP_INTERVAL_S")
    # IANA zone name for shift times (e.g. "Europe/Stockholm"). Empty = system local timezone.
    timezone: str = Field(default="", alias="TIMEZONE")

    # ===================== OEE =====================
    # Nominal (ideal) line rate in tiles per minute, used for targets and performance
    nominal_rate_tpm: float = Field(default=140.0, alias="NOMINAL_RATE_TPM")
    # How often OEE details are pushed to the display
    oee_interval_s: float = Field(default=5.0, alias="OEE_INTERVAL_S")
    # How often the 7-day history (screen type: week) is refreshed and pushed; past days are cached
    history_interval_s: float = Field(default=60.0, alias="HISTORY_INTERVAL_S")
    # Shift log: wait this long after a shift boundary (ShiftStart change) before the new shift's
    # parameters (ShiftTarget, OeeTarget, PlannedTime, ShiftTeam) are snapshotted; also the window in
    # which a counter reset is matched to the boundary. See backend/opc/shifts.py
    shift_settle_s: float = Field(default=10.0, alias="SHIFT_SETTLE_S")
    # Highscore screen: stops shorter than this are bridged (the run continues); 0 = every stop ends a run
    highscore_min_stop_s: float = Field(default=0.0, alias="HIGHSCORE_MIN_STOP_S")
    # Layout (docs/CONFIG.md): the published version in SQLite is used. dashboard.yaml is imported at startup
    # the first time and again when the file has changed: "auto" until the first publish from the editor
    # (from then on the layout is changed in the editor), "always" also after that, "off" never again.
    layout_yaml_import: Literal["auto", "always", "off"] = Field(default="auto", alias="LAYOUT_YAML_IMPORT")

    model_config = {
        "env_file": BASE_DIR / ".env",     # ← Force it to look in project root
        "env_file_encoding": "utf-8",
        "extra": "ignore",
    }

    def model_post_init(self, __context) -> None:
        base_path = Path(self.certs_dir)
        if self.client_cert:
            self.client_cert_path = base_path / Path(self.client_cert).name
        if self.client_key:
            self.client_key_path = base_path / Path(self.client_key).name


settings = Settings()