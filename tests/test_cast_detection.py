from __future__ import annotations

import numpy as np
import pytest

from photo_calibrator.core.cast_detection import analyze_image_array, auto_detect_cast, rgb_to_lab_float
from photo_calibrator.core.image_model import ImageBuffer


def solid(rgb: tuple[int, int, int], size: tuple[int, int] = (64, 64)) -> np.ndarray:
    arr = np.zeros((size[0], size[1], 3), dtype=np.uint8)
    arr[:, :] = np.array(rgb, dtype=np.uint8)
    return arr


def test_image_buffer_validates_shape_and_dtype() -> None:
    img = solid((128, 128, 128))
    buffer = ImageBuffer(img)
    assert buffer.width == 64
    assert buffer.height == 64
    assert buffer.color_space == "sRGB"

    with pytest.raises(ValueError):
        ImageBuffer(np.zeros((64, 64), dtype=np.uint8))

    with pytest.raises(ValueError):
        ImageBuffer(np.zeros((64, 64, 3), dtype=np.float32))


def test_neutral_gray_reports_low_cast() -> None:
    report = analyze_image_array(solid((128, 128, 128)))
    assert report.severity == "[OK] Normal"
    assert report.cast_direction == "Neutral"
    assert report.lab.cast_strength < 1.0
    assert report.peak_spread == 0


def test_float_lab_analysis_uses_real_lab_units() -> None:
    lab = rgb_to_lab_float(solid((128, 128, 128)))

    assert 0 <= float(lab[:, :, 0].mean()) <= 100
    assert abs(float(lab[:, :, 1].mean())) < 1.0
    assert abs(float(lab[:, :, 2].mean())) < 1.0


def test_warm_image_detects_red_or_yellow_cast() -> None:
    report = analyze_image_array(solid((170, 128, 96)))
    assert report.lab.cast_strength > 6.0
    assert "Red" in report.cast_direction or "Yellow" in report.cast_direction
    assert report.rgb.r_mean > report.rgb.b_mean


def test_auto_detect_returns_global_and_zones_for_large_image() -> None:
    img = np.zeros((80, 80, 3), dtype=np.uint8)
    img[:25, :] = (50, 55, 70)
    img[25:55, :] = (120, 130, 150)
    img[55:, :] = (220, 225, 240)

    cast = auto_detect_cast(img)
    assert "global" in cast
    assert "shadow" in cast
    assert "midtone" in cast
    assert "highlight" in cast
    assert cast["global"].pixels == 80 * 80


def test_auto_detect_prefers_low_saturation_neutral_region_when_available() -> None:
    img = np.zeros((100, 100, 3), dtype=np.uint8)
    img[:, :] = (170, 30, 30)
    img[25:75, 25:75] = (128, 128, 128)

    cast = auto_detect_cast(img)

    assert "neutral" in cast
    assert cast["neutral"].pixels >= 2000
    assert abs(cast["neutral"].a_mean) < abs(cast["global"].a_mean)
