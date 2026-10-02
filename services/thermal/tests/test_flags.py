import numpy as np
from fastapi.testclient import TestClient

from app.main import app
from app.roi import encode_matrix

client = TestClient(app)


def scene() -> np.ndarray:
    # 40 x 40 at 30 C with a 5 x 5 warm patch (36 C) on the left and a single hot pixel on the right.
    m = np.full((40, 40), 30.0, dtype=np.float32)
    m[10:15, 5:10] = 36.0
    m[30, 30] = 45.0
    return m


def body(m, rois=(), pairs=(), params=None):
    b = {
        "width": m.shape[1],
        "height": m.shape[0],
        "matrix": encode_matrix(m),
        "rois": list(rois),
        "pairs": list(pairs),
    }
    if params:
        b["params"] = params
    return b


def test_finds_a_connected_warm_area_and_ignores_isolated_pixels():
    res = client.post("/flags", json=body(scene()))
    assert res.status_code == 200
    r = res.json()
    assert r["validated"] is False
    assert "Not validated" in r["disclaimer"]
    assert len(r["hotspots"]) == 1
    h = r["hotspots"][0]
    assert (h["x"], h["y"], h["width"], h["height"], h["pixelCount"]) == (5, 10, 5, 5, 25)
    assert h["maxC"] == 36.0


def test_min_pixels_parameter_controls_what_counts_as_a_hotspot():
    r = client.post("/flags", json=body(scene(), params={"hotspot_min_pixels": 1})).json()
    assert [h["maxC"] for h in r["hotspots"]] == [45.0, 36.0]


def test_uniform_image_has_no_hotspots():
    m = np.full((10, 10), 31.0, dtype=np.float32)
    assert client.post("/flags", json=body(m)).json()["hotspots"] == []


def test_asymmetry_is_flagged_only_above_the_threshold():
    m = scene()
    rois = [
        {"id": "l", "shape": "rect", "x": 5, "y": 10, "width": 5, "height": 5},
        {"id": "r", "shape": "rect", "x": 25, "y": 10, "width": 5, "height": 5},
        {"id": "r2", "shape": "rect", "x": 25, "y": 20, "width": 5, "height": 5},
    ]
    pairs = [{"a": "l", "b": "r"}, {"a": "r", "b": "r2"}]
    r = client.post("/flags", json=body(m, rois, pairs)).json()
    assert r["asymmetry"] == [
        {"a": "l", "b": "r", "meanDiffC": 6.0, "flagged": True},
        {"a": "r", "b": "r2", "meanDiffC": 0.0, "flagged": False},
    ]
    r = client.post("/flags", json=body(m, rois, pairs, {"asymmetry_threshold_c": 7})).json()
    assert not r["asymmetry"][0]["flagged"]


def test_invalid_flag_requests_are_rejected():
    m = scene()
    bad = body(
        m, [{"id": "a", "shape": "rect", "x": 0, "y": 0, "width": 2, "height": 2}], [{"a": "a", "b": "zz"}]
    )
    assert client.post("/flags", json=bad).status_code == 422
    wrong_size = body(m)
    wrong_size["width"] = 41
    assert client.post("/flags", json=wrong_size).status_code == 422
