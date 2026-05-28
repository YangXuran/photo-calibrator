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
