from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np


def _dtype_to_bit_depth(dtype: np.dtype) -> int:
    if dtype == np.uint8:
        return 8
    if dtype == np.uint16:
        return 16
    if dtype == np.float32:
        return 32
    if dtype == np.float16:
        return 16
    return int(dtype.itemsize * 8)


def _compute_data_range(data: np.ndarray) -> tuple[float, float]:
    """Compute actual data range from array values."""
    if np.issubdtype(data.dtype, np.integer):
        info = np.iinfo(data.dtype)
        return (float(info.min), float(info.max))
    # float: detect actual range from data
    actual_min = float(data.min()) if data.size else 0.0
    actual_max = float(data.max()) if data.size else 0.0
    # If data is within [0, 1], treat as normalized
    if 0.0 <= actual_min and actual_max <= 1.0:
        return (0.0, 1.0)
    return (actual_min, actual_max)


@dataclass(frozen=True)
class ImageBuffer:
    """Dtype-aware RGB image buffer with color metadata.

    Supports uint8, uint16, float32, float16 RGB data.
    HDR (float with values > 1.0) is indicated by ``is_hdr``.
    """

    data: np.ndarray
    color_space: str = "sRGB"
    bit_depth: int | None = None
    data_range: tuple[float, float] | None = None
    icc_profile: bytes | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    orientation: int = 1

    def __post_init__(self) -> None:
        if self.data.ndim != 3 or self.data.shape[2] != 3:
            raise ValueError("ImageBuffer.data must be an HxWx3 RGB array")
        if self.bit_depth is None:
            object.__setattr__(self, "bit_depth", _dtype_to_bit_depth(self.data.dtype))
        if self.data_range is None:
            object.__setattr__(self, "data_range", _compute_data_range(self.data))

    @property
    def dtype(self) -> np.dtype:
        return self.data.dtype

    @property
    def width(self) -> int:
        return int(self.data.shape[1])

    @property
    def height(self) -> int:
        return int(self.data.shape[0])

    @property
    def is_hdr(self) -> bool:
        """True if float data contains values beyond [0, 1] (HDR/EXR)."""
        if not np.issubdtype(self.data.dtype, np.floating):
            return False
        rng = self.data_range
        if rng is None:
            return False
        return bool(rng[1] > 1.0 or float(self.data.min()) < 0.0)

    @property
    def is_integer(self) -> bool:
        return np.issubdtype(self.data.dtype, np.integer)
