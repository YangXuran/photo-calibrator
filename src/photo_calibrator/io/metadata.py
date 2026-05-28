"""Image metadata extraction — ICC profiles, EXIF tags."""

from __future__ import annotations

from pathlib import Path
from typing import Any


def extract_icc_profile(path: str | Path) -> bytes | None:
    """Extract embedded ICC color profile from an image file.

    Returns None if no profile is embedded or extraction fails.
    """
    try:
        from PIL import Image

        with Image.open(path) as img:
            icc = img.info.get("icc_profile")
            if icc:
                return bytes(icc)
    except Exception:
        pass
    return None


def extract_exif_basic(path: str | Path) -> dict[str, Any]:
    """Extract basic EXIF tags: Make, Model, DateTime, ISO, etc.

    Returns a dict with at minimum a 'source' key.
    """
    result: dict[str, Any] = {"source": str(path)}
    try:
        from PIL import Image
        from PIL.ExifTags import TAGS

        with Image.open(path) as img:
            exif_data = img._getexif()
            if exif_data:
                for tag_id, value in exif_data.items():
                    tag_name = TAGS.get(tag_id, str(tag_id))
                    if isinstance(value, bytes):
                        value = value.decode("utf-8", errors="replace")
                    result[tag_name] = str(value)
    except Exception:
        pass
    return result
