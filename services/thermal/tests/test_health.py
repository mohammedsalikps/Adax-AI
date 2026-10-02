from fastapi.testclient import TestClient

from app import __version__
from app.main import app

client = TestClient(app)


def test_health_reports_ok_and_version():
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["service"] == "thermal"
    assert body["version"] == __version__


def test_health_claims_no_thermal_capabilities_yet():
    # Step 1 must not advertise FLIR/radiometric features that do not exist.
    assert client.get("/health").json()["capabilities"] == []


def test_unknown_route_is_404():
    assert client.get("/does-not-exist").status_code == 404
