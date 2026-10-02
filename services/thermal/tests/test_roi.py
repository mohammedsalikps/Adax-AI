import numpy as np
from fastapi.testclient import TestClient

from app.main import app
from app.roi import Roi, encode_matrix, roi_mask

client = TestClient(app)


def matrix() -> np.ndarray:
    # 10 x 10: left half 30.0 C, right half 34.0 C, one hot pixel 40.0 at (row 2, col 7).
    m = np.full((10, 10), 30.0, dtype=np.float32)
    m[:, 5:] = 34.0
    m[2, 7] = 40.0
    return m


def body(rois, pairs=()):
    m = matrix()
    return {"width": 10, "height": 10, "matrix": encode_matrix(m), "rois": rois, "pairs": list(pairs)}


def test_rectangle_stats_are_exact():
    res = client.post(
        "/roi-stats", json=body([{"id": "L", "shape": "rect", "x": 0, "y": 0, "width": 5, "height": 10}])
    )
    assert res.status_code == 200
    assert res.json()["rois"][0]["stats"] == {
        "pixelCount": 50,
        "min": 30.0,
        "max": 30.0,
        "mean": 30.0,
        "std": 0.0,
    }


def test_right_half_includes_the_hot_pixel():
    res = client.post(
        "/roi-stats", json=body([{"id": "R", "shape": "rect", "x": 5, "y": 0, "width": 5, "height": 10}])
    )
    s = res.json()["rois"][0]["stats"]
    assert s["pixelCount"] == 50
    assert s["max"] == 40.0
    assert s["mean"] == round((49 * 34 + 40) / 50, 2)


def test_paired_regions_report_differences():
    rois = [
        {"id": "L", "shape": "rect", "x": 0, "y": 0, "width": 5, "height": 10},
        {"id": "R", "shape": "rect", "x": 5, "y": 0, "width": 5, "height": 10},
    ]
    res = client.post("/roi-stats", json=body(rois, [{"a": "R", "b": "L"}]))
    pair = res.json()["pairs"][0]
    assert pair == {"a": "R", "b": "L", "meanDiff": round((49 * 34 + 40) / 50 - 30, 2), "maxDiff": 10.0}


def test_ellipse_uses_pixel_centres_inside_the_inscribed_ellipse():
    mask = roi_mask((10, 10), Roi(id="e", shape="ellipse", x=0, y=0, width=10, height=10))
    # A circle of radius 5 over a 10x10 grid covers 80 pixel centres.
    assert int(mask.sum()) == 80
    assert not mask[0, 0] and mask[5, 5]


def test_invalid_requests_are_rejected():
    bad_size = body([{"id": "a", "shape": "rect", "x": 0, "y": 0, "width": 1, "height": 1}])
    bad_size["width"] = 11
    assert client.post("/roi-stats", json=bad_size).status_code == 422
    dup = body([{"id": "a", "shape": "rect", "x": 0, "y": 0, "width": 1, "height": 1}] * 2)
    assert client.post("/roi-stats", json=dup).status_code == 422
    bad_pair = body(
        [{"id": "a", "shape": "rect", "x": 0, "y": 0, "width": 1, "height": 1}], [{"a": "a", "b": "zz"}]
    )
    assert client.post("/roi-stats", json=bad_pair).status_code == 422
