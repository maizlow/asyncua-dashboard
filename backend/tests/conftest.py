import os
import tempfile
from pathlib import Path

# Settings are required at import time; tests never connect to a PLC.
_tmp = Path(tempfile.mkdtemp(prefix="aud-tests-"))
os.environ.setdefault("OPC_ENDPOINT_URL", "opc.tcp://127.0.0.1:4840")
os.environ.setdefault("CLIENT_CERT", "dummy-cert.pem")
os.environ.setdefault("CLIENT_KEY", "dummy-key.pem")
os.environ["DB_PATH"] = str(_tmp / "default.db")

import pytest  # noqa: E402

from backend.opc.database import Database  # noqa: E402


@pytest.fixture
def db(tmp_path):
    database = Database(str(tmp_path / "test.db"))
    yield database
    database.close()
