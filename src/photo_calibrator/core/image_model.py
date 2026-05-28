from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np


@dataclass(frozen=True)
class ImageBuffer:
    """In-memory RGB image plus minimal metadata for Phase 1.

    Phase 1 keeps the existing uint8 sRGB behavior while making dtype and color
    assumptions explicit. Phase 2 can extend this model for float/RAW/HDR data.
    """

    data: np.ndarray
    color_space: str = "sRGB"
    bit_depth: int = 8
    metadata: dict[str, Any] = field(default_factory=dict)
    orientation: int = 1

    def __post_init__(self) -> None:
        if self.data.ndim != 3 or self.data.shape[2] != 3:
            raise ValueError("ImageBuffer.data must be an HxWx3 RGB array")
        if self.data.dtype != np.uint8:
            raise ValueError("Phase 1 ImageBuffer expects uint8 RGB data")

    @property
    def width(self) -> int:
        return int(self.data.shape[1])

    @property
    def height(self) -> int:
        return int(self.data.shape[0])
