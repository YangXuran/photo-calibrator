"""RAW image decoder module — rawpy-based preview extraction."""

from __future__ import annotations

import tempfile
from pathlib import Path

import cv2
import numpy as np

from photo_calibrator.core.image_model import ImageBuffer

RAW_EXTENSIONS = (".dng", ".cr2", ".cr3", ".nef", ".arw", ".raf", ".rw2", ".orf", ".pef", ".srw")


def is_raw_extension(filename: str) -> bool:
    """Check if the filename has a known RAW camera extension."""
    return filename.lower().endswith(RAW_EXTENSIONS)


def _to_uint8_preview(img: np.ndarray) -> np.ndarray:
    """Convert any dtype to uint8 for preview display."""
    if img.dtype == np.uint8:
        return img
    data = img.astype(np.float32)
    max_value = float(data.max()) if data.size else 0.0
    if np.issubdtype(img.dtype, np.integer):
        dtype_max = float(np.iinfo(img.dtype).max)
        if dtype_max > 0:
            data = data / dtype_max * 255.0
    elif max_value <= 1.0:
        data = data * 255.0
    else:
        data = data / max(max_value, 1.0) * 255.0
    return np.clip(data, 0, 255).astype(np.uint8)


def _postprocess_options(
    *,
    white_balance: str = "camera",
    user_wb: tuple[float, float, float, float] | None = None,
    no_auto_bright: bool = True,
    output_bps: int = 8,
    half_size: bool = False,
) -> dict:
    options: dict = {
        "half_size": half_size,
        "no_auto_bright": no_auto_bright,
        "output_bps": output_bps,
        "use_camera_wb": white_balance == "camera",
        "use_auto_wb": white_balance == "auto",
    }
    if white_balance == "manual" and user_wb is not None:
        options["user_wb"] = user_wb
    return options


def decode_raw_preview(
    raw_bytes: bytes,
    file_name: str,
    *,
    white_balance: str = "camera",
    user_wb: tuple[float, float, float, float] | None = None,
    no_auto_bright: bool = True,
    output_bps: int = 8,
    **_kwargs,
) -> tuple[np.ndarray, str] | None:
    """Decode RAW bytes into BGR preview, preferring embedded JPEG thumbnail.

    Returns (bgr_array, source_label) or None if decode fails.
    Raises ValueError if rawpy is not installed.
    """
    try:
        import rawpy
    except ImportError as exc:
        raise ValueError(
            "RAW support requires optional dependency 'rawpy'. "
            "Install with: pip install photo-calibrator[raw]"
        ) from exc

    suffix = Path(file_name).suffix or ".raw"
    with tempfile.NamedTemporaryFile(suffix=suffix) as tmp:
        tmp.write(raw_bytes)
        tmp.flush()
        with rawpy.imread(tmp.name) as raw_image:
            try:
                thumb = raw_image.extract_thumb()
                if thumb.format == rawpy.ThumbFormat.JPEG:
                    arr = np.frombuffer(thumb.data, dtype=np.uint8)
                    bgr = cv2.imdecode(arr, cv2.IMREAD_UNCHANGED)
                    if bgr is not None:
                        return bgr, "raw-embedded-jpeg"
                if thumb.format == rawpy.ThumbFormat.BITMAP:
                    rgb = np.asarray(thumb.data)
                    bgr = cv2.cvtColor(_to_uint8_preview(rgb), cv2.COLOR_RGB2BGR)
                    return bgr, "raw-embedded-bitmap"
            except Exception:
                pass
            rgb = raw_image.postprocess(
                **_postprocess_options(
                    white_balance=white_balance,
                    user_wb=user_wb,
                    no_auto_bright=no_auto_bright,
                    output_bps=output_bps,
                    half_size=True,
                )
            )
            return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR), "raw-half-postprocess"


def decode_raw_image(
    raw_bytes: bytes,
    file_name: str,
    *,
    white_balance: str = "camera",
    user_wb: tuple[float, float, float, float] | None = None,
    no_auto_bright: bool = True,
    output_bps: int = 16,
    **_kwargs,
) -> ImageBuffer:
    """Decode a RAW file at full resolution for export replay."""

    try:
        import rawpy
    except ImportError as exc:
        raise ValueError(
            "RAW support requires optional dependency 'rawpy'. "
            "Install with: pip install photo-calibrator[raw]"
        ) from exc

    suffix = Path(file_name).suffix or ".raw"
    with tempfile.NamedTemporaryFile(suffix=suffix) as tmp:
        tmp.write(raw_bytes)
        tmp.flush()
        with rawpy.imread(tmp.name) as raw_image:
            rgb = raw_image.postprocess(
                **_postprocess_options(
                    white_balance=white_balance,
                    user_wb=user_wb,
                    no_auto_bright=no_auto_bright,
                    output_bps=output_bps,
                    half_size=False,
                )
            )
    return ImageBuffer(
        data=np.asarray(rgb),
        color_space="sRGB",
        metadata={"reader": "rawpy", "raw_file_name": file_name},
    )
