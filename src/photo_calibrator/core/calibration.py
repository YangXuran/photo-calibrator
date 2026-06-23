from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from enum import Enum

import cv2
import numpy as np

from .accelerator import ACCELERATOR
from .cast_detection import CastReport, analyze_image_array, auto_detect_cast, ensure_rgb_image, ensure_uint8_rgb, rgb_to_lab_float

DEFAULT_STRENGTH = 0.8


class CalibrationMode(str, Enum):
    GLOBAL = "global"
    MIDTONES_ONLY = "midtones-only"
    SKIN_PRIORITY = "skin-priority"
    HIGHLIGHTS_ONLY = "highlights-only"
    PRESERVE_SPLIT_TONE = "preserve-split-tone"
    RGB_CURVES = "rgb-curves"
    TONE_ZONE = "tone-zone"
    MATRIX = "matrix"
    LUT3D = "lut3d"
    SELECTIVE = "selective"
    FILM = "film"
    NEGATIVE_FILM = "negative-film"


@dataclass(frozen=True)
class CalibrationParams:
    mode: CalibrationMode = CalibrationMode.GLOBAL
    a_shift: float | None = None
    b_shift: float | None = None
    strength: float = DEFAULT_STRENGTH
    highlight_pct: float = 55.0
    sat_pct: float = 25.0
    curve_low_pct: float = 1.0
    curve_high_pct: float = 99.0
    gamma: tuple[float, float, float] | None = None
    r_curve: list[list[float]] | None = None
    g_curve: list[list[float]] | None = None
    b_curve: list[list[float]] | None = None
    matrix: tuple[tuple[float, float, float], tuple[float, float, float], tuple[float, float, float]] | None = None
    lut_size: int = 17


@dataclass(frozen=True)
class CalibrationResult:
    image: np.ndarray
    params: CalibrationParams
    mode: CalibrationMode
    pre_report: CastReport
    post_report: CastReport
    a_shift: float
    b_shift: float
    analysis_image: np.ndarray | None = None
    metadata: dict[str, float | str] = field(default_factory=dict)

    @property
    def reduction_pct(self) -> float:
        before = self.pre_report.lab.cast_strength
        after = self.post_report.lab.cast_strength
        return (1.0 - after / max(before, 0.01)) * 100.0


def _working_rgb(img_rgb: np.ndarray) -> tuple[np.ndarray, np.dtype, float]:
    img_rgb = ensure_rgb_image(img_rgb)
    if img_rgb.dtype == np.uint8:
        return img_rgb.astype(np.float32) / 255.0, img_rgb.dtype, 255.0
    if np.issubdtype(img_rgb.dtype, np.integer):
        info = np.iinfo(img_rgb.dtype)
        scale = float(info.max) if info.max > 0 else 1.0
        return img_rgb.astype(np.float32) / scale, img_rgb.dtype, scale
    rgb_float = img_rgb.astype(np.float32, copy=False)
    if rgb_float.size == 0:
        return rgb_float, np.float32, 1.0
    max_value = float(rgb_float.max())
    min_value = float(rgb_float.min())
    if min_value >= 0.0 and max_value <= 1.0:
        return rgb_float, img_rgb.dtype, 1.0
    scale = max(max_value, 1.0)
    return np.clip(rgb_float / scale, 0.0, 1.0), img_rgb.dtype, scale


def _to_calibration_working_space(
    img_rgb: np.ndarray,
    *,
    color_space: str = "sRGB",
    data_range: tuple[float, float] | None = None,
) -> tuple[np.ndarray, dict[str, object]]:
    working, dtype, scale = _working_rgb(img_rgb)
    branch = "display-referred"
    hdr_reference = 1.0
    if color_space.lower() == "linear":
        branch = "scene-linear-display-referred"
        if data_range is not None and data_range[1] > 1.0:
            hdr_reference = max(float(np.percentile(working, 99.5)), 1.0)
            working = np.clip(working / hdr_reference, 0.0, 1.0)
            branch = "scene-linear-hdr-display-referred"
        working = np.power(np.clip(working, 0.0, 1.0), 1.0 / 2.2).astype(np.float32)
    elif data_range is not None and data_range[1] > 1.0 and np.issubdtype(img_rgb.dtype, np.floating):
        hdr_reference = max(float(np.percentile(working, 99.5)), 1.0)
        working = np.clip(working / hdr_reference, 0.0, 1.0)
        branch = "hdr-display-referred"
    return working, {
        "dtype": dtype,
        "scale": scale,
        "color_space": color_space,
        "data_range": data_range,
        "hdr_reference": hdr_reference,
        "working_branch": branch,
    }


def _from_calibration_working_space(corrected: np.ndarray, context: dict[str, object]) -> np.ndarray:
    working = np.clip(corrected.astype(np.float32, copy=False), 0.0, 1.0)
    color_space = str(context.get("color_space", "sRGB"))
    hdr_reference = float(context.get("hdr_reference", 1.0))
    if color_space.lower() == "linear":
        working = np.power(working, 2.2).astype(np.float32)
        if hdr_reference > 1.0:
            working = working * hdr_reference
    elif hdr_reference > 1.0:
        working = working * hdr_reference
    return _restore_dtype(working, context["dtype"], float(context["scale"]))


def _restore_dtype(rgb_float: np.ndarray, dtype: np.dtype, scale: float) -> np.ndarray:
    rgb_float = np.clip(rgb_float.astype(np.float32, copy=False), 0.0, 1.0)
    if dtype == np.uint8:
        return np.clip(np.rint(rgb_float * 255.0), 0, 255).astype(np.uint8)
    if np.issubdtype(dtype, np.integer):
        max_value = float(np.iinfo(dtype).max)
        return np.clip(np.rint(rgb_float * max_value), 0, max_value).astype(dtype)
    restored = rgb_float * float(scale)
    return restored.astype(np.float32 if dtype == np.float32 else dtype, copy=False)


def _lab_shift(img_rgb: np.ndarray, a_delta: np.ndarray | float, b_delta: np.ndarray | float) -> np.ndarray:
    lab = rgb_to_lab_float(img_rgb)
    lab[:, :, 1] += a_delta
    lab[:, :, 2] += b_delta
    lab[:, :, 0] = np.clip(lab[:, :, 0], 0, 100)
    rgb_float, dtype, scale = _working_rgb(img_rgb)
    corrected = ACCELERATOR.lab_to_rgb_float(lab)
    return _restore_dtype(corrected, dtype, scale)


def calibrate_global(
    img_rgb: np.ndarray,
    a_shift: float,
    b_shift: float,
    strength: float = DEFAULT_STRENGTH,
) -> np.ndarray:
    return _lab_shift(img_rgb, a_shift * strength, b_shift * strength)


def calibrate_midtones_only(
    img_rgb: np.ndarray,
    a_shift: float,
    b_shift: float,
    strength: float = DEFAULT_STRENGTH,
) -> np.ndarray:
    lab = rgb_to_lab_float(img_rgb)
    l_ch = lab[:, :, 0]
    mid_lo = np.percentile(l_ch, 30)
    mid_hi = np.percentile(l_ch, 70)
    mask = (l_ch >= mid_lo) & (l_ch <= mid_hi)
    weight = cv2.GaussianBlur(mask.astype(np.float32), (51, 51), 20)
    lab[:, :, 1] += a_shift * strength * weight
    lab[:, :, 2] += b_shift * strength * weight
    lab[:, :, 0] = np.clip(lab[:, :, 0], 0, 100)
    _, dtype, scale = _working_rgb(img_rgb)
    return _restore_dtype(ACCELERATOR.lab_to_rgb_float(lab), dtype, scale)


def calibrate_skin_priority(
    img_rgb: np.ndarray,
    a_shift: float,
    b_shift: float,
    strength: float = DEFAULT_STRENGTH,
) -> np.ndarray:
    img_rgb_u8 = ensure_uint8_rgb(img_rgb)
    lab = rgb_to_lab_float(img_rgb)
    hsv = ACCELERATOR.rgb_to_hsv(img_rgb_u8)
    skin_mask = (
        (hsv[:, :, 0] >= 0)
        & (hsv[:, :, 0] <= 25)
        & (hsv[:, :, 1] >= 10)
        & (hsv[:, :, 1] <= 150)
        & (hsv[:, :, 2] >= 50)
        & (hsv[:, :, 2] <= 255)
    ).astype(np.float32)
    weight = cv2.GaussianBlur(skin_mask, (61, 61), 30)
    weight = weight * 0.7 + 0.3
    lab[:, :, 1] += a_shift * strength * weight
    lab[:, :, 2] += b_shift * strength * weight
    lab[:, :, 0] = np.clip(lab[:, :, 0], 0, 100)
    _, dtype, scale = _working_rgb(img_rgb)
    return _restore_dtype(ACCELERATOR.lab_to_rgb_float(lab), dtype, scale)


def calibrate_highlights_only(
    img_rgb: np.ndarray,
    a_shift: float,
    b_shift: float,
    strength: float = DEFAULT_STRENGTH,
    highlight_pct: float = 55.0,
    sat_pct: float = 25.0,
) -> np.ndarray:
    img_rgb_u8 = ensure_uint8_rgb(img_rgb)
    lab = rgb_to_lab_float(img_rgb)
    l_ch = lab[:, :, 0]
    hsv = ACCELERATOR.rgb_to_hsv(img_rgb_u8)
    s_ch = hsv[:, :, 1].astype(float)
    l_threshold = np.percentile(l_ch, highlight_pct)
    s_threshold = np.percentile(s_ch, sat_pct)
    target_mask = ((l_ch >= l_threshold) & (s_ch <= s_threshold)).astype(np.float32)
    weight = cv2.GaussianBlur(target_mask, (31, 31), 15)
    weight = np.clip(weight, 0, 1.0)
    lab[:, :, 1] += a_shift * strength * weight
    lab[:, :, 2] += b_shift * strength * weight
    lab[:, :, 0] = np.clip(lab[:, :, 0], 0, 100)
    _, dtype, scale = _working_rgb(img_rgb)
    return _restore_dtype(ACCELERATOR.lab_to_rgb_float(lab), dtype, scale)


def calibrate_preserve_split_tone(
    img_rgb: np.ndarray,
    a_shift: float,
    b_shift: float,
    strength: float = DEFAULT_STRENGTH,
) -> np.ndarray:
    lab = rgb_to_lab_float(img_rgb)
    l_ch = lab[:, :, 0]
    lo_thr = np.percentile(l_ch, 5)
    hi_thr = np.percentile(l_ch, 95)
    mid_lo = np.percentile(l_ch, 40)
    mid_hi = np.percentile(l_ch, 60)
    shadow_mask = (l_ch <= lo_thr).astype(np.float32)
    midtone_mask = ((l_ch >= mid_lo) & (l_ch <= mid_hi)).astype(np.float32)
    highlight_mask = (l_ch >= hi_thr).astype(np.float32)
    shadow_w = cv2.GaussianBlur(shadow_mask, (31, 31), 15)
    midtone_w = cv2.GaussianBlur(midtone_mask, (31, 31), 15)
    highlight_w = cv2.GaussianBlur(highlight_mask, (31, 31), 15)
    weight = np.clip(midtone_w + shadow_w * 0.3 + highlight_w * 0.3, 0, 1.0)
    lab[:, :, 1] += a_shift * strength * weight
    lab[:, :, 2] += b_shift * strength * weight
    lab[:, :, 0] = np.clip(lab[:, :, 0], 0, 100)
    _, dtype, scale = _working_rgb(img_rgb)
    return _restore_dtype(ACCELERATOR.lab_to_rgb_float(lab), dtype, scale)


def curve_interpolate(
    control_points: list[list[float]],
    num_entries: int = 256,
) -> np.ndarray:
    """Build a 256-entry uint8 LUT from control points using monotonic cubic interpolation.

    Control points are ``[[x0, y0], [x1, y1], ...]`` where x is input (0-255)
    and y is output (0-255).  At least 2 points required.  The interpolation
    is monotonic (preserves ordering of control points) and C1 continuous.

    Returns a uint8 ndarray of shape (num_entries,).
    """
    if len(control_points) < 2:
        raise ValueError("curve_interpolate requires at least 2 control points")

    pts = np.asarray(control_points, dtype=np.float64)
    xs = pts[:, 0]
    ys = pts[:, 1]

    # Sort by x
    order = np.argsort(xs)
    xs = xs[order]
    ys = ys[order]

    # Monotonic cubic Hermite spline (Fritsch-Carlson)
    n = len(xs)
    dx = np.diff(xs)
    dy = np.diff(ys)
    slopes = dy / np.where(np.abs(dx) > 1e-12, dx, 1.0)

    # Compute tangents (derivatives) at each knot
    m = np.zeros(n, dtype=np.float64)
    if n == 2:
        m[0] = slopes[0]
        m[-1] = slopes[-1]
    else:
        # Initialise with centred differences
        m[1:-1] = (slopes[:-1] + slopes[1:]) / 2.0
        m[0] = slopes[0]
        m[-1] = slopes[-1]

        # Fritsch-Carlson monotonicity enforcement
        for i in range(n - 1):
            if np.abs(slopes[i]) < 1e-12:
                m[i] = 0.0
                m[i + 1] = 0.0
            else:
                alpha = m[i] / slopes[i]
                beta = m[i + 1] / slopes[i]
                t = np.sqrt(alpha * alpha + beta * beta)
                if t > 3.0:
                    m[i] = 3.0 * alpha / t * slopes[i]
                    m[i + 1] = 3.0 * beta / t * slopes[i]

    # Evaluate the piecewise cubic on the output grid
    x_out = np.linspace(0, 255, num_entries, dtype=np.float64)
    y_out = np.zeros(num_entries, dtype=np.float64)

    for i in range(n - 1):
        t = (x_out - xs[i]) / max(dx[i], 1e-12)
        mask = (x_out >= xs[i]) & (x_out <= xs[i + 1])
        if not np.any(mask):
            continue
        tt = t[mask]
        h00 = (1.0 + 2.0 * tt) * (1.0 - tt) ** 2
        h10 = tt * (1.0 - tt) ** 2
        h01 = tt ** 2 * (3.0 - 2.0 * tt)
        h11 = tt ** 2 * (tt - 1.0)
        y_out[mask] = (
            h00 * ys[i]
            + h10 * m[i] * dx[i]
            + h01 * ys[i + 1]
            + h11 * m[i + 1] * dx[i]
        )

    # Edge extrapolation: hold first/last values
    y_out[x_out < xs[0]] = ys[0]
    y_out[x_out > xs[-1]] = ys[-1]

    return np.clip(np.rint(y_out), 0, 255).astype(np.uint8)


def calibrate_rgb_curves(
    img_rgb: np.ndarray,
    strength: float = DEFAULT_STRENGTH,
    low_pct: float = 1.0,
    high_pct: float = 99.0,
    gamma: tuple[float, float, float] | None = None,
    r_curve: list[list[float]] | None = None,
    g_curve: list[list[float]] | None = None,
    b_curve: list[list[float]] | None = None,
) -> np.ndarray:
    """Per-channel black/white/gamma correction for film layer mismatch.

    When explicit control points are provided (r_curve/g_curve/b_curve),
    each channel uses a monotonic cubic spline LUT built from those points
    instead of the auto-estimated black/white/gamma correction.
    """

    src, dtype, scale = _working_rgb(img_rgb)
    luts: list[np.ndarray] = []
    curves = [r_curve, g_curve, b_curve]

    for ch in range(3):
        ctrl = curves[ch]
        if ctrl is not None and len(ctrl) >= 2:
            # Manual curve: build LUT from control points
            lut = curve_interpolate(ctrl).astype(np.float32)
            identity = np.linspace(0, 255, 256, dtype=np.float32)
            lut = identity * (1.0 - strength) + lut * strength
            luts.append(np.clip(np.rint(lut), 0, 255).astype(np.uint8))
        else:
            # Auto curve: existing behaviour
            gamma_values = gamma or _estimate_channel_gamma(src)
            low = float(np.percentile(src[:, :, ch], low_pct))
            high = float(np.percentile(src[:, :, ch], high_pct))
            axis = np.linspace(0, 1, 256, dtype=np.float32)
            if high <= low + 1e-6:
                curve = axis
            else:
                curve = np.clip((axis - low) / (high - low), 0, 1)
            curve = np.power(curve, 1.0 / max(gamma_values[ch], 1e-3))
            blended = axis * (1.0 - strength) + curve * strength
            luts.append(np.clip(blended * 255.0, 0, 255).astype(np.uint8))

    corrected_u8 = ACCELERATOR.apply_channel_luts(np.clip(np.rint(src * 255.0), 0, 255).astype(np.uint8), luts)
    return _restore_dtype(corrected_u8.astype(np.float32) / 255.0, dtype, scale)


def _estimate_channel_gamma(src: np.ndarray) -> tuple[float, float, float]:
    gammas: list[float] = []
    target_mid = 0.5
    for ch in range(3):
        mid = float(np.percentile(src[:, :, ch], 50))
        if 0.05 < mid < 0.95:
            gamma = np.log(target_mid) / np.log(mid)
            gammas.append(float(np.clip(gamma, 0.65, 1.55)))
        else:
            gammas.append(1.0)
    return tuple(gammas)  # type: ignore[return-value]


def calibrate_tone_zone(
    img_rgb: np.ndarray,
    strength: float = DEFAULT_STRENGTH,
) -> np.ndarray:
    """Correct shadows/midtones/highlights independently in Lab."""

    lab = rgb_to_lab_float(img_rgb)
    l_ch = lab[:, :, 0]
    zones = [
        (l_ch <= np.percentile(l_ch, 25), 0.45),
        ((l_ch > np.percentile(l_ch, 25)) & (l_ch < np.percentile(l_ch, 75)), 0.75),
        (l_ch >= np.percentile(l_ch, 75), 0.55),
    ]
    total_weight = np.zeros(l_ch.shape, dtype=np.float32)
    a_delta = np.zeros(l_ch.shape, dtype=np.float32)
    b_delta = np.zeros(l_ch.shape, dtype=np.float32)
    for mask, zone_strength in zones:
        if int(mask.sum()) < 100:
            continue
        a_mean = float(lab[:, :, 1][mask].mean())
        b_mean = float(lab[:, :, 2][mask].mean())
        weight = cv2.GaussianBlur(mask.astype(np.float32), (41, 41), 18)
        total_weight += weight
        a_delta += -a_mean * zone_strength * weight
        b_delta += -b_mean * zone_strength * weight
    total_weight = np.maximum(total_weight, 1e-6)
    lab[:, :, 1] += a_delta / total_weight * strength
    lab[:, :, 2] += b_delta / total_weight * strength
    lab[:, :, 0] = np.clip(lab[:, :, 0], 0, 100)
    _, dtype, scale = _working_rgb(img_rgb)
    return _restore_dtype(ACCELERATOR.lab_to_rgb_float(lab), dtype, scale)


def estimate_color_matrix(img_rgb: np.ndarray) -> np.ndarray:
    """Estimate a conservative 3x3 channel matrix from low-saturation pixels."""

    img_rgb_u8 = ensure_uint8_rgb(img_rgb)
    hsv = ACCELERATOR.rgb_to_hsv(img_rgb_u8)
    neutral = hsv[:, :, 1] <= min(float(np.percentile(hsv[:, :, 1], 35)), 48.0)
    src, _, _ = _working_rgb(img_rgb)
    pixels = src[neutral] if int(neutral.sum()) >= 100 else src.reshape(-1, 3)
    means = pixels.astype(np.float32).mean(axis=0)
    target = float(means.mean())
    gains = np.clip(target / np.maximum(means, 1e-6), 0.7, 1.35)
    matrix = np.diag(gains)
    # Gentle cross-talk damping to reduce excessive film dye separation.
    mix = np.array([[0.96, 0.02, 0.02], [0.02, 0.96, 0.02], [0.02, 0.02, 0.96]], dtype=np.float32)
    return mix @ matrix.astype(np.float32)


def apply_color_matrix(
    img_rgb: np.ndarray,
    matrix: np.ndarray | None = None,
    strength: float = DEFAULT_STRENGTH,
) -> np.ndarray:
    src, dtype, scale = _working_rgb(img_rgb)
    mat = estimate_color_matrix(img_rgb) if matrix is None else np.asarray(matrix, dtype=np.float32)
    corrected = ACCELERATOR.apply_color_matrix(src, mat)
    out = src * (1.0 - strength) + corrected * strength
    return _restore_dtype(out, dtype, scale)


def build_identity_lut(size: int = 17) -> np.ndarray:
    axis = np.linspace(0, 1, size, dtype=np.float32)
    r, g, b = np.meshgrid(axis, axis, axis, indexing="ij")
    return np.stack([r, g, b], axis=-1)


def build_auto_lut(img_rgb: np.ndarray, size: int = 17) -> np.ndarray:
    lut = build_identity_lut(size)
    matrix = estimate_color_matrix(img_rgb)
    shaped = np.power(lut, np.array([0.98, 1.0, 1.03], dtype=np.float32))
    return np.clip(np.tensordot(shaped, matrix.T, axes=1), 0, 1).astype(np.float32)


def apply_3d_lut(
    img_rgb: np.ndarray,
    lut: np.ndarray | None = None,
    strength: float = DEFAULT_STRENGTH,
    size: int = 17,
) -> np.ndarray:
    src, dtype, scale = _working_rgb(img_rgb)
    table = build_auto_lut(img_rgb, size=size) if lut is None else lut.astype(np.float32)
    out = ACCELERATOR.apply_3d_lut(src, table, strength)
    return _restore_dtype(out, dtype, scale)


def calibrate_selective(
    img_rgb: np.ndarray,
    strength: float = DEFAULT_STRENGTH,
) -> np.ndarray:
    """Apply subject-aware gentle corrections for skin, sky, and foliage."""

    img_rgb_u8 = ensure_uint8_rgb(img_rgb)
    lab = rgb_to_lab_float(img_rgb)
    hsv = ACCELERATOR.rgb_to_hsv(img_rgb_u8)
    h, s, v = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]
    masks = [
        (((h <= 25) & (s >= 10) & (s <= 155) & (v >= 45)), (1.2, 2.0), 0.35),  # skin warmer
        (((h >= 85) & (h <= 125) & (s >= 25)), (-0.3, -1.2), 0.25),  # sky/cyan
        (((h >= 35) & (h <= 85) & (s >= 25)), (-1.0, 0.4), 0.25),  # foliage
    ]
    for mask, (a_target, b_target), local_strength in masks:
        if int(mask.sum()) < 100:
            continue
        weight = cv2.GaussianBlur(mask.astype(np.float32), (31, 31), 12)
        current_a = float(lab[:, :, 1][mask].mean())
        current_b = float(lab[:, :, 2][mask].mean())
        lab[:, :, 1] += (a_target - current_a) * local_strength * strength * weight
        lab[:, :, 2] += (b_target - current_b) * local_strength * strength * weight
    lab[:, :, 0] = np.clip(lab[:, :, 0], 0, 100)
    _, dtype, scale = _working_rgb(img_rgb)
    return _restore_dtype(ACCELERATOR.lab_to_rgb_float(lab), dtype, scale)


def preserve_luminance(
    original_rgb: np.ndarray,
    corrected_rgb: np.ndarray,
    amount: float = 0.65,
) -> np.ndarray:
    """Blend corrected color back toward the original Lab lightness channel."""

    ensure_rgb_image(original_rgb)
    ensure_rgb_image(corrected_rgb)
    if original_rgb.shape != corrected_rgb.shape:
        raise ValueError("original and corrected images must have the same shape")
    original_lab = rgb_to_lab_float(original_rgb)
    corrected_lab = rgb_to_lab_float(corrected_rgb)
    amount = float(np.clip(amount, 0.0, 1.0))
    corrected_lab[:, :, 0] = corrected_lab[:, :, 0] * (1.0 - amount) + original_lab[:, :, 0] * amount
    _, dtype, scale = _working_rgb(corrected_rgb)
    return _restore_dtype(ACCELERATOR.lab_to_rgb_float(corrected_lab), dtype, scale)


def calibrate_film(
    img_rgb: np.ndarray,
    strength: float = DEFAULT_STRENGTH,
) -> np.ndarray:
    """Composite film mode: RGB curves, matrix, tone-zone, and selective tuning."""

    curved = calibrate_rgb_curves(img_rgb, strength=min(strength, 0.5), low_pct=0.5, high_pct=99.5)
    matrixed = apply_color_matrix(curved, strength=min(strength, 0.4))
    zoned = calibrate_tone_zone(matrixed, strength=min(strength, 0.4))
    selective = calibrate_selective(zoned, strength=min(strength, 0.35))
    return preserve_luminance(img_rgb, selective, amount=0.7)


def calibrate_negative_film(
    img_rgb: np.ndarray,
    strength: float = DEFAULT_STRENGTH,
) -> np.ndarray:
    """Convert a color negative into a positive image and refine its balance."""

    balanced_img = prepare_negative_film_base(img_rgb)
    return refine_negative_film_positive(balanced_img, strength=strength)


def refine_negative_film_positive(
    img_rgb: np.ndarray,
    strength: float = DEFAULT_STRENGTH,
) -> np.ndarray:
    """Apply a mild positive-film refinement after negative inversion/mask removal."""

    matrixed = apply_color_matrix(img_rgb, strength=min(0.22, 0.08 + strength * 0.1))
    zoned = calibrate_tone_zone(matrixed, strength=min(0.18, 0.06 + strength * 0.08))
    return preserve_luminance(img_rgb, zoned, amount=0.1)


def prepare_negative_film_base(img_rgb: np.ndarray) -> np.ndarray:
    """Remove film-base color mask and invert a negative into a positive baseline.

    This is intentionally separate from the creative/refinement step so analysis
    and subsequent manual grading can use the positive image as their reference.
    """

    src, dtype, scale = _working_rgb(img_rgb)
    height, width = src.shape[:2]
    margin = max(16, min(height, width) // 20)
    strips = np.concatenate(
        [
            src[:margin, :, :].reshape(-1, 3),
            src[-margin:, :, :].reshape(-1, 3),
            src[:, :margin, :].reshape(-1, 3),
            src[:, -margin:, :].reshape(-1, 3),
        ],
        axis=0,
    )
    strip_luminance = strips.mean(axis=1)
    film_base = strips[strip_luminance >= np.percentile(strip_luminance, 85)].mean(axis=0).astype(np.float32)
    normalized = np.clip(src / np.maximum(film_base.reshape(1, 1, 3), 1e-4), 0.0, 1.0)
    positive = np.clip(1.0 - normalized, 0.0, 1.0)

    low = np.percentile(positive, 0.5, axis=(0, 1)).astype(np.float32)
    high = np.percentile(positive, 99.5, axis=(0, 1)).astype(np.float32)
    span = np.maximum(high - low, 1e-4)
    leveled = np.clip((positive - low.reshape(1, 1, 3)) / span.reshape(1, 1, 3), 0.0, 1.0)

    luminance = np.percentile(leveled, 85, axis=2)
    highlight_mask = luminance >= np.percentile(luminance, 60)
    if int(highlight_mask.sum()) >= 256:
        means = leveled[highlight_mask].mean(axis=0)
    else:
        means = leveled.reshape(-1, 3).mean(axis=0)
    target = float(np.median(means))
    gains = np.clip(target / np.maximum(means, 1e-4), 0.7, 1.6).astype(np.float32)
    balanced = np.clip(leveled * gains.reshape(1, 1, 3), 0.0, 1.0)

    mid = float(np.percentile(balanced.mean(axis=2), 50))
    if 0.05 < mid < 0.95:
        gamma = float(np.clip(np.log(0.45) / np.log(max(mid, 1e-4)), 0.85, 1.2))
        balanced = np.power(np.clip(balanced, 0.0, 1.0), 1.0 / gamma).astype(np.float32)

    return _restore_dtype(balanced, dtype, scale)


def make_comparison(original: np.ndarray, calibrated: np.ndarray) -> np.ndarray:
    original_u8 = ensure_uint8_rgb(original)
    calibrated_u8 = ensure_uint8_rgb(calibrated)
    h = max(original.shape[0], calibrated.shape[0])
    if original_u8.shape[0] != h:
        w = int(original_u8.shape[1] * h / original_u8.shape[0])
        original_u8 = ACCELERATOR.resize_area(original_u8, (w, h))
    if calibrated_u8.shape[0] != h:
        w = int(calibrated_u8.shape[1] * h / calibrated_u8.shape[0])
        calibrated_u8 = ACCELERATOR.resize_area(calibrated_u8, (w, h))
    side = np.hstack([original_u8, calibrated_u8])
    cv2.putText(side, "ORIGINAL", (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (255, 255, 255), 2)
    cv2.putText(
        side,
        "CALIBRATED",
        (original_u8.shape[1] + 20, 40),
        cv2.FONT_HERSHEY_SIMPLEX,
        1.0,
        (255, 255, 255),
        2,
    )
    return side


def calibrate_image_from_analysis(
    img_rgb: np.ndarray,
    params: CalibrationParams,
    pre_report: CastReport,
    zones: dict[str, object],
    *,
    color_space: str = "sRGB",
    data_range: tuple[float, float] | None = None,
    reuse_input_analysis: bool = False,
    analyze_output: bool = True,
) -> CalibrationResult:
    working_img, working_context = _to_calibration_working_space(
        img_rgb,
        color_space=color_space,
        data_range=data_range,
    )
    analysis_image: np.ndarray | None = None
    can_reuse_analysis = (
        reuse_input_analysis
        and working_context["working_branch"] == "display-referred"
        and working_img.shape[:2] == img_rgb.shape[:2]
        and params.mode != CalibrationMode.NEGATIVE_FILM
    )
    if params.mode == CalibrationMode.NEGATIVE_FILM and not reuse_input_analysis:
        negative_base_working = prepare_negative_film_base(working_img)
        analysis_image = _from_calibration_working_space(negative_base_working, working_context)
        working_pre_report = analyze_image_array(analysis_image)
        working_zones = auto_detect_cast(analysis_image)
    else:
        working_pre_report = pre_report if can_reuse_analysis else analyze_image_array(working_img)
        working_zones = zones if can_reuse_analysis else auto_detect_cast(working_img)
    estimate_cast = working_zones.get("neutral", working_zones["global"])
    manual_shift = params.a_shift is not None or params.b_shift is not None
    auto_cast_source = "neutral" if "neutral" in working_zones else "global"
    a_shift = params.a_shift if params.a_shift is not None else -estimate_cast.a_mean
    b_shift = params.b_shift if params.b_shift is not None else -estimate_cast.b_mean
    if not manual_shift and float(np.hypot(a_shift, b_shift)) < 1.0:
        a_shift = 0.0
        b_shift = 0.0
        auto_cast_source = f"{auto_cast_source}-skipped-low-magnitude"

    if abs(float(a_shift)) < 1e-9 and abs(float(b_shift)) < 1e-9:
        if params.mode == CalibrationMode.RGB_CURVES:
            calibrated_working = calibrate_rgb_curves(
                working_img,
                params.strength,
                params.curve_low_pct,
                params.curve_high_pct,
                params.gamma,
                r_curve=params.r_curve,
                g_curve=params.g_curve,
                b_curve=params.b_curve,
            )
        elif params.mode == CalibrationMode.TONE_ZONE:
            calibrated_working = calibrate_tone_zone(working_img, params.strength)
        elif params.mode == CalibrationMode.MATRIX:
            calibrated_working = apply_color_matrix(
                working_img,
                np.asarray(params.matrix, dtype=np.float32) if params.matrix is not None else None,
                params.strength,
            )
        elif params.mode == CalibrationMode.LUT3D:
            calibrated_working = apply_3d_lut(working_img, strength=params.strength, size=params.lut_size)
        elif params.mode == CalibrationMode.SELECTIVE:
            calibrated_working = calibrate_selective(working_img, params.strength)
        elif params.mode == CalibrationMode.FILM:
            calibrated_working = calibrate_film(working_img, params.strength)
        elif params.mode == CalibrationMode.NEGATIVE_FILM:
            calibrated_working = calibrate_negative_film(working_img, params.strength)
        else:
            calibrated_working = working_img.copy()
    elif params.mode == CalibrationMode.GLOBAL:
        calibrated_working = calibrate_global(working_img, a_shift, b_shift, params.strength)
    elif params.mode == CalibrationMode.MIDTONES_ONLY:
        calibrated_working = calibrate_midtones_only(working_img, a_shift, b_shift, params.strength)
    elif params.mode == CalibrationMode.SKIN_PRIORITY:
        calibrated_working = calibrate_skin_priority(working_img, a_shift, b_shift, params.strength)
    elif params.mode == CalibrationMode.HIGHLIGHTS_ONLY:
        calibrated_working = calibrate_highlights_only(
            working_img,
            a_shift,
            b_shift,
            params.strength,
            params.highlight_pct,
            params.sat_pct,
        )
    elif params.mode == CalibrationMode.PRESERVE_SPLIT_TONE:
        calibrated_working = calibrate_preserve_split_tone(working_img, a_shift, b_shift, params.strength)
    elif params.mode == CalibrationMode.RGB_CURVES:
        calibrated_working = calibrate_rgb_curves(
            working_img,
            params.strength,
            params.curve_low_pct,
            params.curve_high_pct,
            params.gamma,
            r_curve=params.r_curve,
            g_curve=params.g_curve,
            b_curve=params.b_curve,
        )
    elif params.mode == CalibrationMode.TONE_ZONE:
        calibrated_working = calibrate_tone_zone(working_img, params.strength)
    elif params.mode == CalibrationMode.MATRIX:
        calibrated_working = apply_color_matrix(
            working_img,
            np.asarray(params.matrix, dtype=np.float32) if params.matrix is not None else None,
            params.strength,
        )
    elif params.mode == CalibrationMode.LUT3D:
        calibrated_working = apply_3d_lut(working_img, strength=params.strength, size=params.lut_size)
    elif params.mode == CalibrationMode.SELECTIVE:
        calibrated_working = calibrate_selective(working_img, params.strength)
    elif params.mode == CalibrationMode.FILM:
        calibrated_working = calibrate_film(working_img, params.strength)
    elif params.mode == CalibrationMode.NEGATIVE_FILM:
        calibrated_working = calibrate_negative_film(working_img, params.strength)
    else:
        raise ValueError(f"Unsupported calibration mode: {params.mode}")

    # Post-process: apply RGB curves on top of auto-calibration result
    if params.mode != CalibrationMode.RGB_CURVES:
        has_curves = (
            params.r_curve is not None
            or params.g_curve is not None
            or params.b_curve is not None
        )
        if has_curves:
            calibrated_working = calibrate_rgb_curves(
                calibrated_working,
                params.strength,
                params.curve_low_pct,
                params.curve_high_pct,
                params.gamma,
                r_curve=params.r_curve,
                g_curve=params.g_curve,
                b_curve=params.b_curve,
            )

    calibrated = _from_calibration_working_space(calibrated_working, working_context)
    post_report = analyze_image_array(calibrated) if analyze_output else working_pre_report
    return CalibrationResult(
        image=calibrated,
        params=params,
        mode=params.mode,
        pre_report=working_pre_report,
        post_report=post_report,
        a_shift=float(a_shift),
        b_shift=float(b_shift),
        analysis_image=analysis_image,
        metadata={
            "pre_cast_strength": working_pre_report.lab.cast_strength,
            "post_cast_strength": post_report.lab.cast_strength,
            "reduction_pct": (1.0 - post_report.lab.cast_strength / max(working_pre_report.lab.cast_strength, 0.01)) * 100.0,
            "auto_cast_source": auto_cast_source,
            "auto_cast_confidence": estimate_cast.confidence,
            "working_color_space": color_space,
            "working_branch": str(working_context["working_branch"]),
            "working_pre_cast_strength": working_pre_report.lab.cast_strength,
            "source_pre_cast_strength": pre_report.lab.cast_strength,
            **({"analysis_basis": "negative-positive-base"} if analysis_image is not None else {}),
        },
    )


def recalibrate_curves(
    working_img: np.ndarray,
    working_context: dict,
    params: CalibrationParams,
    calibrator: Callable[[np.ndarray], np.ndarray],
    pre_report: CastReport | None = None,
) -> np.ndarray:
    """Fast path: apply curves to cached working image without re-analysis.

    Skips analyze_image_array, auto_detect_cast, and post_report analysis.
    Only runs the calibration function + curve post-processing.
    """
    calibrated_working = calibrator(working_img)
    if params.mode != CalibrationMode.RGB_CURVES:
        has_curves = (
            params.r_curve is not None
            or params.g_curve is not None
            or params.b_curve is not None
        )
        if has_curves:
            calibrated_working = calibrate_rgb_curves(
                calibrated_working,
                params.strength,
                params.curve_low_pct,
                params.curve_high_pct,
                params.gamma,
                r_curve=params.r_curve,
                g_curve=params.g_curve,
                b_curve=params.b_curve,
            )
    result = _from_calibration_working_space(calibrated_working, working_context)
    return result


def calibrate_image(
    img_rgb: np.ndarray,
    params: CalibrationParams,
    *,
    color_space: str = "sRGB",
    data_range: tuple[float, float] | None = None,
) -> CalibrationResult:
    img_rgb = ensure_rgb_image(img_rgb)
    pre_report = analyze_image_array(img_rgb)
    zones = auto_detect_cast(img_rgb)
    return calibrate_image_from_analysis(
        img_rgb,
        params,
        pre_report,
        zones,
        color_space=color_space,
        data_range=data_range,
    )
