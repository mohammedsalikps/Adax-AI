"""Generates the PWA icons in apps/web/public/icons from the ADAXAI mark.

Run with the thermal service's Python (it has Pillow):
    services/thermal/.venv/Scripts/python scripts/make-icons.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "apps" / "web" / "public" / "icons"
TEAL = (14, 116, 144, 255)
WHITE = (255, 255, 255, 255)


def mark(size: int, maskable: bool) -> Image.Image:
    img = Image.new("RGBA", (size, size), TEAL if maskable else (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # Maskable icons keep the mark inside the central 80% safe zone.
    pad = int(size * 0.1) if maskable else 0
    inner = size - 2 * pad
    if not maskable:
        d.rounded_rectangle((0, 0, size - 1, size - 1), radius=int(size * 7 / 32), fill=TEAL)
    s = inner / 32

    def pt(x: float, y: float) -> tuple[float, float]:
        return (pad + x * s, pad + y * s)

    d.polygon([pt(9, 22), pt(16, 9), pt(23, 22), pt(19.4, 22), pt(16, 15.6), pt(12.6, 22)], fill=WHITE)
    return img


OUT.mkdir(parents=True, exist_ok=True)
for size in (192, 512):
    mark(size, maskable=False).save(OUT / f"icon-{size}.png")
mark(512, maskable=True).save(OUT / "icon-maskable-512.png")
print(f"icons written to {OUT}")
