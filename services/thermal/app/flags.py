"""Experimental, rule-based thermal flags.

These are simple, transparent measurements against fixed thresholds. They are
NOT validated and NOT diagnostic: they only point a clinician at regions worth
a second look, and exist to support data labelling and future evaluation.
"""

from __future__ import annotations

import cv2
import numpy as np
from pydantic import BaseModel, Field

from app.roi import Pair, Roi, decode_matrix, roi_mask

RULES_VERSION = "rules-v1"


class FlagParams(BaseModel):
    # A pair of regions is flagged when their mean temperatures differ by at least this much.
    asymmetry_threshold_c: float = Field(default=1.0, gt=0, le=10)
    # Hotspot: pixels at least k standard deviations above the image mean ...
    hotspot_k: float = Field(default=2.0, gt=0, le=6)
    # ... forming a connected area of at least this many pixels.
    hotspot_min_pixels: int = Field(default=12, ge=1, le=100000)
    max_hotspots: int = Field(default=10, ge=1, le=50)


class FlagsRequest(BaseModel):
    width: int = Field(gt=0, le=4096)
    height: int = Field(gt=0, le=4096)
    matrix: str
    rois: list[Roi] = Field(default_factory=list, max_length=50)
    pairs: list[Pair] = Field(default_factory=list, max_length=25)
    params: FlagParams = Field(default_factory=FlagParams)


def hotspots(m: np.ndarray, p: FlagParams) -> tuple[list[dict], float, float, float]:
    """Connected warm areas; returns (hotspots, threshold, image mean, image std)."""
    finite = np.isfinite(m)
    vals = m[finite]
    if vals.size == 0:
        raise ValueError("matrix has no finite temperatures")
    mean, std = float(vals.mean()), float(vals.std())
    threshold = mean + p.hotspot_k * std
    # A uniform image has no hotspots (std 0 would flag every pixel).
    mask = (finite & (m >= threshold) & (std > 0)).astype(np.uint8)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    found = []
    for i in range(1, n):
        x, y, w, h, area = (int(v) for v in stats[i])
        if area < p.hotspot_min_pixels:
            continue
        region = m[labels == i]
        found.append(
            {
                "x": x,
                "y": y,
                "width": w,
                "height": h,
                "pixelCount": area,
                "maxC": round(float(region.max()), 2),
                "meanC": round(float(region.mean()), 2),
                "aboveImageMeanC": round(float(region.mean()) - mean, 2),
            }
        )
    found.sort(key=lambda h: h["maxC"], reverse=True)
    return found[: p.max_hotspots], round(threshold, 2), round(mean, 2), round(std, 2)


def evaluate(req: FlagsRequest) -> dict:
    m = decode_matrix(req.matrix, req.width, req.height)
    spots, threshold, mean, std = hotspots(m, req.params)
    known = {r.id for r in req.rois}
    if len(known) != len(req.rois) or any(
        p.a not in known or p.b not in known or p.a == p.b for p in req.pairs
    ):
        raise ValueError("pairs must reference two different, unique ROI ids")
    means = {}
    for r in req.rois:
        v = m[roi_mask(m.shape, r)]
        v = v[np.isfinite(v)]
        means[r.id] = float(v.mean()) if v.size else None
    asym = []
    for pr in req.pairs:
        a, b = means.get(pr.a), means.get(pr.b)
        if a is None or b is None:
            continue
        diff = round(a - b, 2)
        asym.append(
            {
                "a": pr.a,
                "b": pr.b,
                "meanDiffC": diff,
                "flagged": abs(diff) >= req.params.asymmetry_threshold_c,
            }
        )
    return {
        "version": RULES_VERSION,
        "params": req.params.model_dump(),
        "image": {"meanC": mean, "stdC": std, "hotspotThresholdC": threshold},
        "hotspots": spots,
        "asymmetry": asym,
        "validated": False,
        "disclaimer": "Experimental rule-based flags. Not validated. Not a diagnosis.",
    }
