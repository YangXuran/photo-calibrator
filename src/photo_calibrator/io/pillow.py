"""Scoped Pillow access for trusted local photo files."""

from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
from typing import Iterator
import warnings

from PIL import Image


@contextmanager
def open_local_image(path: str | Path) -> Iterator[Image.Image]:
    """Open a user-selected local image with narrowly scoped warning filters.

    Large professional scans commonly exceed Pillow's warning threshold.  The
    warning is hidden only for this local-file operation; Pillow's hard
    ``DecompressionBombError`` limit remains active.  Some camera TIFFs also
    contain oversized Photoshop-resource tag counts that Pillow safely ignores.
    """

    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", category=Image.DecompressionBombWarning)
        warnings.filterwarnings(
            "ignore",
            message=r"Metadata Warning, tag \d+ had too many entries: .*",
            category=UserWarning,
            module=r"PIL\.TiffImagePlugin",
        )
        with Image.open(path) as image:
            yield image


__all__ = ["open_local_image"]
