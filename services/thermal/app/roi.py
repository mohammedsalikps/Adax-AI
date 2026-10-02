"""Region-of-interest statistics on a temperature matrix (degrees Celsius)."""

from __future__ import annotations

import base64
from typing import Literal

import numpy as np
from pydantic import BaseModel, Field, model_validator


class Roi(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    shape: Literal["rect", "ellipse"]
    # Bounding box in matrix pixel coordinates (x to the right, y down).
    x: float
    y: float
    width: float = Field(gt=0)
    height: float = Field(gt=0)


class Pair(BaseModel):
    a: str
    b: str


class RoiStatsRequest(BaseModel):
    width: int = Field(gt=0, le=4096)
    height: int = Field(gt=0, le=4096)
    # float32, little-endian, row-major, base64.
    matrix: str
    rois: list[Roi] = Field(max_length=50)
    pairs: list[Pair] = Field(default_factory=list, max_length=25)

    @model_validator(mode="after")
    def _ids_unique(self) -> RoiStatsRequest:
        ids = [r.id for r in self.rois]
        if len(ids) != len(set(ids)):
            raise ValueError("ROI ids must be unique")
        known = set(ids)
        for p in self.pairs:
            if p.a not in known or p.b not in known or p.a == p.b:
                raise ValueError("pairs must reference two different ROI ids")
        return self


def decode_matrix(b64: str, width: int, height: int) -> np.ndarray:
    raw = base64.b64decode(b64, validate=True)
    if len(raw) != width * height * 4:
        raise ValueError("matrix size does not match width x height")
    return np.frombuffer(raw, dtype="<f4").reshape(height, width)


def encode_matrix(m: np.ndarray) -> str:
    return base64.b64encode(np.ascontiguousarray(m, dtype="<f4").tobytes()).decode("ascii")


def roi_mask(shape: tuple[int, int], roi: Roi) -> np.ndarray:
    """Pixels whose centres fall inside the ROI (rectangle, or ellipse inscribed in the box)."""
    h, w = shape
    yy, xx = np.mgrid[0:h, 0:w]
    cx, cy = xx + 0.5, yy + 0.5
    if roi.shape == "rect":
        return (cx >= roi.x) & (cx <= roi.x + roi.width) & (cy >= roi.y) & (cy <= roi.y + roi.height)
    rx, ry = roi.width / 2, roi.height / 2
    ex, ey = roi.x + rx, roi.y + ry
    return ((cx - ex) / rx) ** 2 + ((cy - ey) / ry) ** 2 <= 1.0


def stats(values: np.ndarray) -> dict:
    v = values[np.isfinite(values)].astype(np.float64)
    if v.size == 0:
        return {"pixelCount": 0, "min": None, "max": None, "mean": None, "std": None}
    return {
        "pixelCount": int(v.size),
        "min": round(float(v.min()), 2),
        "max": round(float(v.max()), 2),
        "mean": round(float(v.mean()), 2),
        "std": round(float(v.std()), 2),
    }


def compute(req: RoiStatsRequest) -> dict:
    m = decode_matrix(req.matrix, req.width, req.height)
    by_id = {r.id: stats(m[roi_mask(m.shape, r)]) for r in req.rois}
    pairs = []
    for p in req.pairs:
        a, b = by_id[p.a], by_id[p.b]
        ok = a["mean"] is not None and b["mean"] is not None
        pairs.append(
            {
                "a": p.a,
                "b": p.b,
                "meanDiff": round(a["mean"] - b["mean"], 2) if ok else None,
                "maxDiff": round(a["max"] - b["max"], 2) if ok else None,
            }
        )
    return {"rois": [{"id": r.id, "stats": by_id[r.id]} for r in req.rois], "pairs": pairs}
