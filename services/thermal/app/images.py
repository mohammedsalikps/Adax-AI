"""Clinical photograph validation and preview.

Only plain photographic formats are accepted (JPEG, PNG, WebP). DICOM and
other medical imaging formats are NOT supported and are rejected with a
clear message. The original file is never modified (the API stores it
as uploaded); this module produces a separate preview without metadata
(EXIF, GPS), rotated upright, for display and for any AI description.
"""

from __future__ import annotations

import io
import warnings
from dataclasses import dataclass

from PIL import Image, ImageOps, UnidentifiedImageError

FORMATS = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}
GPS_TAG = 34853


class ImageRejected(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class Inspected:
    format: str
    mime_type: str
    width: int
    height: int
    had_exif: bool
    had_gps: bool
    preview_jpeg: bytes
    preview_width: int
    preview_height: int


def _looks_like_dicom(data: bytes) -> bool:
    return len(data) > 132 and data[128:132] == b"DICM"


def inspect(data: bytes, allowed: set[str], max_pixels: int, preview_max_side: int) -> Inspected:
    if _looks_like_dicom(data):
        raise ImageRejected(
            "unsupported_format", "DICOM files are not supported. Upload a JPEG, PNG or WebP photograph."
        )
    with warnings.catch_warnings():
        # Treat Pillow's decompression-bomb warning as an error.
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        try:
            img = Image.open(io.BytesIO(data))
            fmt = img.format or ""
        except (UnidentifiedImageError, OSError) as e:
            raise ImageRejected("invalid_image", "The file is not an image that can be read.") from e
        except Image.DecompressionBombWarning as e:
            raise ImageRejected("too_large", "The image has too many pixels.") from e
        mime = FORMATS.get(fmt)
        if not mime or mime not in allowed:
            raise ImageRejected(
                "unsupported_format",
                f"{fmt or 'This'} images are not supported. Upload a JPEG, PNG or WebP photograph.",
            )
        width, height = img.size
        if width * height > max_pixels:
            raise ImageRejected("too_large", f"The image has more than {max_pixels:,} pixels.")
        try:
            # Check the whole file decodes (truncated or corrupt files fail here).
            Image.open(io.BytesIO(data)).verify()
            img = Image.open(io.BytesIO(data))
            img.load()
        except Exception as e:  # noqa: BLE001 - Pillow raises many types for corrupt data
            raise ImageRejected("invalid_image", "The image file is damaged or incomplete.") from e
    exif = img.getexif()
    had_exif = len(exif) > 0
    had_gps = GPS_TAG in exif
    preview = ImageOps.exif_transpose(img).convert("RGB")
    preview.thumbnail((preview_max_side, preview_max_side))
    buf = io.BytesIO()
    # A new JPEG with no EXIF/ICC/XMP: metadata (including any location) is dropped.
    preview.save(buf, format="JPEG", quality=85)
    return Inspected(
        format=fmt,
        mime_type=mime,
        width=width,
        height=height,
        had_exif=had_exif,
        had_gps=had_gps,
        preview_jpeg=buf.getvalue(),
        preview_width=preview.width,
        preview_height=preview.height,
    )
