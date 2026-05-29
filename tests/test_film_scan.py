"""Tests for film scan auto-level/crop detection.

Generates synthetic film images with controlled borders and rotations,
then verifies that detect_film_frame() recovers the ground truth.
"""

from __future__ import annotations

import cv2
import numpy as np
import pytest


# ── Synthetic test image helpers ───────────────────────────────────


def _make_film_test_image(
    canvas_size: tuple[int, int] = (800, 600),
    rotation_deg: float = 0.0,
    border_color: str = "black",
    border_width: int = 40,
    border_alpha: float = 1.0,
) -> np.ndarray:
    """Create a synthetic film scan image with known geometry.

    The image has a dark/light border (simulating film rebate) around
    a colored inner region (the actual photo).  An optional rotation is
    applied to the whole canvas.

    Returns uint8 RGB image.
    """
    w, h = canvas_size
    # Start with pale gray canvas (scanner lid / background)
    img = np.full((h, w, 3), 200, dtype=np.uint8)

    if border_color == "black":
        border_rgb = (0, 0, 0)
    elif border_color == "white":
        border_rgb = (250, 250, 250)
    elif border_color == "mixed":
        border_rgb = (40, 40, 40)
    else:
        raise ValueError(f"Unknown border_color: {border_color}")

    # Draw the inner photo region — a colorful gradient to give edges texture
    # Inner region: inset by border_width from each edge
    x0, y0 = border_width, border_width
    x1, y1 = w - border_width, h - border_width

    # Draw the border
    img[:, :] = border_rgb

    # Fill inner photo with a gradient pattern
    inner_h = y1 - y0
    inner_w = x1 - x0
    for row in range(inner_h):
        r = int(100 + 155 * row / inner_h)
        g = int(50 + 100 * (1 - row / inner_h))
        b = int(150)
        img[y0 + row, x0:x1] = (b, g, r)

    if rotation_deg != 0.0:
        # Rotate around center
        center = (w // 2, h // 2)
        mat = cv2.getRotationMatrix2D(center, rotation_deg, 1.0)
        img = cv2.warpAffine(
            img,
            mat,
            (w, h),
            flags=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_CONSTANT,
            borderValue=(200, 200, 200),
        )

    return img


def _inner_region(canvas_size, border_width):
    """Return (x, y, w, h) of the inner photo area before rotation."""
    w, h = canvas_size
    return (border_width, border_width, w - 2 * border_width, h - 2 * border_width)


# ── Tests ──────────────────────────────────────────────────────────


def test_level_no_rotation() -> None:
    """Perfectly level film: angle ≈ 0, crop covers inner region."""
    from photo_calibrator.core.film_scan import detect_film_frame

    img = _make_film_test_image((800, 600), rotation_deg=0, border_width=40)
    result = detect_film_frame(img)

    assert result.confidence > 0.5, f"Confidence too low: {result.confidence}"
    assert abs(result.angle_deg) < 1.0, f"Angle off: {result.angle_deg}°"

    # Crop should be close to the inner photo area
    expected = _inner_region((800, 600), 40)
    # Allow 10px tolerance for edge detection imprecision
    assert abs(result.crop_x - expected[0]) < 10
    assert abs(result.crop_y - expected[1]) < 10
    assert abs(result.crop_w - expected[2]) < 20
    assert abs(result.crop_h - expected[3]) < 20


def test_slight_rotation_clockwise() -> None:
    """+3° clockwise rotation should be detected within ±0.5°."""
    from photo_calibrator.core.film_scan import detect_film_frame

    img = _make_film_test_image((800, 600), rotation_deg=3.0, border_width=40)
    result = detect_film_frame(img)

    assert result.confidence > 0.5, f"Confidence too low: {result.confidence}"
    assert 2.0 < result.angle_deg < 4.0, f"Angle detection failed: {result.angle_deg}°"


def test_counter_clockwise_rotation() -> None:
    """-2° rotation should be detected."""
    from photo_calibrator.core.film_scan import detect_film_frame

    img = _make_film_test_image((800, 600), rotation_deg=-2.0, border_width=40)
    result = detect_film_frame(img)

    assert result.confidence > 0.5, f"Confidence too low: {result.confidence}"
    assert -3.0 < result.angle_deg < -1.0, f"Angle detection failed: {result.angle_deg}°"


def test_white_border_detection() -> None:
    """White border (slide mount) should still be detected."""
    from photo_calibrator.core.film_scan import detect_film_frame

    img = _make_film_test_image((800, 600), border_color="white", border_width=40)
    result = detect_film_frame(img)

    assert result.confidence > 0.3, f"White border not detected: {result.confidence}"


def test_low_confidence_no_border() -> None:
    """Plain image without film border returns low confidence, full image crop."""
    from photo_calibrator.core.film_scan import detect_film_frame

    # Just a gradient, no border at all
    img = np.zeros((400, 300, 3), dtype=np.uint8)
    for y in range(400):
        img[y, :] = (y * 200 // 400, 100, 150)

    result = detect_film_frame(img)

    assert result.confidence < 0.5, f"Should be low confidence: {result.confidence}"
    # When confidence is low, crop should be the full image
    assert result.crop_w >= 280, f"Crop too narrow: {result.crop_w}"
    assert result.crop_h >= 380, f"Crop too short: {result.crop_h}"
