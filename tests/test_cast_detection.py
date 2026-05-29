from __future__ import annotations

import cv2
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

    # float32 is now accepted (Phase 2 upgrade)
    buf32 = ImageBuffer(np.zeros((64, 64, 3), dtype=np.float32))
    assert buf32.dtype == np.float32
    assert buf32.bit_depth == 32


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


# ── Skin detection robustness tests ──────────────────────────────


def test_skin_mask_ycrcb_fallback_no_face() -> None:
    """YCrCb fallback should detect skin-like pixels even without a face."""
    from photo_calibrator.core.cast_detection import detect_skin_mask

    img = np.zeros((120, 120, 3), dtype=np.uint8)
    img[30:90, 30:90] = (180, 140, 120)
    mask = detect_skin_mask(img, min_pixels=100)
    assert mask.sum() > 100
    assert mask[30:90, 30:90].sum() > 0


def test_skin_mask_rejects_non_skin() -> None:
    """Blue pixels should not be detected as skin."""
    from photo_calibrator.core.cast_detection import detect_skin_mask

    img = np.zeros((100, 100, 3), dtype=np.uint8)
    img[:, :] = (50, 60, 200)
    mask = detect_skin_mask(img, min_pixels=100)
    assert mask.sum() == 0


def test_skin_mask_morphology_cleans_noise() -> None:
    """Morphological opening should remove sparse scattered skin-like dots."""
    from photo_calibrator.core.cast_detection import detect_skin_mask

    rng = np.random.default_rng(42)
    img = np.zeros((100, 100, 3), dtype=np.uint8)
    yx = rng.integers(0, 100, size=(50, 2))
    for y, x in yx:
        img[y, x] = (180, 130, 110)
    mask = detect_skin_mask(img, min_pixels=1)
    # Morphological opening removes isolated dots
    assert mask.sum() < 50


def test_skin_mask_respects_min_pixels() -> None:
    """Below min_pixels threshold, return all-False mask."""
    from photo_calibrator.core.cast_detection import detect_skin_mask

    img = np.zeros((80, 80, 3), dtype=np.uint8)
    img[20:22, 20:22] = (180, 140, 120)
    mask = detect_skin_mask(img, min_pixels=100)
    assert mask.sum() == 0


def test_skin_mask_detects_dark_skin_tone() -> None:
    """Dark skin tones should be detected (HSV ranges often miss these)."""
    from photo_calibrator.core.cast_detection import detect_skin_mask

    img = np.zeros((100, 100, 3), dtype=np.uint8)
    img[:, :] = (120, 85, 55)  # dark brown skin
    mask = detect_skin_mask(img, min_pixels=100)
    assert mask.sum() > 5000, f"Dark skin barely detected: {mask.sum()}/10000"


def test_skin_mask_detects_light_skin_tone() -> None:
    """Light East Asian skin tones should be detected."""
    from photo_calibrator.core.cast_detection import detect_skin_mask

    img = np.zeros((100, 100, 3), dtype=np.uint8)
    img[:, :] = (230, 200, 175)  # light skin
    mask = detect_skin_mask(img, min_pixels=100)
    assert mask.sum() > 5000, f"Light skin barely detected: {mask.sum()}/10000"


def test_skin_mask_detects_skin_with_face_present() -> None:
    """When a face is detected, skin should be found in face-adjacent regions."""
    from photo_calibrator.core.cast_detection import detect_skin_mask

    # Synthetic image with a "face oval" in skin-tone surround
    img = np.zeros((200, 200, 3), dtype=np.uint8)
    img[:, :] = (190, 150, 130)  # skin-tone background
    # A lighter oval in center — the face-seeded path should sample from
    # surrounding skin tone and expand to cover the whole image
    cv2.ellipse(img, (100, 100), (50, 60), 0, 0, 360, (210, 180, 160), -1)

    mask = detect_skin_mask(img, min_pixels=200)
    # Should detect skin — either via face seed or YCrCb fallback
    assert mask.sum() > 1000, f"Skin regions not detected: {mask.sum()}/40000"
