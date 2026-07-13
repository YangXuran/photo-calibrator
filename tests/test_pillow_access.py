from __future__ import annotations

import warnings

import numpy as np
from PIL import Image
import tifffile

from photo_calibrator.io.pillow import open_local_image


def test_local_photo_open_suppresses_warning_but_keeps_hard_limit(tmp_path, monkeypatch) -> None:
    path = tmp_path / "large-scan.tif"
    tifffile.imwrite(path, np.zeros((16, 16, 3), dtype=np.uint8), photometric="rgb")

    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 200)
    with warnings.catch_warnings(record=True) as captured:
        warnings.simplefilter("always")
        with open_local_image(path) as image:
            assert image.size == (16, 16)
    assert not any(isinstance(item.message, Image.DecompressionBombWarning) for item in captured)

    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 100)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", Image.DecompressionBombWarning)
        try:
            with open_local_image(path):
                pass
        except Image.DecompressionBombError:
            pass
        else:
            raise AssertionError("Pillow hard decompression-bomb limit must remain active")
