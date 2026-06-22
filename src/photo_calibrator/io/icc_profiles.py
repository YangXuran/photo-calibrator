from __future__ import annotations

from enum import Enum


class ExportProfile(str, Enum):
    """Named export color profiles understood by the writer layer."""

    SRGB = "srgb"
    DISPLAY_P3 = "display-p3"
    ADOBE_RGB = "adobe-rgb"
    PROPHOTO_RGB = "prophoto-rgb"

    @classmethod
    def from_string(cls, value: str) -> "ExportProfile":
        normalized = value.strip().lower().replace("_", "-").replace(" ", "-")
        aliases = {
            "displayp3": cls.DISPLAY_P3,
            "p3": cls.DISPLAY_P3,
            "adobergb": cls.ADOBE_RGB,
            "adobe-rgb-1998": cls.ADOBE_RGB,
            "prophoto": cls.PROPHOTO_RGB,
        }
        if normalized in aliases:
            return aliases[normalized]
        return cls(normalized)
