from __future__ import annotations

import numpy as np
import pytest

from photo_calibrator.core.image_model import ImageBuffer


def test_image_buffer_accepts_float32_rgb() -> None:
    data = np.random.rand(64, 64, 3).astype(np.float32)
    buf = ImageBuffer(data=data)
    assert buf.dtype == np.float32
    assert buf.bit_depth == 32
    assert buf.width == 64
    assert buf.data_range == (0.0, 1.0)


def test_image_buffer_accepts_uint16_rgb() -> None:
    data = np.zeros((32, 32, 3), dtype=np.uint16)
    data[:, :] = 32768
    buf = ImageBuffer(data=data, bit_depth=16)
    assert buf.dtype == np.uint16
    assert buf.data_range == (0, 65535)


def test_image_buffer_rejects_4channel() -> None:
    data = np.zeros((16, 16, 4), dtype=np.uint8)
    with pytest.raises(ValueError, match="HxWx3 RGB"):
        ImageBuffer(data=data)


def test_image_buffer_rejects_2d() -> None:
    with pytest.raises(ValueError):
        ImageBuffer(np.zeros((64, 64), dtype=np.uint8))


def test_image_buffer_detects_hdr_float() -> None:
    # Values > 1.0 = HDR
    data = np.ones((16, 16, 3), dtype=np.float32) * 2.5
    buf = ImageBuffer(data=data)
    assert buf.is_hdr is True
    assert buf.data_range[1] == pytest.approx(2.5)


def test_image_buffer_not_hdr_for_uint8() -> None:
    data = np.zeros((16, 16, 3), dtype=np.uint8)
    buf = ImageBuffer(data=data)
    assert buf.is_hdr is False


def test_image_buffer_not_hdr_for_float_in_01() -> None:
    data = np.random.rand(16, 16, 3).astype(np.float32) * 0.5
    buf = ImageBuffer(data=data)
    assert buf.is_hdr is False


def test_image_buffer_icc_profile_field() -> None:
    data = np.zeros((16, 16, 3), dtype=np.uint8)
    buf = ImageBuffer(data=data, icc_profile=b"fake-icc")
    assert buf.icc_profile == b"fake-icc"


def test_image_buffer_default_icc_profile_is_none() -> None:
    data = np.zeros((16, 16, 3), dtype=np.uint8)
    buf = ImageBuffer(data=data)
    assert buf.icc_profile is None


# ---------------------------------------------------------------------------
# Dtype-aware reader tests
# ---------------------------------------------------------------------------


def test_read_float_tiff_returns_image_buffer(tmp_path) -> None:
    import tifffile

    path = tmp_path / "float32.tif"
    data = np.random.rand(32, 32, 3).astype(np.float32) * 0.5
    tifffile.imwrite(str(path), data)

    from photo_calibrator.io.readers import read_image

    buf = read_image(str(path))
    assert buf.dtype == np.float32
    assert buf.bit_depth == 32
    assert buf.width == 32
    assert buf.height == 32


def test_read_uint16_tiff_returns_image_buffer(tmp_path) -> None:
    import tifffile

    path = tmp_path / "u16.tif"
    data = np.zeros((16, 16, 3), dtype=np.uint16)
    data[:, :] = 32768
    tifffile.imwrite(str(path), data)

    from photo_calibrator.io.readers import read_image

    buf = read_image(str(path))
    assert buf.dtype == np.uint16
    assert buf.data_range == (0, 65535)
    assert buf.bit_depth == 16


def test_read_uint8_jpeg_returns_image_buffer(tmp_path) -> None:
    import imageio.v3 as iio

    path = tmp_path / "test.jpg"
    data = np.zeros((16, 16, 3), dtype=np.uint8)
    data[:, :] = 128
    iio.imwrite(str(path), data)

    from photo_calibrator.io.readers import read_image

    buf = read_image(str(path))
    assert buf.dtype == np.uint8
    assert buf.data_range == (0, 255)
    assert buf.is_hdr is False
