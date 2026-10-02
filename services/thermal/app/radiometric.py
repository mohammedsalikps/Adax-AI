"""FLIR radiometric JPEG extraction (via flyr) and an independent temperature check.

Only radiometric files are accepted: the per-pixel temperatures are computed
from the raw sensor counts and the calibration constants stored in the file.
A plain colour picture of a thermal image has no temperatures and is rejected.
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from importlib.metadata import version

import flyr
import numpy as np

KELVIN = 273.15


class ExtractionError(Exception):
    """A file that cannot be used, with a reason that is safe to show to users."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class Extracted:
    celsius: np.ndarray  # float32, shape (height, width)
    raw: np.ndarray | None
    metadata: dict
    camera: dict
    visible_jpeg: bytes | None


def _is_jpeg(data: bytes) -> bool:
    return data[:3] == b"\xff\xd8\xff"


def flir_segments(data: bytes) -> bytes:
    """Concatenated payload of the JPEG's FLIR APP1 segments (the embedded FFF file)."""
    out = bytearray()
    i = 2
    while i + 4 <= len(data) and data[i] == 0xFF:
        marker = data[i + 1]
        if marker == 0xDA:  # start of scan: no more metadata segments
            break
        length = int.from_bytes(data[i + 2 : i + 4], "big")
        payload = data[i + 4 : i + 2 + length]
        if marker == 0xE1 and payload[:5] == b"FLIR\x00":
            out += payload[8:]
        i += 2 + length
    return bytes(out)


def raw_record_byte_order(fff: bytes) -> str | None:
    """Byte order ("big"/"little") of an FFF directory that lists a RawData record
    (type 1, the sensor counts), or None if there is no usable directory."""
    if fff[:4] not in (b"FFF\x00", b"AFF\x00") or len(fff) < 64:
        return None
    for order in ("big", "little"):
        offset = int.from_bytes(fff[24:28], order)
        count = int.from_bytes(fff[28:32], order)
        if 0 < count <= 4096 and offset + count * 32 <= len(fff):
            for k in range(count):
                entry = fff[offset + k * 32 : offset + (k + 1) * 32]
                if int.from_bytes(entry[0:2], order) == 1 and int.from_bytes(entry[16:20], order) > 0:
                    return order
    return None


UNSUPPORTED = (
    "This FLIR file variant could not be decoded. Compatibility with this camera is not supported yet."
)


def extract(data: bytes) -> Extracted:
    if not _is_jpeg(data):
        raise ExtractionError("invalid_image", "Only FLIR radiometric JPEG files are supported.")
    fff = flir_segments(data)
    if not fff:
        raise ExtractionError(
            "not_radiometric",
            "This image has no FLIR radiometric data. Export the original radiometric JPEG from the camera.",
        )
    # Fast structural checks before the full decoder: without a raw-data record there
    # are no temperatures; and flyr reads the FFF directory as big-endian only, so on
    # little-endian variants (e.g. DJI Zenmuse XT-R) it misreads the record count and
    # loops over millions of phantom records for tens of seconds before failing.
    order = raw_record_byte_order(fff)
    if order != "big":
        raise ExtractionError("unsupported_format", UNSUPPORTED)
    try:
        thermogram = flyr.unpack(io.BytesIO(data))
        celsius = np.asarray(thermogram.celsius, dtype=np.float64)
    except Exception as exc:  # flyr raises various errors on formats it does not parse
        raise ExtractionError("unsupported_format", UNSUPPORTED) from exc
    if celsius.ndim != 2 or celsius.size == 0 or not np.isfinite(celsius).any():
        raise ExtractionError("unsupported_format", "The thermal data in this file could not be read.")

    meta = dict(thermogram.metadata)
    cam = thermogram.camera_metadata
    camera = {
        "make": getattr(cam, "make", None),
        "model": getattr(cam, "model", None),
        "dateTime": str(getattr(cam, "date_time", "") or "") or None,
        # GPS and other location data are deliberately not returned.
    }
    raw = getattr(thermogram, "_FlyrThermogram__thermal", None)

    visible_jpeg = None
    try:
        optical = thermogram.optical_pil
        if optical is not None:
            buf = io.BytesIO()
            # Re-encoding drops EXIF (including any GPS position) from the copy we store.
            optical.convert("RGB").save(buf, format="JPEG", quality=85)
            visible_jpeg = buf.getvalue()
    except Exception:
        visible_jpeg = None

    return Extracted(
        celsius=celsius.astype(np.float32),
        raw=None if raw is None else np.asarray(raw),
        metadata=meta,
        camera=camera,
        visible_jpeg=visible_jpeg,
    )


def parameters(meta: dict) -> dict:
    """Capture settings stored by the camera, in clinical units."""

    def c(k: str) -> float | None:
        v = meta.get(k)
        return None if v is None else round(float(v) - KELVIN, 2)

    def f(k: str, digits: int = 3) -> float | None:
        v = meta.get(k)
        return None if v is None else round(float(v), digits)

    return {
        "emissivity": f("emissivity"),
        "objectDistanceM": f("object_distance", 2),
        "reflectedTempC": c("reflected_apparent_temperature"),
        "atmosphericTempC": c("atmospheric_temperature"),
        "relativeHumidity": f("relative_humidity"),
        "irWindowTempC": c("ir_window_temperature"),
        "irWindowTransmission": f("ir_window_transmission"),
    }


def extractor_info() -> dict:
    return {"name": "flyr", "version": version("flyr")}


def raw_to_celsius(raw: np.ndarray, m: dict) -> np.ndarray:
    """Independent implementation of the published FLIR raw-to-temperature model
    (Planck constants + two-band atmospheric transmission, as documented by
    ExifTool and the Thermimage raw2temp function). Used to cross-check flyr.
    """
    e = float(m["emissivity"])
    od = float(m["object_distance"])
    rtemp = float(m["reflected_apparent_temperature"])
    atemp = float(m["atmospheric_temperature"])
    irwtemp = float(m["ir_window_temperature"])
    irt = float(m["ir_window_transmission"])
    rh = float(m["relative_humidity"])
    r1, r2, b, f, o = (float(m[k]) for k in ("planck_r1", "planck_r2", "planck_b", "planck_f", "planck_o"))
    a1, a2 = float(m["atmospheric_trans_alpha1"]), float(m["atmospheric_trans_alpha2"])
    b1, b2 = float(m["atmospheric_trans_beta1"]), float(m["atmospheric_trans_beta2"])
    x = float(m["atmospheric_trans_x"])

    emiss_wind = 1 - irt
    refl_wind = 0.0
    t_c = atemp - KELVIN
    h2o = rh * np.exp(1.5587 + 0.06939 * t_c - 0.00027816 * t_c**2 + 0.00000068455 * t_c**3)
    half = np.sqrt(od / 2)
    tau = x * np.exp(-half * (a1 + b1 * np.sqrt(h2o))) + (1 - x) * np.exp(-half * (a2 + b2 * np.sqrt(h2o)))
    tau1 = tau2 = tau

    def planck_raw(temp_k: float) -> float:
        return r1 / (r2 * (np.exp(b / temp_k) - f)) - o

    raw_refl = planck_raw(rtemp)
    raw_atm = planck_raw(atemp)
    raw_wind = planck_raw(irwtemp)
    raw_refl1_attn = (1 - e) / e * raw_refl
    raw_atm1_attn = (1 - tau1) / e / tau1 * raw_atm
    raw_wind_attn = emiss_wind / e / tau1 / irt * raw_wind
    raw_refl2_attn = refl_wind / e / tau1 / irt / tau2 * raw_refl
    raw_atm2_attn = (1 - tau2) / e / tau1 / irt / tau2 * raw_atm
    raw_obj = (
        raw.astype(np.float64) / e / tau1 / irt / tau2
        - raw_atm1_attn
        - raw_atm2_attn
        - raw_wind_attn
        - raw_refl1_attn
        - raw_refl2_attn
    )
    kelvin = b / np.log(r1 / (r2 * (raw_obj + o)) + f)
    return kelvin - KELVIN
