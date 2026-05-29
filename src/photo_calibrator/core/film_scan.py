"""Film scan auto-level/crop detection.

Detects film borders in scanned images using Canny edge detection +
Hough line transform + quad fitting. Returns rotation angle, crop box,
and confidence score.

All functions are pure — no disk I/O.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np


# ── Data model ─────────────────────────────────────────────────────


@dataclass(frozen=True)
class FilmScanResult:
    """Detected film frame geometry."""

    angle_deg: float
    """Rotation angle in degrees. Positive = clockwise from horizontal."""

    corners: list[tuple[int, int]]
    """Four corner points of the detected frame, in order (TL, TR, BR, BL)."""

    crop_x: int
    crop_y: int
    crop_w: int
    crop_h: int
    """Axis-aligned crop rectangle covering the inner photo area."""

    confidence: float
    """0.0–1.0.  Below 0.5 the caller should use the original image as-is."""

    border_type: str
    """'black', 'white', 'mixed', or 'unknown'."""

    is_perspective: bool = False
    """True if the detected quad has significant perspective (keystone) distortion."""

    transform_matrix: list[list[float]] | None = None
    """3×3 perspective transform matrix (OpenCV format) mapping detected corners
    to a fronto-parallel rectangle.  None if no perspective detected or
    confidence is low."""


# ── Constants ──────────────────────────────────────────────────────


_HOUGH_RHO = 1.0
_HOUGH_THETA = np.pi / 180
_HOUGH_THRESHOLD = 80
_HOUGH_MIN_LINE_LENGTH = 80
_HOUGH_MAX_LINE_GAP = 20

_ANGLE_TOLERANCE_DEG = 8.0  # cluster lines within ±8° (allows perspective slant)
_MIN_CONFIDENCE_LINES = 4  # need at least 4 long lines for a quad


# ── Public API ─────────────────────────────────────────────────────


def detect_film_frame(img_rgb: np.ndarray) -> FilmScanResult:
    """Detect film border, rotation angle, and crop rectangle.

    Args:
        img_rgb: uint8 H×W×3 RGB image.

    Returns:
        FilmScanResult with angle, corners, crop, and confidence.
    """
    h, w = img_rgb.shape[:2]

    edges = _canny_adaptive(img_rgb)
    lines = _detect_lines(edges)

    if len(lines) < _MIN_CONFIDENCE_LINES:
        return _low_confidence_result(w, h)

    h_group, v_group = _group_lines(lines)

    if len(h_group) < 2 or len(v_group) < 2:
        return _low_confidence_result(w, h)

    corners, confidence = _fit_quad(h_group, v_group, w, h)

    if corners is None:
        return _low_confidence_result(w, h)

    angle = _compute_angle(h_group, v_group)
    crop = _corners_to_crop(corners, img_w=w, img_h=h)
    border_type = _classify_border(img_rgb, corners)

    is_persp = _detect_perspective(corners)
    transform = None
    if is_persp:
        transform = _perspective_transform(corners)

    return FilmScanResult(
        angle_deg=round(angle, 2),
        corners=corners,
        crop_x=crop[0],
        crop_y=crop[1],
        crop_w=crop[2],
        crop_h=crop[3],
        confidence=round(confidence, 3),
        border_type=border_type,
        is_perspective=is_persp,
        transform_matrix=transform,
    )


# ── Internal helpers ───────────────────────────────────────────────


def _canny_adaptive(img_rgb: np.ndarray) -> np.ndarray:
    """Canny edge detection with thresholds adapted to image statistics."""
    gray = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2GRAY)
    median = np.median(gray)
    sigma = 0.33
    low = int(max(0, (1.0 - sigma) * median))
    high = int(min(255, (1.0 + sigma) * median))
    return cv2.Canny(gray, low, high)


def _detect_lines(edges: np.ndarray) -> list[tuple[float, float, float, float]]:
    """Detect line segments using probabilistic Hough transform.

    Returns list of (x1, y1, x2, y2) line segment endpoints.
    """
    segs = cv2.HoughLinesP(
        edges,
        _HOUGH_RHO,
        _HOUGH_THETA,
        threshold=_HOUGH_THRESHOLD,
        minLineLength=_HOUGH_MIN_LINE_LENGTH,
        maxLineGap=_HOUGH_MAX_LINE_GAP,
    )
    if segs is None:
        return []
    # HoughLinesP returns shape (N, 1, 4)
    return [(float(s[0][0]), float(s[0][1]), float(s[0][2]), float(s[0][3])) for s in segs]


def _line_angle(x1: float, y1: float, x2: float, y2: float) -> float:
    """Line angle in degrees, normalized to [-90, 90]."""
    return float(np.degrees(np.arctan2(y2 - y1, x2 - x1)))


def _group_lines(
    lines: list[tuple[float, float, float, float]],
) -> tuple[list, list]:
    """Split lines into horizontal-ish and vertical-ish groups.

    Horizontal ≈ angle near 0° or ±180°.
    Vertical ≈ angle near ±90°.
    """
    horizontal: list[tuple[float, float, float, float, float]] = []
    vertical: list[tuple[float, float, float, float, float]] = []

    for x1, y1, x2, y2 in lines:
        ang = _line_angle(x1, y1, x2, y2)
        # Normalize to [-180, 180)
        if _abs_angle_diff(ang, 0) < _ANGLE_TOLERANCE_DEG or _abs_angle_diff(abs(ang), 180) < _ANGLE_TOLERANCE_DEG:
            horizontal.append((x1, y1, x2, y2, ang))
        elif _abs_angle_diff(abs(ang), 90) < _ANGLE_TOLERANCE_DEG:
            vertical.append((x1, y1, x2, y2, ang))

    # Sort horizontal by y (top to bottom), vertical by x (left to right)
    horizontal.sort(key=lambda l: (l[1] + l[3]) / 2.0)
    vertical.sort(key=lambda l: (l[0] + l[2]) / 2.0)

    return horizontal, vertical


def _abs_angle_diff(a: float, b: float) -> float:
    """Minimum angular distance in degrees."""
    diff = abs(a - b) % 180
    return diff if diff <= 90 else 180 - diff


def _fit_quad(
    h_group: list,
    v_group: list,
    img_w: int,
    img_h: int,
) -> tuple[list[tuple[int, int]] | None, float]:
    """Fit a quadrilateral from grouped lines.

    Takes the top/bottom horizontal lines and left/right vertical lines,
    computes their intersections → 4 corners.

    Returns (corners, confidence) where corners = [TL, TR, BR, BL]
    and corners is None if the quad is invalid.
    """
    # Use outermost lines
    top_line = h_group[0]
    bot_line = h_group[-1]
    left_line = v_group[0]
    right_line = v_group[-1]

    # Compute intersections: TL, TR, BR, BL
    try:
        tl = _intersection(top_line, left_line)
        tr = _intersection(top_line, right_line)
        br = _intersection(bot_line, right_line)
        bl = _intersection(bot_line, left_line)
    except ValueError:
        return None, 0.0

    corners = [(int(round(p[0])), int(round(p[1]))) for p in [tl, tr, br, bl]]

    # Sanity checks
    quad_area = float(cv2.contourArea(np.array(corners, dtype=np.float32)))
    img_area = img_w * img_h
    area_ratio = quad_area / img_area

    # Reject implausibly small quads, but allow quads larger than the image
    # (rotated frame corners may fall outside the image bounds)
    if area_ratio < 0.05:
        return None, 0.0

    # Check convex
    if not cv2.isContourConvex(np.array(corners, dtype=np.float32)):
        return None, 0.0

    # Confidence: based on line count and quad validity
    total_lines = len(h_group) + len(v_group)
    line_score = min(total_lines / 8.0, 1.0)  # 8+ lines = full score
    area_score = 0.5 + 0.5 * min(area_ratio, 0.9) / 0.9  # larger area up to 90% = more likely real
    confidence = 0.5 * line_score + 0.5 * area_score

    return corners, confidence


def _intersection(
    line1: tuple[float, float, float, float, float],
    line2: tuple[float, float, float, float, float],
) -> tuple[float, float]:
    """Find intersection point of two lines (infinite extension).

    Uses homogeneous coordinates for robustness to near-parallel lines.
    """
    x1, y1, x2, y2, _ = line1
    x3, y3, x4, y4, _ = line2

    denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
    if abs(denom) < 1e-10:
        raise ValueError("Parallel lines — no intersection")

    px = ((x1 * y2 - y1 * x2) * (x3 - x4) - (x1 - x2) * (x3 * y4 - y3 * x4)) / denom
    py = ((x1 * y2 - y1 * x2) * (y3 - y4) - (y1 - y2) * (x3 * y4 - y3 * x4)) / denom

    return float(px), float(py)


def _compute_angle(
    h_group: list,
    v_group: list,
) -> float:
    """Estimate rotation angle from dominant line orientations.

    Normalizes angles to [-90, 90] — lines at 0° and ±180° are the same
    physical orientation (parallel to horizontal).
    """
    angles = [_normalize_angle(l[4]) for l in h_group]
    if not angles:
        angles = [_normalize_angle(l[4] - 90.0) for l in v_group]
    if not angles:
        return 0.0

    # In OpenCV, positive = CCW. Negate so positive = clockwise (intuitive for photos).
    return -float(np.mean(angles))


def _normalize_angle(deg: float) -> float:
    """Normalize angle to [-90, 90] range (horizontal reference).

    3° → 3°, 177° → -3°, -178° → 2°, 91° → -89°, etc.
    """
    deg = deg % 180
    if deg > 90:
        deg -= 180
    return deg


def _corners_to_crop(corners: list[tuple[int, int]], img_w: int = 10000, img_h: int = 10000) -> tuple[int, int, int, int]:
    """Axis-aligned bounding rectangle of the 4 corners, clipped to image."""
    xs = [c[0] for c in corners]
    ys = [c[1] for c in corners]
    x_min = max(0, min(xs))
    y_min = max(0, min(ys))
    x_max = min(img_w, max(xs))
    y_max = min(img_h, max(ys))
    return (x_min, y_min, x_max - x_min, y_max - y_min)


def _classify_border(
    img_rgb: np.ndarray, corners: list[tuple[int, int]]
) -> str:
    """Classify border color (black/white/mixed) by sampling outside the crop."""
    # Quick heuristic: sample pixels just outside the detected corners
    # If the mean value is low → black border; high → white border
    cx = sum(c[0] for c in corners) / 4.0
    cy = sum(c[1] for c in corners) / 4.0

    # Sample pixels at 25% from edges (likely border)
    h, w = img_rgb.shape[:2]
    samples = []

    # Sample a strip near the edge, outside the estimated crop
    left_x = max(0, int(min(c[0] for c in corners) * 0.5))
    right_x = min(w - 1, int((w + max(c[0] for c in corners)) * 0.5))
    top_y = max(0, int(min(c[1] for c in corners) * 0.5))

    if left_x < right_x and top_y > 0:
        strip = img_rgb[top_y : top_y + 2, left_x:right_x]
        samples.append(float(np.mean(strip)))

    bottom_y = min(h - 1, int((h + max(c[1] for c in corners)) * 0.5))
    if left_x < right_x and bottom_y < h:
        strip = img_rgb[bottom_y - 2 : bottom_y, left_x:right_x]
        samples.append(float(np.mean(strip)))

    if not samples:
        return "unknown"

    avg = float(np.mean(samples))
    if avg < 60:
        return "black"
    elif avg > 190:
        return "white"
    return "unknown"


_PERSPECTIVE_ANGLE_THRESHOLD = 5.0  # degrees — max deviation from 90° corner
_PERSPECTIVE_SIDE_RATIO_THRESHOLD = 0.12  # opposite sides differ by >12% → perspective


def _detect_perspective(corners: list[tuple[int, int]]) -> bool:
    """Check if the detected quad has significant perspective distortion.

    A perfect rectangle has: opposite sides equal, all corners ≈ 90°.
    Perspective (keystone) distortion breaks both properties.

    Uses two heuristics:
    1. Opposite sides length ratio: if |top - bottom| / avg > threshold
    2. Corner angle deviation from 90°
    """
    tl, tr, br, bl = corners

    # Side lengths: top, right, bottom, left
    def _len(a, b):
        return float(np.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2))

    top = _len(tl, tr)
    right = _len(tr, br)
    bottom = _len(br, bl)
    left = _len(bl, tl)

    # Opposite side ratio check
    h_ratio = abs(top - bottom) / max((top + bottom) / 2.0, 1.0)
    v_ratio = abs(left - right) / max((left + right) / 2.0, 1.0)
    if h_ratio > _PERSPECTIVE_SIDE_RATIO_THRESHOLD or v_ratio > _PERSPECTIVE_SIDE_RATIO_THRESHOLD:
        return True

    # Corner angle check (should be ~90°)
    def _corner_angle(p0, p1, p2):
        """Angle at p1 formed by p0—p1—p2."""
        v1 = (p0[0] - p1[0], p0[1] - p1[1])
        v2 = (p2[0] - p1[0], p2[1] - p1[1])
        dot = v1[0] * v2[0] + v1[1] * v2[1]
        norm = float(np.sqrt(v1[0] ** 2 + v1[1] ** 2) * np.sqrt(v2[0] ** 2 + v2[1] ** 2))
        if norm < 1e-10:
            return 90.0
        cos_a = max(-1.0, min(1.0, dot / norm))
        return float(np.degrees(np.arccos(cos_a)))

    angles = [
        _corner_angle(bl, tl, tr),  # TL corner
        _corner_angle(tl, tr, br),  # TR corner
        _corner_angle(tr, br, bl),  # BR corner
        _corner_angle(br, bl, tl),  # BL corner
    ]

    for a in angles:
        if abs(a - 90.0) > _PERSPECTIVE_ANGLE_THRESHOLD:
            return True

    return False


def _perspective_transform(
    corners: list[tuple[int, int]],
) -> list[list[float]]:
    """Compute 3×3 perspective transform matrix to rectify the quad.

    Maps the four detected corners to an axis-aligned rectangle whose
    dimensions are the average width and height of the detected quad.

    Returns 3×3 matrix as list of lists (JSON-serializable, hashable).
    """
    tl, tr, br, bl = corners

    # Target rectangle dimensions: average width × average height
    def _len(a, b):
        return float(np.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2))

    avg_w = int((_len(tl, tr) + _len(bl, br)) / 2.0)
    avg_h = int((_len(tl, bl) + _len(tr, br)) / 2.0)

    src = np.array([tl, tr, br, bl], dtype=np.float32)
    dst = np.array(
        [[0, 0], [avg_w - 1, 0], [avg_w - 1, avg_h - 1], [0, avg_h - 1]],
        dtype=np.float32,
    )

    matrix = cv2.getPerspectiveTransform(src, dst)
    return [[float(matrix[i, j]) for j in range(3)] for i in range(3)]


def _low_confidence_result(img_w: int, img_h: int) -> FilmScanResult:
    """Fallback: return full image with zero angle and low confidence."""
    return FilmScanResult(
        angle_deg=0.0,
        corners=[],
        crop_x=0,
        crop_y=0,
        crop_w=img_w,
        crop_h=img_h,
        confidence=0.0,
        border_type="unknown",
    )
