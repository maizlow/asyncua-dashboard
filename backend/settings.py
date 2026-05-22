from pydantic_settings import BaseSettings
from pydantic import Field
from pathlib import Path
from typing import Optional
import os

# Get the project root (go up from backend/settings.py)
BASE_DIR = Path(__file__).resolve().parent.parent

class Settings(BaseSettings):
    # ===================== OPC UA =====================
    opc_endpoint_url: str = Field(..., alias="OPC_ENDPOINT_URL")
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