from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

from photo_calibrator.core.image_model import ImageBuffer


def load_rgb_image(path: str | Path) -> np.ndarray:
    """Legacy: load uint8 RGB image via OpenCV."""
    img_bgr = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if img_bgr is None:
        raise FileNotFoundError(f"Cannot read image: {path}")
    return cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)


def _to_rgb(bgr_or_gray: np.ndarray) -> np.ndarray:
    """Normalize BGR/Gray/BGRA to uint8 RGB."""
    if bgr_or_gray.ndim == 2:
        bgr_or_gray = cv2.cvtColor(bgr_or_gray, cv2.COLOR_GRAY2BGR)
    if bgr_or_gray.shape[2] == 4:
        bgr_or_gray = cv2.cvtColor(bgr_or_gray, cv2.COLOR_BGRA2BGR)
    if bgr_or_gray.shape[2] == 1:
        bgr_or_gray = cv2.cvtColor(bgr_or_gray, cv2.COLOR_GRAY2BGR)
    return cv2.cvtColor(bgr_or_gray, cv2.COLOR_BGR2RGB)


def read_image(path: str | Path) -> ImageBuffer:
    """Read any supported image format into a dtype-aware ImageBuffer.

    Uses imageio for float/16-bit, falls back to OpenCV for uint8 JPEG/PNG.
    """
    path = Path(path)
    source = str(path)

    # Try imageio first (handles float TIFF, uint16 PNG, etc.)
    try:
        import imageio.v3 as iio

        data = iio.imread(source)
        if data.ndim == 3 and data.shape[2] == 3:
            return ImageBuffer(
                data=data,
                metadata={"source": source, "reader": "imageio"},
            )
        # If it's RGBA or grayscale, convert to RGB
        if data.ndim == 3 and data.shape[2] == 4:
            data = data[:, :, :3]
            return ImageBuffer(
                data=data,
                metadata={"source": source, "reader": "imageio"},
            )
        if data.ndim == 2:
            data = np.stack([data, data, data], axis=2)
            return ImageBuffer(
                data=data,
                metadata={"source": source, "reader": "imageio"},
            )
    except Exception:
        pass

    # Fallback: OpenCV for standard uint8 images
    bgr = cv2.imread(source, cv2.IMREAD_UNCHANGED)
    if bgr is None:
        raise FileNotFoundError(f"Cannot read image: {path}")

    rgb = _to_rgb(bgr)
    return ImageBuffer(
        data=rgb,
        metadata={"source": source, "reader": "opencv"},
    )
