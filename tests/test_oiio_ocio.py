"""Tests for io/ocio.py and io/oiio.py — OpenColorIO and OpenImageIO integration."""

from __future__ import annotations

import numpy as np
import pytest

from photo_calibrator.io.ocio import (
    ColorSpaceManager,
    _numexpr_linear_to_srgb,
    _numexpr_srgb_to_linear,
    linear_to_srgb,
    ocio_available,
    srgb_to_linear,
)
from photo_calibrator.io.oiio import (
    oiio_available,
    oiio_read,
    oiio_read_exr,
    oiio_supports_format,
    oiio_version,
    oiio_write,
)


# ---------------------------------------------------------------------------
# OCIO tests
# ---------------------------------------------------------------------------


def test_ocio_available_detected() -> None:
    """OCIO is installed on this system — should report available."""
    assert ocio_available() is True


def test_srgb_to_linear_shape_and_range() -> None:
    img = np.random.randint(0, 256, (16, 16, 3), dtype=np.uint8)
    linear = srgb_to_linear(img)
    assert linear.shape == (16, 16, 3)
    assert linear.dtype == np.float32
    assert linear.min() >= 0.0
    assert linear.max() <= 1.0


def test_linear_to_srgb_shape_and_dtype() -> None:
    linear = np.random.rand(16, 16, 3).astype(np.float32) * 0.8
    srgb = linear_to_srgb(linear)
    assert srgb.shape == (16, 16, 3)
    assert srgb.dtype == np.uint8
    assert srgb.min() >= 0
    assert srgb.max() <= 255


def test_srgb_linear_roundtrip() -> None:
    """sRGB → linear → sRGB should be lossless (plus float rounding)."""
    img = np.random.randint(0, 256, (32, 32, 3), dtype=np.uint8)
    linear = srgb_to_linear(img)
    back = linear_to_srgb(linear)
    max_diff = np.max(np.abs(img.astype(int) - back.astype(int)))
    assert max_diff <= 1


def test_numexpr_fallback_matches() -> None:
    """The NumPy fallback should be internally consistent."""
    img = np.array([[[0, 0, 0]], [[128, 128, 128]], [[255, 255, 255]]], dtype=np.uint8)
    linear = _numexpr_srgb_to_linear(img)
    back = _numexpr_linear_to_srgb(linear)
    max_diff = np.max(np.abs(img.astype(int) - back.astype(int)))
    assert max_diff <= 1


def test_color_space_manager_to_linear() -> None:
    mgr = ColorSpaceManager()
    assert mgr.available is True
    img = np.full((8, 8, 3), 128, dtype=np.uint8)
    linear = mgr.to_linear(img)
    assert linear.dtype == np.float32
    assert 0.1 < linear.mean() < 0.3  # 128/255 ≈ 0.5 in sRGB, ~0.22 in linear


def test_color_space_manager_to_display() -> None:
    mgr = ColorSpaceManager()
    linear = np.full((8, 8, 3), 0.5, dtype=np.float32)
    srgb = mgr.to_display(linear)
    assert srgb.dtype == np.uint8
    assert srgb.min() >= 0
    assert srgb.max() <= 255


# ---------------------------------------------------------------------------
# OIIO tests
# ---------------------------------------------------------------------------


def test_oiio_available_detected() -> None:
    assert oiio_available() is True


def test_oiio_version_not_empty() -> None:
    assert oiio_version() != ""


def test_oiio_supports_format() -> None:
    assert oiio_supports_format(".exr") is True
    assert oiio_supports_format(".hdr") is True
    assert oiio_supports_format(".tif") is True
    assert oiio_supports_format(".jpg") is True
    assert oiio_supports_format(".xyz") is False


def test_oiio_write_read_exr(tmp_path) -> None:
    out_path = tmp_path / "test.exr"
    data = np.random.rand(16, 16, 3).astype(np.float32)
    ok = oiio_write(data, str(out_path))
    assert ok is True
    assert out_path.exists()

    read = oiio_read_exr(str(out_path))
    assert read is not None
    assert read.shape == (16, 16, 3)
    assert read.dtype == np.float32
    # Values should be close (not exact due to half-float encoding in EXR)
    assert np.allclose(read, data, atol=0.01)


def test_oiio_write_read_hdr(tmp_path) -> None:
    out_path = tmp_path / "test.hdr"
    data = np.random.rand(8, 8, 3).astype(np.float32) * 2.0  # HDR values
    ok = oiio_write(data, str(out_path))
    assert ok is True
    assert out_path.exists()

    read = oiio_read(str(out_path))
    assert read is not None
    assert read.dtype == np.float32


def test_oiio_write_read_uint8_png(tmp_path) -> None:
    out_path = tmp_path / "test_oiio.png"
    data = np.zeros((16, 16, 3), dtype=np.uint8)
    data[:, :] = 128
    ok = oiio_write(data, str(out_path))
    assert ok is True

    read = oiio_read(str(out_path))
    assert read is not None
    assert read.dtype == np.float32  # oiio_read normalizes to float
    assert np.allclose(read, 128.0 / 255.0, atol=0.01)


def test_oiio_read_nonexistent_returns_none() -> None:
    result = oiio_read("/tmp/nonexistent_oiio_test_xyz.exr")
    assert result is None
