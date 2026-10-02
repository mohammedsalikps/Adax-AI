"""ADAXAI thermal service.

Stateless by design: it never connects to the database. The API calls it over
localhost HTTP and stores results itself. Step 1 provides only the health
endpoint; FLIR ingestion and radiometric extraction start in Step 7.
"""

import platform

from fastapi import FastAPI

from app import __version__

app = FastAPI(
    title="ADAXAI Thermal Service",
    version=__version__,
    docs_url="/docs",
    redoc_url=None,
)


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "service": "thermal",
        "version": __version__,
        "python": platform.python_version(),
        # Reported honestly: nothing thermal is implemented yet.
        "capabilities": [],
    }
