"""Advanced image I/O via OpenImageIO — optional backend for EXR, HDR, deep images.

Provides read/write functions using OpenImageIO with graceful fallback to
existing imageio/cv2 readers when OIIO is not installed.

Typical usage:
    from photo_calibrator.io.oiio import oiio_read, oiio_write, oiio_available
    if oiio_available():
        buf = oiio_read("image.exr")
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

_OIIO_AVAILABLE = False
try:
    import OpenImageIO as _oiio

    _OIIO_AVAILABLE = True
except ImportError:
    pass


def oiio_available() -> bool:
    """Check whether OpenImageIO Python bindings are installed."""
    return _OIIO_AVAILABLE


def oiio_version() -> str:
    """Return OIIO version string, or empty if unavailable."""
    if _OIIO_AVAILABLE:
        return str(_oiio.VERSION_STRING)
    return ""


def oiio_read(path: str | Path) -> np.ndarray | None:
    """Read an image file using OpenImageIO.

    Returns RGB float32 array [0, 1] or None if OIIO unavailable or read fails.
    Handles EXR, HDR, TIFF, and any format OIIO supports.
    """
    if not _OIIO_AVAILABLE:
        return None

    path = Path(path)
    source = str(path)
    try:
        inp = _oiio.ImageInput.open(source)
        if inp is None:
            return None
        spec = inp.spec()
        data = inp.read_image()
        inp.close()

        # Convert to RGB if needed
        if data.ndim == 2:
            data = np.stack([data, data, data], axis=2)
        elif data.shape[2] >= 4:
            data = data[:, :, :3]
        elif data.shape[2] == 1:
            data = np.repeat(data, 3, axis=2)

        # Ensure float32 [0, 1] range
        if data.dtype == np.uint8:
            data = data.astype(np.float32) / 255.0
        elif data.dtype == np.uint16:
            data = data.astype(np.float32) / 65535.0
        elif data.dtype != np.float32:
            data = data.astype(np.float32)

        return data
    except Exception:
        return None


def oiio_write(
    data: np.ndarray,
    path: str | Path,
) -> bool:
    """Write an image file using OpenImageIO.

    Returns True on success, False if OIIO unavailable or write fails.
    Supports EXR, HDR, TIFF, PNG, JPEG via OIIO.
    """
    if not _OIIO_AVAILABLE:
        return False

    path = Path(path)
    source = str(path)
    try:
        import OpenImageIO as oiio

        out = oiio.ImageOutput.create(source)
        if out is None:
            return False

        h, w = data.shape[:2]
        channels = data.shape[2] if data.ndim == 3 else 1

        # Map numpy dtype to OIIO type
        if data.dtype == np.float32:
            otype = oiio.FLOAT
        elif data.dtype == np.uint16:
            otype = oiio.UINT16
        elif data.dtype == np.uint8:
            otype = oiio.UINT8
        elif data.dtype == np.float16:
            otype = oiio.HALF
        else:
            otype = oiio.FLOAT

        spec = oiio.ImageSpec(w, h, channels, otype)
        ok = out.open(source, spec)
        if not ok:
            out.close()
            return False

        out.write_image(data)
        out.close()
        return True
    except Exception:
        return False


def oiio_read_exr(path: str | Path) -> np.ndarray | None:
    """Read an OpenEXR file, returning float32 RGB.

    Returns None if OIIO unavailable or file is not valid EXR.
    """
    if not _OIIO_AVAILABLE:
        return None
    result = oiio_read(path)
    return result


def oiio_supports_format(suffix: str) -> bool:
    """Check if OIIO supports a given file extension."""
    fmt_map: dict[str, bool] = {
        ".exr": True,
        ".hdr": True,
        ".rgbe": True,
        ".tif": True,
        ".tiff": True,
        ".png": True,
        ".jpg": True,
        ".jpeg": True,
    }
    return fmt_map.get(suffix.lower(), False)
