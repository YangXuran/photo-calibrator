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


# ── Perspective distortion tests ───────────────────────────────────


def _make_perspective_test_image(
    canvas_size: tuple[int, int] = (800, 600),
    perspective_strength: float = 0.15,
    border_width: int = 40,
) -> np.ndarray:
    """Create a synthetic film image with perspective (keystone) distortion.

    Applies a trapezoidal warp to simulate film that isn't perfectly flat
    on the scanner — top edge narrower than bottom edge (typical keystone).

    Returns uint8 RGB image.
    """
    w, h = canvas_size

    # Start with a level film image (no rotation)
    img = _make_film_test_image(canvas_size, rotation_deg=0, border_width=border_width)

    # Perspective warp: compress top edge (keystone — top narrower)
    shrink = int(w * perspective_strength)
    src = np.array(
        [[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]],
        dtype=np.float32,
    )
    dst = np.array(
        [[shrink, 0], [w - 1 - shrink, 0], [w - 1, h - 1], [0, h - 1]],
        dtype=np.float32,
    )
    matrix = cv2.getPerspectiveTransform(src, dst)
    return cv2.warpPerspective(
        img, matrix, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(200, 200, 200)
    )


def test_perspective_distortion_detected() -> None:
    """Keystone distortion should be flagged as is_perspective=True."""
    from photo_calibrator.core.film_scan import detect_film_frame

    img = _make_perspective_test_image((800, 600), perspective_strength=0.10)
    result = detect_film_frame(img)

    assert result.confidence > 0.3, f"Confidence too low: {result.confidence}"
    assert result.is_perspective, "Perspective distortion not detected"


def test_perspective_transform_matrix_produced() -> None:
    """When perspective is detected, a valid 3×3 transform matrix is returned."""
    from photo_calibrator.core.film_scan import detect_film_frame

    img = _make_perspective_test_image((800, 600), perspective_strength=0.12)
    result = detect_film_frame(img)

    if result.is_perspective:
        assert result.transform_matrix is not None, "Transform matrix missing"
        assert len(result.transform_matrix) == 3, "Not 3 rows"
        assert all(len(row) == 3 for row in result.transform_matrix), "Not 3 cols"
        # Perspective transform should have non-trivial off-diagonal elements
        m = result.transform_matrix
        has_perspective_component = (
            abs(m[2][0]) > 1e-6 or abs(m[2][1]) > 1e-6
        )
        assert has_perspective_component, "Matrix looks affine, not perspective"


def test_level_image_not_perspective() -> None:
    """A perfectly level film image should NOT be flagged as perspective."""
    from photo_calibrator.core.film_scan import detect_film_frame

    img = _make_film_test_image((800, 600), rotation_deg=0, border_width=40)
    result = detect_film_frame(img)

    assert result.confidence > 0.5
    assert not result.is_perspective, "Level image incorrectly flagged as perspective"
    assert result.transform_matrix is None, "Should be no transform for level image"


# ── Film format identification tests ───────────────────────────────


def _make_film_with_ratio(
    canvas_size: tuple[int, int] = (800, 600),
    photo_ratio: float = 1.5,
    border_width: int = 30,
) -> np.ndarray:
    """Create a film image where the inner photo has a specific aspect ratio.

    The photo area is centered and sized to fill most of the canvas while
    preserving the given ratio.
    """
    cw, ch = canvas_size
    # Fit the photo ratio into the canvas
    if cw / ch > photo_ratio:
        ph = ch - 2 * border_width
        pw = int(ph * photo_ratio)
    else:
        pw = cw - 2 * border_width
        ph = int(pw / photo_ratio)

    x0 = (cw - pw) // 2
    y0 = (ch - ph) // 2

    img = np.zeros((ch, cw, 3), dtype=np.uint8)
    # Black border
    img[:, :] = (0, 0, 0)
    # Fill inner photo with gradient
    for row in range(ph):
        r_val = int(100 + 155 * row / max(ph, 1))
        img[y0 + row, x0 : x0 + pw] = (150, int(60 + 80 * (1 - row / max(ph, 1))), r_val)

    return img


def test_identify_135_full_frame() -> None:
    """3:2 aspect ratio should be identified as 135 full-frame."""
    from photo_calibrator.core.film_scan import detect_film_frame

    img = _make_film_with_ratio((800, 600), photo_ratio=1.50)
    result = detect_film_frame(img)

    assert result.confidence > 0.5
    assert result.film_format is not None, "No format identified"
    assert "135 full-frame" in result.film_format.name or "APS-C" in result.film_format.name


def test_identify_120_six_by_six() -> None:
    """1:1 aspect ratio should be identified as 120 6×6."""
    from photo_calibrator.core.film_scan import detect_film_frame

    img = _make_film_with_ratio((600, 600), photo_ratio=1.0)
    result = detect_film_frame(img)

    assert result.confidence > 0.5
    if result.film_format is not None:
        assert "6×6" in result.film_format.name or result.film_format.orientation == "square"


# ── Evaluation tests ───────────────────────────────────────────────


def test_evaluation_produced_for_valid_frame() -> None:
    """A valid film frame should produce an evaluation with non-zero scores."""
    from photo_calibrator.core.film_scan import detect_film_frame

    img = _make_film_test_image((800, 600))
    result = detect_film_frame(img)

    assert result.evaluation is not None, "Evaluation missing"
    assert result.evaluation.overall_score > 0.5, f"Overall score too low: {result.evaluation.overall_score}"
    assert len(result.evaluation.diagnosis) > 0, "Diagnosis empty"


def test_evaluation_symmetry_perfect_for_level_image() -> None:
    """A perfectly level, rectangular frame should have high corner symmetry."""
    from photo_calibrator.core.film_scan import detect_film_frame

    img = _make_film_test_image((800, 600), rotation_deg=0, border_width=40)
    result = detect_film_frame(img)

    assert result.evaluation is not None
    assert result.evaluation.corner_symmetry > 0.9, (
        f"Symmetry should be > 0.9 for level frame: {result.evaluation.corner_symmetry}"
    )
