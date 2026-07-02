"""Film scan auto-level/crop detection.

Detects film borders in scanned images using Canny edge detection +
Hough line transform + quad fitting. Returns rotation angle, crop box,
and confidence score.

All functions are pure — no disk I/O.
"""

from __future__ import annotations

from dataclasses import dataclass
from itertools import product
from typing import Any

import cv2
import numpy as np

from .accelerator import ACCELERATOR


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

    film_format: FilmFormat | None = None
    """Identified film format, or None if confidence too low."""

    evaluation: FilmScanEval | None = None
    """Quality evaluation of the film frame detection and correction."""

    debug: dict[str, Any] | None = None
    """Optional crop-detection diagnostics for UI overlays and tuning."""


@dataclass(frozen=True)
class FilmFormat:
    """Known film format with nominal dimensions and aspect ratio."""

    name: str
    """Human-readable format name, e.g. '135 full-frame', '120 6×6'."""

    nominal_ratio: float
    """Nominal aspect ratio width/height (landscape).  e.g. 1.50 for 3:2."""

    orientation: str
    """'landscape', 'portrait', or 'square'."""

    ratio_tolerance: float = 0.06
    """Allowed deviation from nominal ratio for matching."""


@dataclass(frozen=True)
class FilmScanEval:
    """Quality metrics for film frame detection and correction."""

    format_match_confidence: float
    """0–1. How well the detected aspect ratio matches the identified format."""

    corner_symmetry: float
    """0–1. 1.0 = perfectly symmetric rectangle (opposite sides equal)."""

    crop_coverage: float
    """Crop area / image area.  Ideal range ~0.3–0.85."""

    overall_score: float
    """Weighted composite 0–1.  < 0.3 = likely bad detection."""

    diagnosis: list[str]
    """Human-readable notes, e.g. 'aspect ratio matches 135 full-frame'."""


@dataclass(frozen=True)
class _SprocketExclusion:
    """Detected sprocket rows/columns that should stay outside the photo crop."""

    left_inner_edge: int | None = None
    right_inner_edge: int | None = None
    top_inner_edge: int | None = None
    bottom_inner_edge: int | None = None
    debug: dict[str, Any] | None = None

    @property
    def active(self) -> bool:
        return any(
            edge is not None
            for edge in (
                self.left_inner_edge,
                self.right_inner_edge,
                self.top_inner_edge,
                self.bottom_inner_edge,
            )
        )


# ── Constants ──────────────────────────────────────────────────────


_HOUGH_RHO = 1.0
_HOUGH_THETA = np.pi / 180
_HOUGH_THRESHOLD = 80
_HOUGH_MIN_LINE_LENGTH = 80
_HOUGH_MAX_LINE_GAP = 20

_ANGLE_TOLERANCE_DEG = 8.0  # cluster lines within ±8° (allows perspective slant)
_MIN_CONFIDENCE_LINES = 4  # need at least 4 long lines for a quad
_SAFE_CROP_INSET_RATIO = 0.01
_SAFE_CROP_INSET_MAX_PX = 24
_SPROCKET_EDGE_SEARCH_RATIO = 0.22
_SPROCKET_EDGE_SEARCH_MAX_PX = 260
_SPROCKET_COMPONENT_MIN_COUNT = 6
_SPROCKET_COMPONENT_MIN_SPAN_RATIO = 0.30
_SPROCKET_MARGIN_RATIO = 0.012
_SPROCKET_SIZE_OUTLIER_RATIO = 2.35
_SPROCKET_SIZE_INLIER_RATIO = 0.45

# ── Known film formats ─────────────────────────────────────────────

# Aspect ratios from film datasheets.  Landscape ratios (w/h ≥ 1.0).
# Portrait variants handled by swapping orientation during matching.
_KNOWN_FILM_FORMATS: list[FilmFormat] = [
    FilmFormat("135 full-frame", 1.50, "landscape"),      # 36×24 mm → 3:2
    FilmFormat("135 half-frame (landscape)", 1.33, "landscape"),  # 24×18 mm
    FilmFormat("135 half-frame (portrait)", 0.75, "portrait"),    # 18×24 mm
    FilmFormat("120 6×4.5", 1.33, "landscape"),          # 56×42 mm → 4:3
    FilmFormat("120 6×6", 1.00, "square"),               # 56×56 mm
    FilmFormat("120 6×7", 1.25, "landscape"),            # 56×70 mm
    FilmFormat("120 6×9", 1.50, "landscape"),            # 56×84 mm → 3:2 (matches 135!)
    FilmFormat("4×5 large format", 0.80, "portrait"),     # 102×127 mm
    FilmFormat("APS-C (digital)", 1.50, "landscape"),     # ~23×15 mm → 3:2
    FilmFormat("Micro 4/3", 1.33, "landscape"),          # 17×13 mm → 4:3
    FilmFormat("1-inch sensor", 1.33, "landscape"),       # 13×9 mm → 4:3
]

_COMMON_MEDIUM_FORMATS: tuple[FilmFormat, ...] = (
    FilmFormat("120 6×4.5", 1.33, "landscape", 0.07),
    FilmFormat("120 6×6", 1.00, "square", 0.06),
    FilmFormat("120 6×7", 1.25, "landscape", 0.08),
)
_MEDIUM_PANORAMA_MIN_RATIO = 1.70
_MEDIUM_PANORAMA_MAX_RATIO = 3.60


# ── Public API ─────────────────────────────────────────────────────


def detect_film_frame(img_rgb: np.ndarray) -> FilmScanResult:
    """Detect film border, rotation angle, and crop rectangle.

    Args:
        img_rgb: uint8 H×W×3 RGB image.

    Returns:
        FilmScanResult with angle, corners, crop, and confidence.
    """
    h, w = img_rgb.shape[:2]
    normalized = _normalize_negative_crop_view(img_rgb)

    edges = _canny_adaptive(normalized)
    lines = _detect_lines(edges)
    h_group, v_group = _group_lines(lines) if lines else ([], [])

    corners: list[tuple[int, int]] | None = None
    angle = 0.0
    confidence = 0.0
    if len(h_group) >= 2 and len(v_group) >= 2:
        corners, confidence = _fit_quad(h_group, v_group, w, h)
    if corners is not None:
        angle = _compute_angle(h_group, v_group)

    hough_crop = _corners_to_crop(corners, img_w=w, img_h=h) if corners else (0, 0, w, h)
    sprocket = _detect_sprocket_exclusion(img_rgb)
    crop_candidates, crop_debug = _edge_crop_candidates(normalized, hough_crop, sprocket)
    scored_crop, crop_score = _select_best_crop(normalized, crop_candidates, hough_crop, sprocket)
    crop = scored_crop or hough_crop
    crop = _constrain_crop_to_sprocket_exclusion(crop, sprocket, w, h)
    crop = _refine_crop_to_content(img_rgb, crop)
    crop = _constrain_crop_to_sprocket_exclusion(crop, sprocket, w, h)

    if corners is None:
        if crop_score < 0.28:
            return _low_confidence_result(w, h)
        corners = _crop_to_corners(crop)
        confidence = crop_score
    else:
        confidence = max(confidence, crop_score)

    detected_crop = crop
    crop, safe_inset = _inset_crop_for_safety(crop, w, h)

    border_type = _classify_border(img_rgb, corners)

    is_persp = _detect_perspective(corners) if len(corners) == 4 else False
    transform = _perspective_transform(corners) if is_persp else None

    film_fmt = identify_film_format(corners, prefer_medium_format=not sprocket.active) if confidence > 0.4 else None
    evaluation = evaluate_film_correction(corners, crop, film_fmt, (w, h))

    return FilmScanResult(
        angle_deg=round(angle, 2),
        corners=corners,
        crop_x=crop[0],
        crop_y=crop[1],
        crop_w=crop[2],
        crop_h=crop[3],
        confidence=round(float(np.clip(confidence, 0.0, 1.0)), 3),
        border_type=border_type,
        is_perspective=is_persp,
        transform_matrix=transform,
        film_format=film_fmt,
        evaluation=evaluation,
        debug=_finalize_crop_debug(crop_debug, crop, detected_crop, safe_inset, hough_crop, w, h),
    )


# ── Internal helpers ───────────────────────────────────────────────


def _canny_adaptive(img_rgb: np.ndarray) -> np.ndarray:
    """Canny edge detection with thresholds adapted to image statistics."""
    gray = img_rgb if img_rgb.ndim == 2 else ACCELERATOR.rgb_to_gray_u8(img_rgb)
    median = np.median(gray)
    sigma = 0.33
    low = int(max(0, (1.0 - sigma) * median))
    high = int(min(255, (1.0 + sigma) * median))
    return cv2.Canny(gray, low, high)


def _normalize_negative_crop_view(img_rgb: np.ndarray) -> np.ndarray:
    """Build a fast crop-detection grayscale view tailored for color negatives."""
    rgb = img_rgb.astype(np.float32, copy=False)
    reshaped = rgb.reshape(-1, 3)
    low = np.percentile(reshaped, 2.0, axis=0)
    high = np.percentile(reshaped, 98.0, axis=0)
    span = np.maximum(high - low, 1.0)
    normalized = np.clip((rgb - low) / span, 0.0, 1.0)
    # Invert into a rough positive and suppress the orange mask bias.
    inv = 1.0 - normalized
    luma = inv[:, :, 1] * 0.50 + inv[:, :, 0] * 0.25 + inv[:, :, 2] * 0.25
    gray = np.clip(luma * 255.0, 0.0, 255.0).astype(np.uint8)
    clahe = cv2.createCLAHE(clipLimit=2.2, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)
    return ACCELERATOR.gaussian_blur(enhanced, (5, 5), 0)


def _detect_sprocket_exclusion(img_rgb: np.ndarray) -> _SprocketExclusion:
    """Detect repeated sprocket holes near image edges and expose inner crop limits.

    Film perforations are intentionally high-frequency, high-contrast shapes.
    They are useful for recognizing the film strip, but they are poor crop
    boundaries because their edges can dominate Hough/profile scoring.  This
    detector looks for repeated small components in the outer image bands and
    converts them into one-sided exclusion limits for the later crop scorer.
    """
    h, w = img_rgb.shape[:2]
    if h < 80 or w < 80:
        return _SprocketExclusion(debug={"active": False, "edges": {}})

    gray = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2GRAY)
    edge_results: dict[str, dict[str, Any]] = {}
    inner_edges: dict[str, int | None] = {
        "left": None,
        "right": None,
        "top": None,
        "bottom": None,
    }

    for edge in ("top", "bottom", "left", "right"):
        result = _detect_sprocket_edge(gray, edge)
        if result is None:
            continue
        inner_edges[edge] = int(result["inner_edge"])
        edge_results[edge] = result

    active = any(value is not None for value in inner_edges.values())
    return _SprocketExclusion(
        left_inner_edge=inner_edges["left"],
        right_inner_edge=inner_edges["right"],
        top_inner_edge=inner_edges["top"],
        bottom_inner_edge=inner_edges["bottom"],
        debug={"active": active, "edges": edge_results},
    )


def _detect_sprocket_edge(gray: np.ndarray, edge: str) -> dict[str, Any] | None:
    h, w = gray.shape[:2]
    horizontal = edge in ("top", "bottom")
    edge_length = h if horizontal else w
    search_size = max(48, min(int(round(edge_length * _SPROCKET_EDGE_SEARCH_RATIO)), _SPROCKET_EDGE_SEARCH_MAX_PX))

    if edge == "top":
        band = gray[:search_size, :]
        x_offset, y_offset = 0, 0
    elif edge == "bottom":
        band = gray[h - search_size : h, :]
        x_offset, y_offset = 0, h - search_size
    elif edge == "left":
        band = gray[:, :search_size]
        x_offset, y_offset = 0, 0
    elif edge == "right":
        band = gray[:, w - search_size : w]
        x_offset, y_offset = w - search_size, 0
    else:
        raise ValueError(f"Unknown sprocket edge: {edge}")

    if band.size == 0:
        return None

    components = _sprocket_components_from_band(band, x_offset, y_offset, w, h)
    group = _select_sprocket_component_group(components, horizontal, w, h)
    if group is None:
        return None

    boxes = group["boxes"]
    margin = max(6, min(24, int(round((h if horizontal else w) * _SPROCKET_MARGIN_RATIO))))
    if edge == "top":
        inner_edge = max(box["y"] + box["h"] for box in boxes) + margin
        inner_edge = int(np.clip(inner_edge, 0, h - 1))
    elif edge == "bottom":
        inner_edge = min(box["y"] for box in boxes) - margin
        inner_edge = int(np.clip(inner_edge, 1, h))
    elif edge == "left":
        inner_edge = max(box["x"] + box["w"] for box in boxes) + margin
        inner_edge = int(np.clip(inner_edge, 0, w - 1))
    else:
        inner_edge = min(box["x"] for box in boxes) - margin
        inner_edge = int(np.clip(inner_edge, 1, w))

    polarities = [str(box["polarity"]) for box in boxes]
    dominant_polarity = max(set(polarities), key=polarities.count)
    return {
        "inner_edge": inner_edge,
        "component_count": len(boxes),
        "span": int(group["span"]),
        "polarity": dominant_polarity,
        "boxes": [
            {
                "x": int(box["x"]),
                "y": int(box["y"]),
                "w": int(box["w"]),
                "h": int(box["h"]),
            }
            for box in boxes[:16]
        ],
    }


def _sprocket_components_from_band(
    band: np.ndarray,
    x_offset: int,
    y_offset: int,
    img_w: int,
    img_h: int,
) -> list[dict[str, float | int | str]]:
    mean = float(np.mean(band))
    std = float(np.std(band))
    masks: list[tuple[str, np.ndarray, float]] = []

    bright_threshold = max(150.0, float(np.percentile(band, 92.0)), mean + std * 0.90)
    if bright_threshold <= 254.5:
        masks.append(("bright", band >= bright_threshold, bright_threshold))

    dark_threshold = min(105.0, float(np.percentile(band, 8.0)), mean - std * 0.90)
    if dark_threshold >= 0.5:
        masks.append(("dark", band <= dark_threshold, dark_threshold))

    components: list[dict[str, float | int | str]] = []
    close_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    open_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    for polarity, mask_bool, threshold in masks:
        mask = mask_bool.astype(np.uint8) * 255
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, close_kernel, iterations=1)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, open_kernel, iterations=1)
        num_labels, _labels, stats, centroids = cv2.connectedComponentsWithStats(mask, 8)
        for label in range(1, num_labels):
            x, y, w, h, area = (int(v) for v in stats[label])
            if not _is_sprocket_component_shape(w, h, int(area), img_w, img_h):
                continue
            components.append(
                {
                    "x": x + x_offset,
                    "y": y + y_offset,
                    "w": w,
                    "h": h,
                    "area": int(area),
                    "cx": float(centroids[label][0] + x_offset),
                    "cy": float(centroids[label][1] + y_offset),
                    "polarity": polarity,
                    "threshold": float(threshold),
                }
            )
    return _dedupe_sprocket_components(components)


def _is_sprocket_component_shape(width: int, height: int, area: int, img_w: int, img_h: int) -> bool:
    if width <= 0 or height <= 0:
        return False
    img_area = img_w * img_h
    min_area = max(40, int(round(img_area * 0.00004)))
    max_area = max(min_area + 1, int(round(img_area * 0.012)))
    if area < min_area or area > max_area:
        return False

    min_w = max(8, int(round(img_w * 0.008)))
    min_h = max(8, int(round(img_h * 0.012)))
    max_w = max(min_w + 4, int(round(img_w * 0.12)))
    max_h = max(min_h + 4, int(round(img_h * 0.16)))
    if not (min_w <= width <= max_w and min_h <= height <= max_h):
        return False

    fill = area / float(width * height)
    if fill < 0.12:
        return False
    aspect = width / float(height)
    return 0.18 <= aspect <= 5.5


def _dedupe_sprocket_components(
    components: list[dict[str, float | int | str]],
) -> list[dict[str, float | int | str]]:
    components.sort(key=lambda item: float(item["area"]), reverse=True)
    deduped: list[dict[str, float | int | str]] = []
    for component in components:
        cx = float(component["cx"])
        cy = float(component["cy"])
        if any(abs(cx - float(kept["cx"])) < 8 and abs(cy - float(kept["cy"])) < 8 for kept in deduped):
            continue
        deduped.append(component)
    return deduped


def _select_sprocket_component_group(
    components: list[dict[str, float | int | str]],
    horizontal: bool,
    img_w: int,
    img_h: int,
) -> dict[str, Any] | None:
    if len(components) < _SPROCKET_COMPONENT_MIN_COUNT:
        return None

    alignment_length = img_h if horizontal else img_w
    run_length = img_w if horizontal else img_h
    tolerance = max(14, min(42, int(round(alignment_length * 0.045))))
    min_span = run_length * _SPROCKET_COMPONENT_MIN_SPAN_RATIO
    best: dict[str, Any] | None = None
    best_score = float("-inf")

    for seed in components[:40]:
        seed_center = float(seed["cy"] if horizontal else seed["cx"])
        group = [
            component
            for component in components
            if abs(float(component["cy"] if horizontal else component["cx"]) - seed_center) <= tolerance
        ]
        group = _regular_sprocket_run(group, horizontal, run_length)
        if group is None:
            continue
        group = _consistent_sprocket_components(group, horizontal, run_length)
        if group is None:
            continue
        group = _linear_sprocket_alignment(group, horizontal)
        if group is None:
            continue
        if horizontal:
            run_start = min(int(component["x"]) for component in group)
            run_end = max(int(component["x"]) + int(component["w"]) for component in group)
        else:
            run_start = min(int(component["y"]) for component in group)
            run_end = max(int(component["y"]) + int(component["h"]) for component in group)
        span = run_end - run_start
        if span < min_span:
            continue
        widths = np.array([float(component["w"]) for component in group], dtype=np.float32)
        heights = np.array([float(component["h"]) for component in group], dtype=np.float32)
        areas = np.array([float(component["area"]) for component in group], dtype=np.float32)
        median_area = float(np.median(areas))
        median_short = float(np.median(np.minimum(widths, heights)))
        median_long = float(np.median(np.maximum(widths, heights)))
        shape_ratio = median_short / max(median_long, 1.0)
        thin_penalty = max(0.0, 0.55 - shape_ratio) * 4.0
        score = (
            min(len(group), 12) * 0.8
            + span / max(run_length, 1) * 4.0
            + min(4.0, median_area / max(img_w * img_h * 0.001, 1.0))
            + min(2.0, median_short / 20.0)
            - thin_penalty
        )
        if score > best_score:
            best_score = score
            best = {"boxes": group, "span": span, "score": score}

    return best


def _consistent_sprocket_components(
    components: list[dict[str, float | int | str]],
    horizontal: bool,
    run_length: int,
) -> list[dict[str, float | int | str]] | None:
    if len(components) < _SPROCKET_COMPONENT_MIN_COUNT:
        return None

    def _center(component: dict[str, float | int | str]) -> float:
        return float(component["cx"] if horizontal else component["cy"])

    widths = np.array([float(component["w"]) for component in components], dtype=np.float32)
    heights = np.array([float(component["h"]) for component in components], dtype=np.float32)
    areas = np.array([float(component["area"]) for component in components], dtype=np.float32)
    short_dims = np.minimum(widths, heights)
    long_dims = np.maximum(widths, heights)

    median_area = max(float(np.median(areas)), 1.0)
    median_short = max(float(np.median(short_dims)), 1.0)
    median_long = max(float(np.median(long_dims)), 1.0)
    core: list[dict[str, float | int | str]] = []
    for component, area, short_dim, long_dim in zip(components, areas, short_dims, long_dims, strict=True):
        area_ratio = float(area) / median_area
        short_ratio = float(short_dim) / median_short
        long_ratio = float(long_dim) / median_long
        if not (_SPROCKET_SIZE_INLIER_RATIO <= area_ratio <= _SPROCKET_SIZE_OUTLIER_RATIO):
            continue
        if not (_SPROCKET_SIZE_INLIER_RATIO <= short_ratio <= _SPROCKET_SIZE_OUTLIER_RATIO):
            continue
        if not (_SPROCKET_SIZE_INLIER_RATIO <= long_ratio <= _SPROCKET_SIZE_OUTLIER_RATIO):
            continue
        core.append(component)

    if len(core) < _SPROCKET_COMPONENT_MIN_COUNT:
        return None
    core.sort(key=_center)
    span = _center(core[-1]) - _center(core[0])
    if span < run_length * _SPROCKET_COMPONENT_MIN_SPAN_RATIO:
        return None
    return core


def _linear_sprocket_alignment(
    components: list[dict[str, float | int | str]],
    horizontal: bool,
) -> list[dict[str, float | int | str]] | None:
    """Keep only component groups that form one narrow perforation row/column."""
    if len(components) < _SPROCKET_COMPONENT_MIN_COUNT:
        return None

    run_centers = np.array(
        [float(component["cx"] if horizontal else component["cy"]) for component in components],
        dtype=np.float32,
    )
    alignment_centers = np.array(
        [float(component["cy"] if horizontal else component["cx"]) for component in components],
        dtype=np.float32,
    )
    alignment_sizes = np.array(
        [float(component["h"] if horizontal else component["w"]) for component in components],
        dtype=np.float32,
    )
    if run_centers.size < 2 or float(np.ptp(run_centers)) < 1.0:
        return None

    slope, intercept = np.polyfit(run_centers, alignment_centers, 1)
    residuals = np.abs(alignment_centers - (slope * run_centers + intercept))
    median_size = max(float(np.median(alignment_sizes)), 1.0)
    max_residual = float(np.max(residuals))
    std_residual = float(np.std(residuals))
    max_allowed = max(5.0, median_size * 0.42)
    std_allowed = max(2.5, median_size * 0.18)
    if max_residual > max_allowed or std_residual > std_allowed:
        return None
    return components


def _regular_sprocket_run(
    components: list[dict[str, float | int | str]],
    horizontal: bool,
    run_length: int,
) -> list[dict[str, float | int | str]] | None:
    if len(components) < _SPROCKET_COMPONENT_MIN_COUNT:
        return None

    def _center(component: dict[str, float | int | str]) -> float:
        return float(component["cx"] if horizontal else component["cy"])

    ordered = sorted(components, key=_center)
    centers = np.array([_center(component) for component in ordered], dtype=np.float32)
    gaps = np.diff(centers)
    if gaps.size == 0:
        return None
    small_gaps = gaps[gaps <= run_length * 0.25]
    median_gap = float(np.median(small_gaps)) if small_gaps.size else float(np.median(gaps))
    split_gap = max(run_length * 0.22, median_gap * 3.5, 48.0)

    runs: list[list[dict[str, float | int | str]]] = []
    current = [ordered[0]]
    for index, gap in enumerate(gaps, start=1):
        if float(gap) > split_gap:
            runs.append(current)
            current = []
        current.append(ordered[index])
    runs.append(current)

    runs.sort(
        key=lambda run: (
            len(run),
            _center(run[-1]) - _center(run[0]) if len(run) > 1 else 0.0,
        ),
        reverse=True,
    )
    best = runs[0]
    if len(best) < _SPROCKET_COMPONENT_MIN_COUNT:
        return None
    span = _center(best[-1]) - _center(best[0])
    if span < run_length * _SPROCKET_COMPONENT_MIN_SPAN_RATIO:
        return None
    return best


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


def _crop_to_corners(crop: tuple[int, int, int, int]) -> list[tuple[int, int]]:
    x, y, w, h = crop
    return [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]


def _inset_crop_for_safety(
    crop: tuple[int, int, int, int],
    img_w: int,
    img_h: int,
) -> tuple[tuple[int, int, int, int], tuple[int, int]]:
    """Inset a detected content box slightly so uncertain border pixels stay out."""
    x, y, w, h = crop
    if w < 16 or h < 16:
        return crop, (0, 0)

    inset_x = min(_SAFE_CROP_INSET_MAX_PX, max(2, int(round(w * _SAFE_CROP_INSET_RATIO))))
    inset_y = min(_SAFE_CROP_INSET_MAX_PX, max(2, int(round(h * _SAFE_CROP_INSET_RATIO))))
    if w - inset_x * 2 < 12 or h - inset_y * 2 < 12:
        return crop, (0, 0)

    safe_crop = (
        int(np.clip(x + inset_x, 0, max(0, img_w - 1))),
        int(np.clip(y + inset_y, 0, max(0, img_h - 1))),
        w - inset_x * 2,
        h - inset_y * 2,
    )
    return safe_crop, (inset_x, inset_y)


def _refine_crop_to_content(
    img_rgb: np.ndarray,
    crop: tuple[int, int, int, int],
) -> tuple[int, int, int, int]:
    """Trim uniform border strips inside an already detected crop.

    Some film scans expose a clear frame first, with the real image area inset
    by a thin black/white/orange rebate. The quad detection above is good at
    finding that outer frame, but for interactive crop suggestions we want the
    inner image content instead of the rebate itself.
    """
    x, y, w, h = crop
    if w < 48 or h < 48:
        return crop

    roi = img_rgb[y : y + h, x : x + w]
    if roi.size == 0:
        return crop
    gray = cv2.cvtColor(roi, cv2.COLOR_RGB2GRAY)
    inner = gray[h // 4 : max(h // 4 + 1, (h * 3) // 4), w // 4 : max(w // 4 + 1, (w * 3) // 4)]
    if inner.size == 0:
        return crop

    interior_mean = float(np.mean(inner))
    interior_std = float(np.std(inner))
    mean_threshold = max(14.0, interior_std * 0.55)
    std_threshold = max(8.0, interior_std * 0.45)
    gradient_threshold = max(4.0, interior_std * 0.18)

    def _smooth(values: np.ndarray) -> np.ndarray:
        kernel = np.array([1.0, 2.0, 3.0, 2.0, 1.0], dtype=np.float32)
        kernel /= float(kernel.sum())
        return np.convolve(values.astype(np.float32), kernel, mode="same")

    def _border_trim(means: np.ndarray, stds: np.ndarray, reverse: bool = False) -> int:
        n = int(means.shape[0])
        if n < 16:
            return 0
        seq_means = means[::-1] if reverse else means
        seq_stds = stds[::-1] if reverse else stds
        search = max(8, min(n // 5, 160))
        edge_span = max(4, min(search // 3, 24))
        for pivot in range(edge_span, search - edge_span):
            pre_mean = float(np.mean(seq_means[pivot - edge_span : pivot]))
            pre_std = float(np.mean(seq_stds[pivot - edge_span : pivot]))
            post_mean = float(np.mean(seq_means[pivot : pivot + edge_span]))
            post_std = float(np.mean(seq_stds[pivot : pivot + edge_span]))
            border_like = pre_std < std_threshold and (
                pre_mean < 60.0
                or pre_mean > 195.0
                or abs(pre_mean - interior_mean) > max(28.0, mean_threshold * 1.8)
            )
            content_like = abs(post_mean - interior_mean) < mean_threshold or post_std > pre_std + 3.0
            strong_transition = abs(post_mean - pre_mean) > mean_threshold
            if border_like and content_like and strong_transition:
                return min(pivot, int(n * 0.18))
        edge_mean = float(np.median(seq_means[:edge_span]))
        edge_std = float(np.median(seq_stds[:edge_span]))
        edge_diff = abs(edge_mean - interior_mean)
        if edge_std > std_threshold or (edge_mean >= 60.0 and edge_mean <= 195.0 and edge_diff <= max(28.0, mean_threshold * 1.8)):
            return 0
        smoothed = _smooth(seq_means[:search])
        gradients = np.abs(np.diff(smoothed))
        if gradients.size == 0:
            return 0
        pivot = int(np.argmax(gradients)) + 1
        if float(gradients[pivot - 1]) < gradient_threshold:
            return 0
        pre_start = max(0, pivot - edge_span)
        post_end = min(n, pivot + edge_span)
        pre_mean = float(np.mean(seq_means[pre_start:pivot]))
        pre_std = float(np.mean(seq_stds[pre_start:pivot]))
        post_mean = float(np.mean(seq_means[pivot:post_end]))
        post_std = float(np.mean(seq_stds[pivot:post_end]))
        border_like = abs(pre_mean - interior_mean) > mean_threshold or pre_std < std_threshold
        content_like = abs(post_mean - interior_mean) + 1.5 < abs(pre_mean - interior_mean) or post_std > pre_std + 3.0
        if not border_like or not content_like:
            return 0
        return min(pivot, int(n * 0.18))

    col_means = gray.mean(axis=0)
    col_stds = gray.std(axis=0)
    row_means = gray.mean(axis=1)
    row_stds = gray.std(axis=1)

    trim_left = _border_trim(col_means, col_stds, reverse=False)
    trim_right = _border_trim(col_means, col_stds, reverse=True)
    trim_top = _border_trim(row_means, row_stds, reverse=False)
    trim_bottom = _border_trim(row_means, row_stds, reverse=True)

    max_h_trim = max(0, w // 3 - 1)
    max_v_trim = max(0, h // 3 - 1)
    trim_left = min(trim_left, max_h_trim)
    trim_right = min(trim_right, max_h_trim)
    trim_top = min(trim_top, max_v_trim)
    trim_bottom = min(trim_bottom, max_v_trim)

    refined_x = x + trim_left
    refined_y = y + trim_top
    refined_w = w - trim_left - trim_right
    refined_h = h - trim_top - trim_bottom
    if refined_w < max(24, int(w * 0.55)) or refined_h < max(24, int(h * 0.55)):
        return crop
    return (refined_x, refined_y, refined_w, refined_h)


def _edge_crop_candidates(
    gray: np.ndarray,
    hough_crop: tuple[int, int, int, int],
    sprocket: _SprocketExclusion | None = None,
) -> tuple[list[tuple[int, int, int, int]], dict[str, Any]]:
    """Generate crop candidates from edge profiles plus the Hough proposal."""
    h, w = gray.shape[:2]
    col_mean = gray.mean(axis=0)
    col_std = gray.std(axis=0)
    row_mean = gray.mean(axis=1)
    row_std = gray.std(axis=1)
    col_grad = ACCELERATOR.sobel_abs_mean(gray, 1, 0, axis=0)
    row_grad = ACCELERATOR.sobel_abs_mean(gray, 0, 1, axis=1)

    left_h, top_h, width_h, height_h = hough_crop
    right_h = max(0, w - (left_h + width_h))
    bottom_h = max(0, h - (top_h + height_h))

    left_candidates, left_debug = _scan_edge_candidates(col_mean, col_std, col_grad, False, anchor=left_h)
    right_candidates, right_debug = _scan_edge_candidates(col_mean, col_std, col_grad, True, anchor=right_h)
    top_candidates, top_debug = _scan_edge_candidates(row_mean, row_std, row_grad, False, anchor=top_h)
    bottom_candidates, bottom_debug = _scan_edge_candidates(row_mean, row_std, row_grad, True, anchor=bottom_h)

    (
        band_left,
        band_right,
        band_top,
        band_bottom,
        band_debug,
    ) = _band_edge_candidates(gray, hough_crop)
    left_debug["band_samples"] = band_debug["left"]
    right_debug["band_samples"] = band_debug["right"]
    top_debug["band_samples"] = band_debug["top"]
    bottom_debug["band_samples"] = band_debug["bottom"]

    left_candidates = _merge_candidate_values(left_candidates, band_left, left_debug)
    right_candidates = _merge_candidate_values(right_candidates, band_right, right_debug)
    top_candidates = _merge_candidate_values(top_candidates, band_top, top_debug)
    bottom_candidates = _merge_candidate_values(bottom_candidates, band_bottom, bottom_debug)

    left_candidates = _apply_sprocket_trim_constraint(
        left_candidates,
        sprocket.left_inner_edge if sprocket else None,
        left_debug,
    )
    right_candidates = _apply_sprocket_trim_constraint(
        right_candidates,
        w - sprocket.right_inner_edge if sprocket and sprocket.right_inner_edge is not None else None,
        right_debug,
    )
    top_candidates = _apply_sprocket_trim_constraint(
        top_candidates,
        sprocket.top_inner_edge if sprocket else None,
        top_debug,
    )
    bottom_candidates = _apply_sprocket_trim_constraint(
        bottom_candidates,
        h - sprocket.bottom_inner_edge if sprocket and sprocket.bottom_inner_edge is not None else None,
        bottom_debug,
    )

    candidates: set[tuple[int, int, int, int]] = {hough_crop}
    for left, right, top, bottom in product(left_candidates, right_candidates, top_candidates, bottom_candidates):
        width = w - left - right
        height = h - top - bottom
        if width < int(w * 0.45) or height < int(h * 0.45):
            continue
        candidates.add((left, top, width, height))
    debug = {
        "detect_width": int(w),
        "detect_height": int(h),
        "edges": {
            "left": left_debug,
            "right": right_debug,
            "top": top_debug,
            "bottom": bottom_debug,
        },
        "sprocket_exclusion": sprocket.debug if sprocket is not None else {"active": False, "edges": {}},
    }
    return list(candidates), debug


def _apply_sprocket_trim_constraint(
    candidates: list[int],
    required_trim: int | None,
    debug: dict[str, Any],
) -> list[int]:
    if required_trim is None:
        debug["sprocket_required_trim"] = None
        return candidates

    required_trim = max(0, int(required_trim))
    tolerance = max(4, int(round(required_trim * 0.05)))
    constrained: list[int] = [required_trim]
    for value in candidates:
        if value + tolerance < required_trim:
            continue
        constrained.append(max(int(value), required_trim))

    merged: list[int] = []
    for value in constrained:
        if all(abs(value - kept) >= 6 for kept in merged):
            merged.append(value)
        if len(merged) >= 4:
            break
    debug["sprocket_required_trim"] = required_trim
    debug["merged_candidates"] = merged
    return merged


def _merge_candidate_values(primary: list[int], extra: list[int], debug: dict[str, Any] | None = None) -> list[int]:
    merged: list[int] = []
    weighted_trim = _weighted_trim_from_debug(debug)
    for value in [*primary, *extra]:
        if all(abs(value - kept) >= 6 for kept in merged):
            merged.append(int(value))
        if len(merged) >= 3:
            break
    if weighted_trim is not None and all(abs(weighted_trim - kept) >= 6 for kept in merged):
        merged.append(int(weighted_trim))
    if debug is not None:
        debug["merged_candidates"] = [int(v) for v in merged[:4]]
        debug["weighted_trim"] = int(weighted_trim) if weighted_trim is not None else None
    return merged


def _band_edge_candidates(
    gray: np.ndarray,
    hough_crop: tuple[int, int, int, int],
) -> tuple[list[int], list[int], list[int], list[int], dict[str, list[dict[str, float | int | str]]]]:
    """Collect edge candidates from multiple local bands instead of full-width averages."""
    h, w = gray.shape[:2]
    left_h, top_h, width_h, height_h = hough_crop
    right_h = max(0, w - (left_h + width_h))
    bottom_h = max(0, h - (top_h + height_h))

    x_bands = _axis_bands(w)
    y_bands = _axis_bands(h)
    left_values: list[int] = []
    right_values: list[int] = []
    top_values: list[int] = []
    bottom_values: list[int] = []
    debug: dict[str, list[dict[str, float | int | str]]] = {
        "left": [],
        "right": [],
        "top": [],
        "bottom": [],
    }

    for y0, y1 in y_bands:
        band = gray[y0:y1, :]
        if band.size == 0:
            continue
        band_mean = band.mean(axis=0)
        band_std = band.std(axis=0)
        band_grad = ACCELERATOR.sobel_abs_mean(band, 1, 0, axis=0)
        left_candidates, left_meta = _scan_edge_candidates(band_mean, band_std, band_grad, False, anchor=left_h)
        right_candidates, right_meta = _scan_edge_candidates(band_mean, band_std, band_grad, True, anchor=right_h)
        left_values.extend(left_candidates[:1])
        right_values.extend(right_candidates[:1])
        debug["left"].extend(_band_sample_debug(left_meta, y0, y1, "y"))
        debug["right"].extend(_band_sample_debug(right_meta, y0, y1, "y"))

    for x0, x1 in x_bands:
        band = gray[:, x0:x1]
        if band.size == 0:
            continue
        band_mean = band.mean(axis=1)
        band_std = band.std(axis=1)
        band_grad = ACCELERATOR.sobel_abs_mean(band, 0, 1, axis=1)
        top_candidates, top_meta = _scan_edge_candidates(band_mean, band_std, band_grad, False, anchor=top_h)
        bottom_candidates, bottom_meta = _scan_edge_candidates(band_mean, band_std, band_grad, True, anchor=bottom_h)
        top_values.extend(top_candidates[:1])
        bottom_values.extend(bottom_candidates[:1])
        debug["top"].extend(_band_sample_debug(top_meta, x0, x1, "x"))
        debug["bottom"].extend(_band_sample_debug(bottom_meta, x0, x1, "x"))

    return (
        _dedupe_sorted_candidates(left_values),
        _dedupe_sorted_candidates(right_values),
        _dedupe_sorted_candidates(top_values),
        _dedupe_sorted_candidates(bottom_values),
        debug,
    )


def _axis_bands(length: int) -> list[tuple[int, int]]:
    band = max(48, min(length // 3, max(64, length // 4)))
    center = length // 2
    return [
        (0, min(length, band)),
        (max(0, center - band // 2), min(length, center + band // 2)),
        (max(0, length - band), length),
    ]


def _dedupe_sorted_candidates(values: list[int]) -> list[int]:
    unique = [int(v) for v in values if v >= 0]
    chosen: list[int] = []
    for value in unique:
        if all(abs(value - kept) >= 6 for kept in chosen):
            chosen.append(value)
        if len(chosen) >= 3:
            break
    return chosen


def _scan_edge_candidates(
    means: np.ndarray,
    stds: np.ndarray,
    grads: np.ndarray,
    reverse: bool,
    *,
    anchor: int,
) -> tuple[list[int], dict[str, Any]]:
    """Return a small set of promising trim distances for one edge."""
    n = int(means.shape[0])
    seq_means = means[::-1] if reverse else means
    seq_stds = stds[::-1] if reverse else stds
    seq_grads = grads[::-1] if reverse else grads
    edge_span = max(8, min(24, n // 40))
    window = max(6, min(20, edge_span))
    search = max(edge_span * 2, min(n // 4, 240))
    center_start = max(search, n // 3)
    center_end = min(n - search, (n * 2) // 3)
    if center_end <= center_start:
        return [max(0, anchor)]

    interior_mean = float(np.median(seq_means[center_start:center_end]))
    interior_std = float(np.median(seq_stds[center_start:center_end]))
    edge_mean = float(np.median(seq_means[:edge_span]))
    edge_std = float(np.median(seq_stds[:edge_span]))
    edge_grad = float(np.median(seq_grads[:edge_span]))

    candidates: list[tuple[float, int, str]] = []
    if 0 <= anchor <= int(n * 0.22):
        candidates.append((1.5, int(anchor), "anchor"))
    candidates.append((0.5, 0, "zero"))
    legacy = _scan_legacy_edge_transition(seq_means, seq_stds)
    if legacy is not None:
        candidates.append((1.7, int(legacy), "legacy"))

    for idx in range(edge_span, search - window):
        pre_mean = float(np.mean(seq_means[max(0, idx - window) : idx]))
        pre_std = float(np.mean(seq_stds[max(0, idx - window) : idx]))
        post_mean = float(np.mean(seq_means[idx : idx + window]))
        post_std = float(np.mean(seq_stds[idx : idx + window]))
        post_grad = float(np.mean(seq_grads[idx : idx + window]))
        mean_delta = abs(post_mean - pre_mean)
        std_delta = post_std - pre_std
        border_flat = max(0.0, (interior_std - pre_std) / max(interior_std, 1.0))
        border_extreme = abs(pre_mean - interior_mean) / 32.0
        transition = mean_delta / 18.0 + max(0.0, std_delta) / 10.0 + post_grad / max(np.percentile(seq_grads[:search], 90), 1.0)
        content_gain = abs(post_mean - interior_mean) < abs(pre_mean - interior_mean)
        if not content_gain and post_std < pre_std + 1.5:
            continue
        score = border_flat + border_extreme + transition
        if score < 1.6:
            continue
        candidates.append((score, idx, "transition"))

    candidates.sort(key=lambda item: item[0], reverse=True)
    chosen: list[int] = []
    chosen_debug: list[dict[str, float | int | str]] = []
    for score, idx, source in candidates:
        if all(abs(idx - kept) >= max(8, window) for kept in chosen):
            chosen.append(int(idx))
            chosen_debug.append({"trim": int(idx), "score": float(score), "source": source})
        if len(chosen) >= 4:
            break
    if not chosen:
        chosen = [max(0, anchor)]
        chosen_debug = [{"trim": int(max(0, anchor)), "score": 0.0, "source": "fallback"}]
    return chosen, {
        "anchor": int(anchor),
        "search_limit": int(search),
        "global_candidates": chosen_debug,
        "band_samples": [],
        "merged_candidates": chosen.copy(),
        "weighted_trim": None,
    }


def _band_sample_debug(
    meta: dict[str, Any],
    band_start: int,
    band_end: int,
    band_axis: str,
) -> list[dict[str, float | int | str]]:
    samples: list[dict[str, float | int | str]] = []
    for candidate in meta.get("global_candidates", [])[:1]:
        trim = int(candidate.get("trim", 0))
        score = float(candidate.get("score", 0.0))
        source = str(candidate.get("source", "band"))
        samples.append(
            {
                "trim": trim,
                "score": score,
                "band_start": int(band_start),
                "band_end": int(band_end),
                "band_axis": band_axis,
                "source": source,
            }
        )
    return samples


def _weighted_trim_from_debug(debug: dict[str, Any] | None) -> int | None:
    if not debug:
        return None
    weighted_samples: list[tuple[float, float]] = []
    for item in debug.get("global_candidates", []):
        trim = item.get("trim")
        score = item.get("score")
        if isinstance(trim, (int, float)) and isinstance(score, (int, float)) and score > 0.8:
            weighted_samples.append((float(trim), float(score)))
    for item in debug.get("band_samples", []):
        trim = item.get("trim")
        score = item.get("score")
        if isinstance(trim, (int, float)) and isinstance(score, (int, float)) and score > 0.8:
            weighted_samples.append((float(trim), float(score) * 1.15))
    if not weighted_samples:
        return None
    weighted_samples.sort(key=lambda entry: entry[1], reverse=True)
    top = weighted_samples[:4]
    total_weight = sum(weight for _, weight in top)
    if total_weight <= 0:
        return None
    return int(round(sum(trim * weight for trim, weight in top) / total_weight))


def _finalize_crop_debug(
    debug: dict[str, Any],
    crop: tuple[int, int, int, int],
    detected_crop: tuple[int, int, int, int],
    safe_inset: tuple[int, int],
    hough_crop: tuple[int, int, int, int],
    width: int,
    height: int,
) -> dict[str, Any]:
    crop_x, crop_y, crop_w, crop_h = crop
    hough_x, hough_y, hough_w, hough_h = hough_crop
    debug["selected_crop"] = {
        "left": int(crop_x),
        "top": int(crop_y),
        "width": int(crop_w),
        "height": int(crop_h),
    }
    detected_x, detected_y, detected_w, detected_h = detected_crop
    debug["detected_crop"] = {
        "left": int(detected_x),
        "top": int(detected_y),
        "width": int(detected_w),
        "height": int(detected_h),
    }
    debug["safe_inset"] = {
        "x": int(safe_inset[0]),
        "y": int(safe_inset[1]),
        "ratio": _SAFE_CROP_INSET_RATIO,
    }
    debug["hough_crop"] = {
        "left": int(hough_x),
        "top": int(hough_y),
        "width": int(hough_w),
        "height": int(hough_h),
    }
    debug["image_width"] = int(width)
    debug["image_height"] = int(height)
    return debug


def _scan_legacy_edge_transition(
    seq_means: np.ndarray,
    seq_stds: np.ndarray,
) -> int | None:
    """Legacy single-edge transition probe kept as an extra candidate source."""
    n = int(seq_means.shape[0])
    if n < 32:
        return None
    search = max(8, min(n // 5, 160))
    edge_span = max(4, min(search // 3, 24))
    center_start = max(search, n // 3)
    center_end = min(n - search, (n * 2) // 3)
    if center_end <= center_start:
        return None
    interior_mean = float(np.median(seq_means[center_start:center_end]))
    interior_std = float(np.median(seq_stds[center_start:center_end]))
    mean_threshold = max(14.0, interior_std * 0.55)
    std_threshold = max(8.0, interior_std * 0.45)
    for pivot in range(edge_span, search - edge_span):
        pre_mean = float(np.mean(seq_means[pivot - edge_span : pivot]))
        pre_std = float(np.mean(seq_stds[pivot - edge_span : pivot]))
        post_mean = float(np.mean(seq_means[pivot : pivot + edge_span]))
        post_std = float(np.mean(seq_stds[pivot : pivot + edge_span]))
        border_like = pre_std < std_threshold and (
            pre_mean < 60.0
            or pre_mean > 195.0
            or abs(pre_mean - interior_mean) > max(28.0, mean_threshold * 1.8)
        )
        content_like = abs(post_mean - interior_mean) < mean_threshold or post_std > pre_std + 3.0
        strong_transition = abs(post_mean - pre_mean) > mean_threshold
        if border_like and content_like and strong_transition:
            return min(pivot, int(n * 0.18))
    return None


def _select_best_crop(
    gray: np.ndarray,
    candidates: list[tuple[int, int, int, int]],
    hough_crop: tuple[int, int, int, int],
    sprocket: _SprocketExclusion | None = None,
) -> tuple[tuple[int, int, int, int] | None, float]:
    """Score candidate rectangles and return the best one."""
    best_rect: tuple[int, int, int, int] | None = None
    best_score = float("-inf")
    for rect in candidates:
        score = _score_crop_rect(gray, rect, hough_crop, sprocket)
        if score > best_score:
            best_rect = rect
            best_score = score
    if best_rect is None:
        return None, 0.0
    normalized_score = float(np.clip((best_score + 2.0) / 8.0, 0.0, 1.0))
    return best_rect, normalized_score


def _score_crop_rect(
    gray: np.ndarray,
    rect: tuple[int, int, int, int],
    hough_crop: tuple[int, int, int, int],
    sprocket: _SprocketExclusion | None = None,
) -> float:
    x, y, w, h = rect
    img_h, img_w = gray.shape[:2]
    if w <= 0 or h <= 0:
        return -999.0
    x1 = x + w
    y1 = y + h
    if x < 0 or y < 0 or x1 > img_w or y1 > img_h:
        return -999.0

    strip = max(6, min(24, min(w, h) // 18))
    center = gray[y + h // 4 : y + (h * 3) // 4, x + w // 4 : x + (w * 3) // 4]
    if center.size == 0:
        return -999.0
    center_std = float(np.std(center))
    coverage = (w * h) / float(img_w * img_h)

    def _safe_region(y0: int, y1: int, x0: int, x1: int) -> np.ndarray | None:
        if x0 < 0 or y0 < 0 or x1 > img_w or y1 > img_h or x1 <= x0 or y1 <= y0:
            return None
        return gray[y0:y1, x0:x1]

    edge_score = 0.0
    weak_trim_penalty = 0.0
    active_edges = 0
    trims = (x, img_w - x1, y, img_h - y1)
    for trim, outer, inner in (
        (x, _safe_region(y, y1, max(0, x - strip), x), _safe_region(y, y1, x, min(img_w, x + strip))),
        (img_w - x1, _safe_region(y, y1, x1, min(img_w, x1 + strip)), _safe_region(y, y1, max(0, x1 - strip), x1)),
        (y, _safe_region(max(0, y - strip), y, x, x1), _safe_region(y, min(img_h, y + strip), x, x1)),
        (img_h - y1, _safe_region(y1, min(img_h, y1 + strip), x, x1), _safe_region(max(0, y1 - strip), y1, x, x1)),
    ):
        if inner is None or inner.size == 0:
            continue
        inner_mean = float(np.mean(inner))
        inner_std = float(np.std(inner))
        if outer is None or outer.size == 0:
            continue
        outer_mean = float(np.mean(outer))
        outer_std = float(np.std(outer))
        support = abs(inner_mean - outer_mean) / 22.0 + max(0.0, inner_std - outer_std) / 10.0
        edge_score += support
        if trim > strip and support < 0.75:
            weak_trim_penalty += (0.75 - support) * 2.4
        active_edges += 1

    if active_edges:
        edge_score /= active_edges

    # Modest preference toward realistic film coverage and non-extreme aspect ratios.
    coverage_penalty = abs(coverage - 0.78) * 3.2
    aspect = w / max(h, 1)
    aspect_penalty = min(abs(aspect - 1.5), abs(aspect - 1.33), abs(aspect - 1.0)) * 0.8
    hx, hy, hw, hh = hough_crop
    hough_trims = (hx, img_w - (hx + hw), hy, img_h - (hy + hh))
    anchor_penalty = 0.0
    for trim, ref in zip(trims, hough_trims, strict=True):
        if ref <= strip:
            continue
        anchor_penalty += min(1.2, abs(trim - ref) / max(ref, strip) * 0.7)
    sprocket_penalty = _sprocket_overlap_penalty(rect, img_w, img_h, sprocket)
    return (
        edge_score
        + center_std / 28.0
        - coverage_penalty
        - aspect_penalty
        - weak_trim_penalty
        - anchor_penalty
        - sprocket_penalty
    )


def _sprocket_overlap_penalty(
    rect: tuple[int, int, int, int],
    img_w: int,
    img_h: int,
    sprocket: _SprocketExclusion | None,
) -> float:
    if sprocket is None or not sprocket.active:
        return 0.0

    x, y, w, h = rect
    x1 = x + w
    y1 = y + h
    penalty = 0.0
    bonus = 0.0

    def _edge_penalty(overlap: int, length: int) -> float:
        return 2.0 + overlap / max(length, 1) * 18.0

    def _alignment_bonus(distance: int) -> float:
        return max(0.0, 0.55 - distance / 48.0)

    if sprocket.left_inner_edge is not None:
        if x < sprocket.left_inner_edge:
            penalty += _edge_penalty(sprocket.left_inner_edge - x, img_w)
        else:
            bonus += _alignment_bonus(abs(x - sprocket.left_inner_edge))
    if sprocket.right_inner_edge is not None:
        if x1 > sprocket.right_inner_edge:
            penalty += _edge_penalty(x1 - sprocket.right_inner_edge, img_w)
        else:
            bonus += _alignment_bonus(abs(x1 - sprocket.right_inner_edge))
    if sprocket.top_inner_edge is not None:
        if y < sprocket.top_inner_edge:
            penalty += _edge_penalty(sprocket.top_inner_edge - y, img_h)
        else:
            bonus += _alignment_bonus(abs(y - sprocket.top_inner_edge))
    if sprocket.bottom_inner_edge is not None:
        if y1 > sprocket.bottom_inner_edge:
            penalty += _edge_penalty(y1 - sprocket.bottom_inner_edge, img_h)
        else:
            bonus += _alignment_bonus(abs(y1 - sprocket.bottom_inner_edge))

    return max(0.0, penalty - bonus)


def _constrain_crop_to_sprocket_exclusion(
    crop: tuple[int, int, int, int],
    sprocket: _SprocketExclusion | None,
    img_w: int,
    img_h: int,
) -> tuple[int, int, int, int]:
    if sprocket is None or not sprocket.active:
        return crop

    x, y, w, h = crop
    x1 = x + w
    y1 = y + h
    if sprocket.left_inner_edge is not None:
        x = max(x, sprocket.left_inner_edge)
    if sprocket.right_inner_edge is not None:
        x1 = min(x1, sprocket.right_inner_edge)
    if sprocket.top_inner_edge is not None:
        y = max(y, sprocket.top_inner_edge)
    if sprocket.bottom_inner_edge is not None:
        y1 = min(y1, sprocket.bottom_inner_edge)

    new_w = x1 - x
    new_h = y1 - y
    min_w = max(24, int(round(img_w * 0.35)))
    min_h = max(24, int(round(img_h * 0.30)))
    if new_w < min_w or new_h < min_h:
        return crop
    return (int(x), int(y), int(new_w), int(new_h))


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


# ── Film format identification ─────────────────────────────────────


def identify_film_format(
    corners: list[tuple[int, int]],
    *,
    prefer_medium_format: bool = False,
) -> FilmFormat | None:
    """Identify film format from the detected frame aspect ratio.

    Computes the aspect ratio from the 4 corners (average of opposite
    side lengths), then matches against known film formats with tolerance.

    Returns None if no format matches within tolerance.
    """
    tl, tr, br, bl = corners

    def _len(a, b):
        return float(np.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2))

    # Average width/height from opposite sides (robust to perspective)
    avg_w = (_len(tl, tr) + _len(bl, br)) / 2.0
    avg_h = (_len(tl, bl) + _len(tr, br)) / 2.0

    if avg_w < 1 or avg_h < 1:
        return None

    ratio = avg_w / avg_h

    if prefer_medium_format:
        medium_fmt = _infer_medium_format_from_ratio(ratio)
        if medium_fmt is not None:
            return medium_fmt

    # Find closest non-contextual format.
    best: FilmFormat | None = None
    best_dist = float("inf")

    for fmt in _KNOWN_FILM_FORMATS:
        dist = abs(ratio - fmt.nominal_ratio)
        if dist < fmt.ratio_tolerance and dist < best_dist:
            best = fmt
            best_dist = dist

    return best


def _infer_medium_format_from_ratio(ratio: float) -> FilmFormat | None:
    if ratio <= 0.0:
        return None

    normalized = ratio if ratio >= 1.0 else 1.0 / ratio
    orientation = "square" if abs(normalized - 1.0) <= 0.06 else ("landscape" if ratio >= 1.0 else "portrait")

    best_common: FilmFormat | None = None
    best_dist = float("inf")
    for fmt in _COMMON_MEDIUM_FORMATS:
        dist = abs(normalized - fmt.nominal_ratio)
        if dist < fmt.ratio_tolerance and dist < best_dist:
            best_common = fmt
            best_dist = dist
    if best_common is not None:
        return FilmFormat(
            best_common.name,
            ratio if ratio >= 1.0 else 1.0 / best_common.nominal_ratio,
            orientation,
            best_common.ratio_tolerance,
        )

    if not (_MEDIUM_PANORAMA_MIN_RATIO <= normalized <= _MEDIUM_PANORAMA_MAX_RATIO):
        return None

    long_side = round(normalized * 6.0 * 2.0) / 2.0
    long_label = _format_medium_side(long_side)
    name = f"120 6×{long_label}"
    if orientation == "portrait":
        name = f"{name} (portrait)"
    return FilmFormat(name, ratio, orientation, 0.09)


def _format_medium_side(value: float) -> str:
    if abs(value - round(value)) < 0.05:
        return str(int(round(value)))
    return f"{value:.1f}".rstrip("0").rstrip(".")


# ── Quality evaluation ─────────────────────────────────────────────


def evaluate_film_correction(
    corners: list[tuple[int, int]],
    crop: tuple[int, int, int, int],
    film_fmt: FilmFormat | None,
    img_shape: tuple[int, int],
) -> FilmScanEval:
    """Evaluate the quality of the film frame detection.

    Computes three metrics and an overall composite score:
    1. format_match_confidence — how well the detected ratio matches film format
    2. corner_symmetry — opposite sides equality (rectangle check)
    3. crop_coverage — how much of the image the crop occupies

    Returns FilmScanEval with scores and human-readable diagnosis.
    """
    tl, tr, br, bl = corners
    img_w, img_h = img_shape

    def _len(a, b):
        return float(np.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2))

    # 1. Format match confidence
    avg_w = (_len(tl, tr) + _len(bl, br)) / 2.0
    avg_h = (_len(tl, bl) + _len(tr, br)) / 2.0
    ratio = avg_w / avg_h if avg_h > 0 else 0.0

    format_conf = 0.0
    if film_fmt is not None:
        ratio_err = abs(ratio - film_fmt.nominal_ratio)
        format_conf = max(0.0, 1.0 - ratio_err / film_fmt.ratio_tolerance)

    # 2. Corner symmetry — how equal are opposite sides
    top = _len(tl, tr)
    bottom = _len(br, bl)
    left = _len(tl, bl)
    right = _len(tr, br)

    h_sym = 1.0 - min(abs(top - bottom) / max((top + bottom) / 2.0, 1.0), 1.0)
    v_sym = 1.0 - min(abs(left - right) / max((left + right) / 2.0, 1.0), 1.0)
    corner_sym = (h_sym + v_sym) / 2.0

    # 3. Crop coverage — ideal ~0.4–0.85
    crop_area = float(crop[2] * crop[3])
    img_area = float(img_w * img_h)
    coverage = crop_area / max(img_area, 1.0)

    # Score: 1.0 if coverage in 0.4–0.85, falling off outside
    ideal_lo, ideal_hi = 0.4, 0.85
    if coverage < ideal_lo:
        coverage_score = coverage / ideal_lo
    elif coverage > ideal_hi:
        coverage_score = max(0.0, 1.0 - (coverage - ideal_hi) * 2)
    else:
        coverage_score = 1.0

    # 4. Overall score (weighted)
    overall = 0.35 * format_conf + 0.35 * corner_sym + 0.30 * coverage_score

    # Diagnosis
    diagnosis: list[str] = []
    if film_fmt is not None:
        diagnosis.append(f"aspect ratio {ratio:.2f} matches {film_fmt.name} ({film_fmt.nominal_ratio:.2f})")
    else:
        diagnosis.append(f"aspect ratio {ratio:.2f} — no known format match")

    if corner_sym < 0.85:
        diagnosis.append(f"corner symmetry low ({corner_sym:.2f}) — possible perspective or uneven border")
    if coverage_score < 0.6:
        reason = "too small" if coverage < ideal_lo else "near full image"
        diagnosis.append(f"crop coverage unusual ({coverage:.1%}) — {reason}")

    return FilmScanEval(
        format_match_confidence=round(format_conf, 3),
        corner_symmetry=round(corner_sym, 3),
        crop_coverage=round(coverage, 3),
        overall_score=round(overall, 3),
        diagnosis=diagnosis,
    )


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
