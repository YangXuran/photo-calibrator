from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np


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
