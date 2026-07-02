"""Tests for film scan auto-level/crop detection.

Generates synthetic film images with controlled borders and rotations,
then verifies that detect_film_frame() recovers the ground truth.
"""

from __future__ import annotations

from pathlib import Path

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


def _make_sprocket_film_test_image(canvas_size: tuple[int, int] = (900, 600)) -> np.ndarray:
    """Create a negative strip with repeated sprocket holes outside the photo area."""
    w, h = canvas_size
    img = np.full((h, w, 3), (124, 78, 50), dtype=np.uint8)

    photo_x0, photo_y0 = 90, 110
    photo_x1, photo_y1 = w - 90, h - 110
    for row in range(photo_y0, photo_y1):
        t = (row - photo_y0) / max(photo_y1 - photo_y0, 1)
        img[row, photo_x0:photo_x1] = (
            int(105 + 45 * t),
            int(74 + 35 * (1.0 - t)),
            int(48 + 30 * t),
        )
    cv2.rectangle(img, (photo_x0, photo_y0), (photo_x1, photo_y1), (80, 48, 30), 3)

    hole_w = max(28, w // 18)
    hole_h = max(34, h // 12)
    step = max(70, w // 8)
    for x in range(55, w - hole_w - 40, step):
        cv2.rectangle(img, (x, 28), (x + hole_w, 28 + hole_h), (225, 242, 245), -1)
        cv2.rectangle(img, (x, h - 28 - hole_h), (x + hole_w, h - 28), (225, 242, 245), -1)

    # Add edge clutter that used to attract the crop detector before the
    # sprocket exclusion pass.
    for x in range(20, w, 35):
        cv2.line(img, (x, 0), (x + 10, 42), (42, 30, 25), 2)
        cv2.line(img, (x, h - 1), (x + 12, h - 42), (42, 30, 25), 2)
    return img


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


def test_refine_crop_trims_uniform_rebate_inside_detected_frame() -> None:
    """Inner image content should be preferred over uniform rebate strips."""
    from photo_calibrator.core.film_scan import _refine_crop_to_content

    img = np.full((200, 300, 3), 120, dtype=np.uint8)
    img[20:180, 20:280] = (12, 12, 12)
    for row in range(30, 170):
        img[row, 40:260] = (80 + row // 3, 100 + row // 5, 160 - row // 6)

    refined = _refine_crop_to_content(img, (20, 20, 260, 160))

    assert abs(refined[0] - 40) <= 8
    assert abs(refined[1] - 30) <= 8
    assert abs(refined[2] - 220) <= 16
    assert abs(refined[3] - 140) <= 16


def test_safe_crop_inset_moves_detected_edges_inward() -> None:
    from photo_calibrator.core.film_scan import _inset_crop_for_safety

    safe_crop, inset = _inset_crop_for_safety((40, 30, 720, 540), 800, 600)

    assert inset == (7, 5)
    assert safe_crop == (47, 35, 706, 530)


def test_sprocket_rows_are_excluded_from_auto_crop() -> None:
    from photo_calibrator.core.film_scan import detect_film_frame

    img = _make_sprocket_film_test_image()
    result = detect_film_frame(img)

    assert result.confidence > 0.45
    assert result.debug is not None
    sprocket = result.debug["sprocket_exclusion"]
    assert sprocket["active"]
    assert "top" in sprocket["edges"]
    assert "bottom" in sprocket["edges"]
    assert result.crop_y >= sprocket["edges"]["top"]["inner_edge"]
    assert result.crop_y + result.crop_h <= sprocket["edges"]["bottom"]["inner_edge"]


def test_real_sprocket_scan_regression_20260629103226() -> None:
    from photo_calibrator.core.film_scan import detect_film_frame

    image_path = Path(__file__).resolve().parents[1] / "photo_test" / "20260629103226_3_50.jpg"
    img_bgr = cv2.imread(str(image_path))
    if img_bgr is None:
        pytest.skip("real sprocket regression image is not available")

    img = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    result = detect_film_frame(img)

    assert result.confidence > 0.5
    assert result.crop_y >= 130
    assert result.crop_y + result.crop_h <= 825
    assert result.debug is not None
    sprocket = result.debug["sprocket_exclusion"]
    assert sprocket["active"]
    assert sprocket["edges"]["top"]["inner_edge"] >= 125
    assert sprocket["edges"]["bottom"]["inner_edge"] <= 825


def test_real_raw_scan_without_sprockets_does_not_trigger_exclusion_00188() -> None:
    from photo_calibrator.core.film_scan import detect_film_frame
    from photo_calibrator.io.raw import decode_raw_preview

    image_path = Path(__file__).resolve().parents[1] / "photo_test" / "Capture00188.NEF"
    if not image_path.exists():
        pytest.skip("real RAW crop regression image is not available")
    try:
        decoded = decode_raw_preview(image_path.read_bytes(), image_path.name)
    except ValueError as exc:
        pytest.skip(str(exc))
    if decoded is None:
        pytest.skip("RAW preview could not be decoded")

    img_bgr, _source = decoded
    img = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    result = detect_film_frame(img)

    assert result.confidence > 0.5
    assert result.crop_y < 80
    assert result.crop_h > img.shape[0] * 0.90
    assert result.debug is not None
    assert not result.debug["sprocket_exclusion"]["active"]


def test_real_medium_format_raw_previews_do_not_trigger_sprocket_exclusion_at_analysis_size() -> None:
    from photo_calibrator.core.film_scan import detect_film_frame
    from photo_calibrator.io.raw import decode_raw_preview

    image_paths = sorted((Path(__file__).resolve().parents[1] / "photo_test").glob("Capture*.NEF"))
    if not image_paths:
        pytest.skip("real medium-format RAW regression images are not available")

    decoded_count = 0
    for image_path in image_paths:
        try:
            decoded = decode_raw_preview(image_path.read_bytes(), image_path.name)
        except ValueError:
            continue
        if decoded is None:
            continue

        img_bgr, _source = decoded
        img = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
        max_side = max(img.shape[:2])
        if max_side > 960:
            scale = 960.0 / float(max_side)
            img = cv2.resize(
                img,
                (max(1, int(round(img.shape[1] * scale))), max(1, int(round(img.shape[0] * scale)))),
                interpolation=cv2.INTER_AREA,
            )

        result = detect_film_frame(img)
        decoded_count += 1

        assert result.confidence > 0.5, image_path.name
        assert result.crop_w > img.shape[1] * 0.80, image_path.name
        assert result.crop_h > img.shape[0] * 0.90, image_path.name
        assert result.debug is not None
        assert not result.debug["sprocket_exclusion"]["active"], image_path.name

    if decoded_count == 0:
        pytest.skip("RAW previews could not be decoded")


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


def test_identify_four_by_three_without_sprockets_prefers_120() -> None:
    from photo_calibrator.core.film_scan import identify_film_format

    corners = [(0, 0), (133, 0), (133, 100), (0, 100)]
    result = identify_film_format(corners, prefer_medium_format=True)

    assert result is not None
    assert result.name == "120 6×4.5"


def test_identify_medium_format_panoramas_from_ratio_without_fixed_entries() -> None:
    from photo_calibrator.core.film_scan import identify_film_format

    six_by_twelve = identify_film_format([(0, 0), (200, 0), (200, 100), (0, 100)], prefer_medium_format=True)
    generic_panorama = identify_film_format([(0, 0), (233, 0), (233, 100), (0, 100)], prefer_medium_format=True)

    assert six_by_twelve is not None
    assert six_by_twelve.name == "120 6×12"
    assert generic_panorama is not None
    assert generic_panorama.name == "120 6×14"


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
