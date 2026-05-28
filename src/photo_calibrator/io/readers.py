from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np


def load_rgb_image(path: str | Path) -> np.ndarray:
    """Legacy: load uint8 RGB image via OpenCV."""
    img_bgr = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if img_bgr is None:
        raise FileNotFoundError(f"Cannot read image: {path}")
    return cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
