from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

from photo_calibrator.core.image_model import ImageBuffer


def save_rgb_image(path: str | Path, img_rgb: np.ndarray, quality: int = 92) -> None:
    """Legacy: save uint8 RGB image via OpenCV."""
    img_bgr = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)
    suffix = Path(path).suffix.lower()
    params: list[int] = []
    if suffix in {".jpg", ".jpeg"}:
        params = [cv2.IMWRITE_JPEG_QUALITY, int(quality)]
    ok = cv2.imwrite(str(path), img_bgr, params)
    if not ok:
        raise OSError(f"Cannot write image: {path}")


def _to_uint8(rgb: np.ndarray) -> np.ndarray:
    """Convert any dtype to uint8 for JPEG export."""
    if rgb.dtype == np.uint8:
        return rgb
    if np.issubdtype(rgb.dtype, np.integer):
        info = np.iinfo(rgb.dtype)
        scaled = rgb.astype(np.float64) / float(info.max) * 255.0
    else:
        scaled = np.clip(rgb.astype(np.float64), 0, None)
        if scaled.max() > 1.0:
            scaled = scaled / scaled.max() * 255.0
        else:
            scaled = scaled * 255.0
    return np.clip(scaled, 0, 255).astype(np.uint8)


def _to_uint16(rgb: np.ndarray) -> np.ndarray:
    """Convert any dtype to uint16 for 16-bit export."""
    if rgb.dtype == np.uint16:
        return rgb
    if np.issubdtype(rgb.dtype, np.integer):
        info = np.iinfo(rgb.dtype)
        scaled = rgb.astype(np.float64) / float(info.max) * 65535.0
    else:
        scaled = np.clip(rgb.astype(np.float64), 0, None)
        if scaled.max() > 1.0:
            scaled = scaled / scaled.max() * 65535.0
        else:
            scaled = scaled * 65535.0
    return np.clip(scaled, 0, 65535).astype(np.uint16)


def export_jpeg(buf: ImageBuffer, path: str | Path, quality: int = 92) -> None:
    """Export ImageBuffer as 8-bit JPEG (always sRGB, 8-bit)."""
    path = Path(path)
    rgb_u8 = _to_uint8(buf.data)
    bgr = cv2.cvtColor(rgb_u8, cv2.COLOR_RGB2BGR)
    ok = cv2.imwrite(str(path), bgr, [cv2.IMWRITE_JPEG_QUALITY, int(quality)])
    if not ok:
        raise OSError(f"Failed to write JPEG: {path}")


def export_png(buf: ImageBuffer, path: str | Path, bit_depth: int = 8) -> None:
    """Export ImageBuffer as PNG (8-bit or 16-bit)."""
    path = Path(path)
    if bit_depth == 16:
        rgb = _to_uint16(buf.data)
        bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
        ok = cv2.imwrite(str(path), bgr, [cv2.IMWRITE_PNG_COMPRESSION, 6])
    else:
        rgb = _to_uint8(buf.data)
        bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
        ok = cv2.imwrite(str(path), bgr)
    if not ok:
        raise OSError(f"Failed to write PNG: {path}")


def export_tiff16(buf: ImageBuffer, path: str | Path) -> None:
    """Export ImageBuffer as 16-bit TIFF using tifffile if available."""
    path = Path(path)
    rgb = _to_uint16(buf.data)
    try:
        import tifffile

        tifffile.imwrite(str(path), rgb)
    except ImportError:
        bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
        ok = cv2.imwrite(str(path), bgr)
        if not ok:
            raise OSError(f"Failed to write 16-bit TIFF: {path}")


def write_image(buf: ImageBuffer, path: str | Path, quality: int = 92) -> None:
    """Write ImageBuffer to disk, auto-selecting format by extension."""
    suffix = Path(path).suffix.lower()
    if suffix in {".jpg", ".jpeg"}:
        export_jpeg(buf, path, quality)
    elif suffix == ".png":
        bit_depth = 16 if buf.dtype in (np.uint16, np.float32) else 8
        export_png(buf, path, bit_depth=bit_depth)
    elif suffix in {".tif", ".tiff"}:
        bit_depth = 16 if buf.dtype in (np.uint16, np.float32) else 8
        if bit_depth == 16:
            export_tiff16(buf, path)
        else:
            rgb = _to_uint8(buf.data)
            bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
            cv2.imwrite(str(path), bgr)
    else:
        raise ValueError(f"Unsupported export format: {suffix}")
