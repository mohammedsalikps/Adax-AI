"""Clinical photograph validation, on images generated here (no real patient images)."""

import base64
import io

from fastapi.testclient import TestClient
from PIL import Image

from app.main import app

client = TestClient(app)


def make(fmt: str, size=(64, 48), exif: Image.Exif | None = None) -> bytes:
    buf = io.BytesIO()
    img = Image.new("RGB", size, (200, 120, 90))
    kwargs = {"exif": exif} if exif is not None else {}
    img.save(buf, format=fmt, **kwargs)
    return buf.getvalue()


def post(data: bytes, name="photo.jpg", **form):
    fields = {k: str(v) for k, v in form.items()}
    return client.post(
        "/image/inspect", files={"file": (name, data, "application/octet-stream")}, data=fields
    )


def test_accepts_jpeg_png_webp_and_returns_a_preview():
    for fmt, mime in (("JPEG", "image/jpeg"), ("PNG", "image/png"), ("WEBP", "image/webp")):
        res = post(make(fmt))
        assert res.status_code == 200, fmt
        body = res.json()
        assert body["mimeType"] == mime
        assert (body["width"], body["height"]) == (64, 48)
        preview = Image.open(io.BytesIO(base64.b64decode(body["preview"])))
        assert preview.format == "JPEG"


def test_preview_drops_metadata_including_location_and_is_upright():
    exif = Image.Exif()
    exif[0x0112] = 6  # orientation: rotate 90 degrees
    exif[0x8825] = {1: "N", 2: (12.0, 58.0, 0.0)}  # GPS IFD
    res = post(make("JPEG", size=(80, 40), exif=exif))
    body = res.json()
    assert body["hadExif"] is True
    assert body["hadGps"] is True
    preview = Image.open(io.BytesIO(base64.b64decode(body["preview"])))
    assert len(preview.getexif()) == 0
    assert (preview.width, preview.height) == (40, 80)


def test_preview_is_limited_in_size():
    body = post(make("PNG", size=(3000, 1000)), preview_max_side=500).json()
    assert (body["previewWidth"], body["previewHeight"]) == (500, 167)


def test_rejects_unsupported_formats_dicom_corrupt_and_oversized_images():
    gif = io.BytesIO()
    Image.new("RGB", (10, 10)).save(gif, format="GIF")
    r = post(gif.getvalue())
    assert r.status_code == 422 and r.json()["detail"]["error"] == "unsupported_format"
    dicom = b"\0" * 128 + b"DICM" + b"\0" * 64
    r = post(dicom)
    assert r.status_code == 422 and "DICOM" in r.json()["detail"]["message"]
    assert post(b"not an image").json()["detail"]["error"] == "invalid_image"
    assert post(make("JPEG")[:200]).json()["detail"]["error"] == "invalid_image"
    r = post(make("PNG", size=(200, 200)), max_pixels=10_000)
    assert r.status_code == 422 and r.json()["detail"]["error"] == "too_large"
    # A format can be switched off by the caller's allow-list.
    assert post(make("WEBP"), allowed="image/jpeg").json()["detail"]["error"] == "unsupported_format"
