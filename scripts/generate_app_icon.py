#!/usr/bin/env python3
"""Generate ChromaFrame app icon assets."""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "frontend" / "assets"
PUBLIC_DIR = ROOT / "frontend" / "public"


SVG_SOURCE = """<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="128" y1="92" x2="900" y2="940" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#162130"/>
      <stop offset="0.48" stop-color="#0b1016"/>
      <stop offset="1" stop-color="#172230"/>
    </linearGradient>
    <linearGradient id="photo" x1="246" y1="288" x2="778" y2="708" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#f2b26b"/>
      <stop offset="0.45" stop-color="#9876d5"/>
      <stop offset="1" stop-color="#55d4c7"/>
    </linearGradient>
    <linearGradient id="scan" x1="218" y1="224" x2="802" y2="782" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ecf2f8" stop-opacity="0.95"/>
      <stop offset="1" stop-color="#62a7ff" stop-opacity="0.78"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="36" stdDeviation="44" flood-color="#03070c" flood-opacity="0.55"/>
    </filter>
  </defs>
  <rect x="48" y="48" width="928" height="928" rx="220" fill="url(#bg)"/>
  <path d="M160 246c0-72 58-130 130-130h444c72 0 130 58 130 130v532c0 72-58 130-130 130H290c-72 0-130-58-130-130V246z" fill="#080d13" opacity=".52"/>
  <rect x="184" y="208" width="656" height="608" rx="86" fill="#0a0f18" filter="url(#shadow)"/>
  <rect x="232" y="260" width="560" height="460" rx="48" fill="url(#photo)"/>
  <path d="M232 316h560M232 664h560" stroke="#0b1016" stroke-opacity=".24" stroke-width="28"/>
  <path d="M282 256h-62v114M742 256h62v114M282 724h-62V610M742 724h62V610" fill="none" stroke="url(#scan)" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M284 610c98-184 192-166 276-62 56 69 101 79 182-74" fill="none" stroke="#ecf2f8" stroke-width="26" stroke-linecap="round"/>
  <circle cx="316" cy="404" r="34" fill="#f06b6b"/>
  <circle cx="408" cy="404" r="34" fill="#65d99a"/>
  <circle cx="500" cy="404" r="34" fill="#62a7ff"/>
  <circle cx="704" cy="344" r="50" fill="#101720" fill-opacity=".48" stroke="#ecf2f8" stroke-opacity=".88" stroke-width="18"/>
  <path d="M704 292v104M652 344h104" stroke="#ecf2f8" stroke-opacity=".88" stroke-width="18" stroke-linecap="round"/>
</svg>
"""


def _rounded_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size, size), radius=radius, fill=255)
    return mask


def _linear_gradient(size: int, start: tuple[int, int, int], end: tuple[int, int, int]) -> Image.Image:
    yy, xx = np.mgrid[0:size, 0:size]
    t = np.clip((xx * 0.55 + yy * 0.85) / (size * 1.35), 0, 1)[..., None]
    arr = np.array(start, dtype=np.float32) * (1 - t) + np.array(end, dtype=np.float32) * t
    return Image.fromarray(np.uint8(np.clip(arr, 0, 255)), "RGB").convert("RGBA")


def _paste_rounded(base: Image.Image, box: tuple[int, int, int, int], radius: int, fill: Image.Image | tuple[int, int, int, int]) -> None:
    x0, y0, x1, y1 = box
    size = (x1 - x0, y1 - y0)
    if isinstance(fill, Image.Image):
        layer = fill.resize(size, Image.Resampling.LANCZOS).convert("RGBA")
    else:
        layer = Image.new("RGBA", size, fill)
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size[0], size[1]), radius=radius, fill=255)
    base.paste(layer, (x0, y0), mask)


def _draw_scaled_icon(size: int) -> Image.Image:
    scale = size / 1024.0

    def sc(value: float) -> int:
        return int(round(value * scale))

    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    bg = _linear_gradient(size, (22, 33, 48), (23, 34, 48))
    bg_mask = _rounded_mask(size - sc(96), sc(220)).filter(ImageFilter.GaussianBlur(sc(0.6)))
    image.paste(bg.crop((sc(48), sc(48), size - sc(48), size - sc(48))), (sc(48), sc(48)), bg_mask)

    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    shadow_mask = Image.new("L", (sc(656), sc(608)), 0)
    ImageDraw.Draw(shadow_mask).rounded_rectangle((0, 0, sc(656), sc(608)), radius=sc(86), fill=150)
    shadow_mask = shadow_mask.filter(ImageFilter.GaussianBlur(sc(32)))
    shadow.paste(Image.new("RGBA", (sc(656), sc(608)), (0, 0, 0, 140)), (sc(184), sc(242)), shadow_mask)
    image.alpha_composite(shadow)

    _paste_rounded(image, (sc(184), sc(208), sc(840), sc(816)), sc(86), (10, 15, 24, 255))

    photo = _linear_gradient(sc(560), (242, 178, 107), (85, 212, 199))
    violet = Image.new("RGBA", (sc(560), sc(460)), (151, 118, 213, 0))
    vx, vy = np.mgrid[0:sc(460), 0:sc(560)]
    alpha = np.uint8(np.clip(1 - np.abs(vx - sc(230)) / sc(300), 0, 1) * 118)
    violet.putalpha(Image.fromarray(alpha, "L"))
    photo = photo.resize((sc(560), sc(460)), Image.Resampling.LANCZOS)
    photo.alpha_composite(violet)
    _paste_rounded(image, (sc(232), sc(260), sc(792), sc(720)), sc(48), photo)

    draw = ImageDraw.Draw(image)
    line_color = (218, 235, 252, 232)
    accent = (98, 167, 255, 210)
    width = sc(34)
    for points in (
        ((282, 256), (220, 256), (220, 370)),
        ((742, 256), (804, 256), (804, 370)),
        ((282, 724), (220, 724), (220, 610)),
        ((742, 724), (804, 724), (804, 610)),
    ):
        draw.line([(sc(x), sc(y)) for x, y in points], fill=accent, width=width, joint="curve")

    curve = [(284, 610), (356, 492), (442, 485), (560, 548), (642, 616), (742, 474)]
    draw.line([(sc(x), sc(y)) for x, y in curve], fill=line_color, width=sc(26), joint="curve")
    for cx, color in ((316, (240, 107, 107)), (408, (101, 217, 154)), (500, (98, 167, 255))):
        draw.ellipse((sc(cx - 34), sc(370), sc(cx + 34), sc(438)), fill=color + (255,))
    draw.ellipse((sc(654), sc(294), sc(754), sc(394)), outline=line_color, width=sc(18))
    draw.line((sc(704), sc(292), sc(704), sc(396)), fill=line_color, width=sc(18))
    draw.line((sc(652), sc(344), sc(756), sc(344)), fill=line_color, width=sc(18))

    return image


def _write_icns(png_1024: Path, icns_path: Path) -> None:
    iconutil = shutil.which("iconutil")
    if iconutil is None:
        print("iconutil not found; skipping .icns generation")
        return
    with tempfile.TemporaryDirectory(prefix="photo-calibrator-iconset-") as tmp:
        iconset = Path(tmp) / "app-icon.iconset"
        iconset.mkdir()
        source = Image.open(png_1024).convert("RGBA")
        for logical in (16, 32, 128, 256, 512):
            source.resize((logical, logical), Image.Resampling.LANCZOS).save(iconset / f"icon_{logical}x{logical}.png")
            source.resize((logical * 2, logical * 2), Image.Resampling.LANCZOS).save(iconset / f"icon_{logical}x{logical}@2x.png")
        subprocess.run([iconutil, "-c", "icns", str(iconset), "-o", str(icns_path)], check=True)


def main() -> None:
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    svg_path = ASSET_DIR / "app-icon.svg"
    public_svg_path = PUBLIC_DIR / "app-icon.svg"
    png_path = ASSET_DIR / "app-icon.png"
    icns_path = ASSET_DIR / "app-icon.icns"

    svg_path.write_text(SVG_SOURCE, encoding="utf-8")
    public_svg_path.write_text(SVG_SOURCE, encoding="utf-8")
    _draw_scaled_icon(1024).save(png_path)
    _write_icns(png_path, icns_path)
    print(f"wrote {svg_path}")
    print(f"wrote {public_svg_path}")
    print(f"wrote {png_path}")
    if icns_path.exists():
        print(f"wrote {icns_path}")


if __name__ == "__main__":
    main()
