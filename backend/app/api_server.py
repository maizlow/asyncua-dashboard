import uvicorn
from fastapi import FastAPI

def run_fastapi_server(app: FastAPI = None):
    if app is None:
        app = FastAPI(title="Production Dashboard API")

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        log_level="info"
    )