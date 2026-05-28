"""Color management via OpenColorIO — optional backend for scene-linear transforms.

Provides sRGB <-> scene-linear conversion with graceful fallback to NumPy
when PyOpenColorIO is not installed.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

_OCIO_AVAILABLE = False
try:
    import PyOpenColorIO as _ocio

    _OCIO_AVAILABLE = True
except ImportError:
    pass


def ocio_available() -> bool:
    """Check whether OpenColorIO Python bindings are installed."""
    return _OCIO_AVAILABLE


def _numexpr_srgb_to_linear(rgb_u8: np.ndarray) -> np.ndarray:
    """sRGB uint8 → scene-linear float32 using NumPy (fallback)."""
    src = rgb_u8.astype(np.float32) / 255.0
    linear = np.where(
        src <= 0.04045,
        src / 12.92,
        np.power((src + 0.055) / 1.055, 2.4),
    )
    return linear.astype(np.float32)


def _numexpr_linear_to_srgb(linear_rgb: np.ndarray) -> np.ndarray:
    """Scene-linear float32 → sRGB uint8 using NumPy (fallback)."""
    clipped = np.clip(linear_rgb, 0.0, 1.0)
    srgb = np.where(
        clipped <= 0.0031308,
        clipped * 12.92,
        1.055 * np.power(clipped, 1.0 / 2.4) - 0.055,
    )
    return np.clip(np.rint(srgb * 255.0), 0, 255).astype(np.uint8)


def srgb_to_linear(rgb_u8: np.ndarray) -> np.ndarray:
    """Convert sRGB uint8 → scene-linear float32 [0, 1].

    Uses OCIO CPU processor when available, NumPy fallback otherwise.
    """
    if not _OCIO_AVAILABLE:
        return _numexpr_srgb_to_linear(rgb_u8)

    try:
        import PyOpenColorIO as ocio

        config = ocio.GetCurrentConfig()
        proc = config.getProcessor("sRGB - Display", "scene_linear")
        cpu = ocio.CPUProcessor(proc)

        src = rgb_u8.astype(np.float32) / 255.0
        h, w, c = src.shape
        flat = src.reshape(-1, c)
        result = np.zeros_like(flat)
        cpu.applyRGB(flat, result)
        return np.clip(result.reshape(h, w, c), 0.0, None).astype(np.float32)
    except Exception:
        return _numexpr_srgb_to_linear(rgb_u8)


def linear_to_srgb(linear_rgb: np.ndarray) -> np.ndarray:
    """Convert scene-linear float32 → sRGB uint8.

    Uses OCIO CPU processor when available, NumPy fallback otherwise.
    """
    if not _OCIO_AVAILABLE:
        return _numexpr_linear_to_srgb(linear_rgb)

    try:
        import PyOpenColorIO as ocio

        config = ocio.GetCurrentConfig()
        proc = config.getProcessor("scene_linear", "sRGB - Display")
        cpu = ocio.CPUProcessor(proc)

        h, w, c = linear_rgb.shape
        flat = linear_rgb.astype(np.float32).reshape(-1, c)
        result = np.zeros_like(flat)
        cpu.applyRGB(flat, result)
        out = np.clip(result.reshape(h, w, c), 0.0, 1.0)
        return np.clip(np.rint(out * 255.0), 0, 255).astype(np.uint8)
    except Exception:
        return _numexpr_linear_to_srgb(linear_rgb)


class ColorSpaceManager:
    """High-level color management for the calibration pipeline.

    Wraps OCIO when available, falls back to sRGB NumPy paths otherwise.
    Currently focused on sRGB <-> scene-linear as the primary workflow.
    """

    def __init__(self, config_path: str | Path | None = None) -> None:
        self._config_path = config_path
        self._available = _OCIO_AVAILABLE

    @property
    def available(self) -> bool:
        return self._available

    def to_linear(self, rgb_u8: np.ndarray) -> np.ndarray:
        return srgb_to_linear(rgb_u8)

    def to_display(self, linear_rgb: np.ndarray) -> np.ndarray:
        return linear_to_srgb(linear_rgb)
