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


# ---------------------------------------------------------------------------
# Dtype-aware writer / export tests
# ---------------------------------------------------------------------------


def test_export_jpeg_writes_file(tmp_path) -> None:
    from photo_calibrator.io.writers import export_jpeg

    data = np.zeros((16, 16, 3), dtype=np.uint8)
    data[:, :] = 128
    buf = ImageBuffer(data=data)
    out = tmp_path / "out.jpg"
    export_jpeg(buf, out, quality=90)
    assert out.exists()
    assert out.stat().st_size > 0


def test_export_tiff16_writes_16bit_file(tmp_path) -> None:
    import tifffile

    from photo_calibrator.io.writers import export_tiff16

    data = np.zeros((16, 16, 3), dtype=np.uint16)
    data[:, :] = 32768
    buf = ImageBuffer(data=data)
    out = tmp_path / "out.tif"
    export_tiff16(buf, out)
    assert out.exists()
    reloaded = tifffile.imread(str(out))
    assert reloaded.dtype == np.uint16


def test_export_from_float32_to_tiff16(tmp_path) -> None:
    """Float32 [0,1] should be scaled to uint16 0-65535."""
    import tifffile

    from photo_calibrator.io.writers import export_tiff16

    data = np.random.rand(16, 16, 3).astype(np.float32)
    buf = ImageBuffer(data=data)
    out = tmp_path / "out.tif"
    export_tiff16(buf, out)
    reloaded = tifffile.imread(str(out))
    assert reloaded.dtype == np.uint16
    assert reloaded.max() > 60000


def test_legacy_save_rgb_image_still_works(tmp_path) -> None:
    from photo_calibrator.io import save_rgb_image

    data = np.zeros((16, 16, 3), dtype=np.uint8)
    data[:, :] = 128
    out = tmp_path / "legacy.jpg"
    save_rgb_image(out, data)
    assert out.exists()


# ---------------------------------------------------------------------------
# HDR/EXR detection tests
# ---------------------------------------------------------------------------


def test_hdr_exr_extension_is_detected() -> None:
    from photo_calibrator.io.readers import _is_hdr_extension

    assert _is_hdr_extension("test.exr")
    assert _is_hdr_extension("test.hdr")
    assert _is_hdr_extension("test.rgbe")
    assert not _is_hdr_extension("test.jpg")
    assert not _is_hdr_extension("test.tif")


def test_exr_magic_bytes_detected() -> None:
    from photo_calibrator.io.readers import _is_exr_magic

    assert _is_exr_magic(b"\x76\x2f\x31\x01" + b"\x00" * 16)
    assert not _is_exr_magic(b"\xff\xd8\xff\xe0")  # JPEG magic


def test_hdr_file_raises_clear_error(tmp_path) -> None:
    from photo_calibrator.io.readers import read_image

    # Truncated/invalid EXR: OIIO tries but returns None → ValueError
    path = tmp_path / "test.exr"
    path.write_bytes(b"\x76\x2f\x31\x01" + b"\x00" * 100)
    with pytest.raises(ValueError, match="could not be read"):
        read_image(str(path))


def test_read_exr_via_oiio(tmp_path) -> None:
    """OIIO reads a real EXR file through read_image()."""
    import numpy as np
    from photo_calibrator.io.oiio import oiio_write
    from photo_calibrator.io.readers import read_image

    path = tmp_path / "real.exr"
    data = np.random.rand(16, 16, 3).astype(np.float32)
    oiio_write(data, str(path))

    buf = read_image(str(path))
    assert buf.dtype == np.float32
    assert buf.width == 16
    assert buf.height == 16
    assert buf.metadata["reader"] == "oiio"


# ---------------------------------------------------------------------------
# ICC / EXIF metadata tests
# ---------------------------------------------------------------------------


def test_extract_icc_from_synthetic_jpeg_returns_none(tmp_path) -> None:
    from photo_calibrator.io.metadata import extract_icc_profile

    import imageio.v3 as iio

    path = tmp_path / "test.jpg"
    data = np.zeros((16, 16, 3), dtype=np.uint8)
    data[:, :] = 128
    iio.imwrite(str(path), data)
    icc = extract_icc_profile(str(path))
    assert icc is None


def test_extract_exif_does_not_crash(tmp_path) -> None:
    from photo_calibrator.io.metadata import extract_exif_basic

    import imageio.v3 as iio

    path = tmp_path / "test.jpg"
    data = np.zeros((16, 16, 3), dtype=np.uint8)
    data[:, :] = 128
    iio.imwrite(str(path), data)
    exif = extract_exif_basic(str(path))
    assert isinstance(exif, dict)
    assert "source" in exif


# ---------------------------------------------------------------------------
# Sidecar JSON tests
# ---------------------------------------------------------------------------


def test_sidecar_roundtrip(tmp_path) -> None:
    from photo_calibrator.io.sidecar import read_sidecar_json, write_sidecar_json

    params = {
        "mode": "global",
        "a_shift": -2.5,
        "b_shift": 1.8,
        "strength": 0.8,
    }
    path = tmp_path / "test.calib.json"
    write_sidecar_json(path, params, algorithm_version="0.2.0")
    assert path.exists()

    loaded = read_sidecar_json(path)
    assert loaded["calibration"]["mode"] == "global"
    assert loaded["calibration"]["a_shift"] == -2.5
    assert loaded["algorithm_version"] == "0.2.0"


# ---------------------------------------------------------------------------
# Writer dtype conversion coverage tests
# ---------------------------------------------------------------------------


def test_to_uint8_from_uint16() -> None:
    from photo_calibrator.io.writers import _to_uint8

    data = np.array([[[0, 0, 0], [32768, 32768, 32768], [65535, 65535, 65535]]], dtype=np.uint16)
    result = _to_uint8(data)
    assert result.dtype == np.uint8
    assert result[0, 0, 0] == 0
    assert 120 < result[0, 1, 0] < 132  # 32768/65535*255 ≈ 127.5
    assert result[0, 2, 0] == 255


def test_to_uint8_from_hdr_float() -> None:
    from photo_calibrator.io.writers import _to_uint8

    data = np.ones((4, 4, 3), dtype=np.float32) * 3.0
    result = _to_uint8(data)
    assert result.dtype == np.uint8
    assert result.max() <= 255


def test_to_uint16_from_uint8() -> None:
    from photo_calibrator.io.writers import _to_uint16

    data = np.array([[[0, 0, 0], [128, 128, 128], [255, 255, 255]]], dtype=np.uint8)
    result = _to_uint16(data)
    assert result.dtype == np.uint16
    assert result[0, 0, 0] == 0
    assert result[0, 2, 0] == 65535


def test_to_uint16_from_hdr_float() -> None:
    from photo_calibrator.io.writers import _to_uint16

    data = np.ones((4, 4, 3), dtype=np.float32) * 5.0
    result = _to_uint16(data)
    assert result.dtype == np.uint16
    assert result.max() <= 65535


def test_export_png_16bit_uint16(tmp_path) -> None:
    from photo_calibrator.io.writers import export_png

    data = np.zeros((8, 8, 3), dtype=np.uint16)
    data[:, :] = 32768
    buf = ImageBuffer(data=data)
    out = tmp_path / "out16.png"
    export_png(buf, out, bit_depth=16)
    assert out.exists()
    assert out.stat().st_size > 0


def test_export_png_16bit_float(tmp_path) -> None:
    from photo_calibrator.io.writers import export_png

    data = np.random.rand(8, 8, 3).astype(np.float32) * 0.5
    buf = ImageBuffer(data=data)
    out = tmp_path / "out_float16.png"
    export_png(buf, out, bit_depth=16)
    assert out.exists()


def test_write_image_unsupported_format_raises(tmp_path) -> None:
    from photo_calibrator.io.writers import write_image

    data = np.zeros((4, 4, 3), dtype=np.uint8)
    buf = ImageBuffer(data=data)
    with pytest.raises(ValueError, match="Unsupported export format"):
        write_image(buf, tmp_path / "test.xyz")


def test_write_image_8bit_tiff(tmp_path) -> None:
    from photo_calibrator.io.writers import write_image

    data = np.zeros((8, 8, 3), dtype=np.uint8)
    data[:, :] = 128
    buf = ImageBuffer(data=data)
    out = tmp_path / "test8.tif"
    write_image(buf, out)
    assert out.exists()


def test_write_image_float_png_auto_16bit(tmp_path) -> None:
    from photo_calibrator.io.writers import write_image

    data = np.random.rand(8, 8, 3).astype(np.float32)
    buf = ImageBuffer(data=data)
    out = tmp_path / "auto16.png"
    write_image(buf, out)
    assert out.exists()


# ---------------------------------------------------------------------------
# Reader path coverage tests
# ---------------------------------------------------------------------------


def test_read_image_rgba_converts_to_rgb(tmp_path) -> None:
    """imageio reads RGBA → readers strips alpha channel."""
    import imageio.v3 as iio
    from photo_calibrator.io.readers import read_image

    path = tmp_path / "rgba.png"
    data = np.zeros((16, 16, 4), dtype=np.uint8)
    data[:, :, :3] = 128
    data[:, :, 3] = 255
    iio.imwrite(str(path), data)

    buf = read_image(str(path))
    assert buf.data.shape[2] == 3


def test_read_image_grayscale_converts_to_rgb(tmp_path) -> None:
    """2D grayscale → auto-stacked to RGB."""
    import imageio.v3 as iio
    from photo_calibrator.io.readers import read_image

    path = tmp_path / "gray.png"
    data = np.zeros((16, 16), dtype=np.uint8)
    data[:, :] = 128
    iio.imwrite(str(path), data)

    buf = read_image(str(path))
    assert buf.data.ndim == 3
    assert buf.data.shape[2] == 3


def test_read_image_missing_file_raises() -> None:
    from photo_calibrator.io.readers import read_image

    with pytest.raises(FileNotFoundError):
        read_image("/tmp/__nonexistent_photo_calibrator_test__.tif")


# ---------------------------------------------------------------------------
# RAW decode coverage (rawpy installed)
# ---------------------------------------------------------------------------


def test_is_raw_extension() -> None:
    from photo_calibrator.io.raw import is_raw_extension

    assert is_raw_extension("photo.CR2") is True
    assert is_raw_extension("photo.NEF") is True
    assert is_raw_extension("photo.ARW") is True
    assert is_raw_extension("photo.jpg") is False
    assert is_raw_extension("photo.tiff") is False


def test_decode_raw_postprocess_fallback(tmp_path) -> None:
    """When thumb extraction fails, rawpy postprocess is used."""
    import struct
    from photo_calibrator.io.raw import decode_raw_preview
    import rawpy

    # Use the real ARW file
    raw_bytes = open("DSC08739.ARW", "rb").read()
    bgr, source = decode_raw_preview(raw_bytes, "DSC08739.ARW")
    assert source in {"raw-embedded-jpeg", "raw-embedded-bitmap", "raw-half-postprocess"}
    assert bgr is not None
    assert bgr.size > 0


def test_to_uint8_preview_handles_float_gt_1() -> None:
    from photo_calibrator.io.raw import _to_uint8_preview

    data = np.array([0.0, 2.0, 5.0], dtype=np.float32)
    result = _to_uint8_preview(data.reshape(1, 3, 1))
    assert result.dtype == np.uint8
    assert result[0, 2, 0] == 255  # 5.0/max(5.0)*255 = 255


def test_to_uint8_preview_handles_integer() -> None:
    from photo_calibrator.io.raw import _to_uint8_preview

    data = np.array([0, 32768, 65535], dtype=np.uint16)
    result = _to_uint8_preview(data.reshape(1, 3, 1))
    assert result.dtype == np.uint8
    assert result[0, 0, 0] == 0
    assert result[0, 2, 0] == 255


def test_to_uint8_preview_passthrough_uint8() -> None:
    from photo_calibrator.io.raw import _to_uint8_preview

    data = np.array([50, 100, 200], dtype=np.uint8)
    result = _to_uint8_preview(data.reshape(1, 3, 1))
    assert result.dtype == np.uint8
    assert result[0, 1, 0] == 100


# ---------------------------------------------------------------------------
# Pipeline ops coverage
# ---------------------------------------------------------------------------


def test_rgb_curves_op() -> None:
    from photo_calibrator.pipeline.operations import RgbCurvesOp

    img = np.zeros((16, 16, 3), dtype=np.uint8)
    img[:, :] = (100, 120, 150)
    op = RgbCurvesOp(params={"strength": 0.3})
    result = op.apply(img)
    assert result.shape == img.shape
    assert result.dtype == np.uint8


def test_matrix_op() -> None:
    from photo_calibrator.pipeline.operations import MatrixOp

    img = np.zeros((16, 16, 3), dtype=np.uint8)
    img[:, :] = (100, 120, 150)
    op = MatrixOp(params={"strength": 0.3})
    result = op.apply(img)
    assert result.shape == img.shape
    assert result.dtype == np.uint8


def test_lut3d_op() -> None:
    from photo_calibrator.pipeline.operations import Lut3DOp

    img = np.zeros((16, 16, 3), dtype=np.uint8)
    img[:, :] = (100, 120, 150)
    op = Lut3DOp(params={"strength": 0.3, "lut_size": 9})
    result = op.apply(img)
    assert result.shape == img.shape
    assert result.dtype == np.uint8


# ---------------------------------------------------------------------------
# .cube 3D LUT tests
# ---------------------------------------------------------------------------


def test_cube_lut_identity_is_valid_format(tmp_path) -> None:
    from photo_calibrator.io.lut_export import write_cube_lut

    out = tmp_path / "test.cube"
    write_cube_lut(out, size=17)
    assert out.exists()
    content = out.read_text()
    assert "LUT_3D_SIZE 17" in content
    assert "TITLE" in content
    # Count data lines (17^3 = 4913)
    data_lines = [
        ln for ln in content.split("\n")
        if ln.strip() and not ln.startswith(("#", "TITLE", "LUT_3D_SIZE", "DOMAIN"))
    ]
    assert len(data_lines) == 17**3
