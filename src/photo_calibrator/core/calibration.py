from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

import cv2
import numpy as np

from .accelerator import ACCELERATOR
from .cast_detection import CastReport, analyze_image_array, auto_detect_cast, ensure_uint8_rgb, rgb_to_lab_float

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
    metadata: dict[str, float | str] = field(default_factory=dict)

    @property
    def reduction_pct(self) -> float:
        before = self.pre_report.lab.cast_strength
        after = self.post_report.lab.cast_strength
        return (1.0 - after / max(before, 0.01)) * 100.0


def _lab_shift(img_rgb: np.ndarray, a_delta: np.ndarray | float, b_delta: np.ndarray | float) -> np.ndarray:
    lab = rgb_to_lab_float(img_rgb)
    lab[:, :, 1] += a_delta
    lab[:, :, 2] += b_delta
    lab[:, :, 0] = np.clip(lab[:, :, 0], 0, 100)
    return ACCELERATOR.lab_to_rgb_uint8(lab)


def calibrate_global(
    img_rgb: np.ndarray,
    a_shift: float,
    b_shift: float,
    strength: float = DEFAULT_STRENGTH,
) -> np.ndarray:
    img_rgb = ensure_uint8_rgb(img_rgb)
    return _lab_shift(img_rgb, a_shift * strength, b_shift * strength)


def calibrate_midtones_only(
    img_rgb: np.ndarray,
    a_shift: float,
    b_shift: float,
    strength: float = DEFAULT_STRENGTH,
) -> np.ndarray:
    img_rgb = ensure_uint8_rgb(img_rgb)
    lab = rgb_to_lab_float(img_rgb)
    l_ch = lab[:, :, 0]
    mid_lo = np.percentile(l_ch, 30)
    mid_hi = np.percentile(l_ch, 70)
    mask = (l_ch >= mid_lo) & (l_ch <= mid_hi)
    weight = cv2.GaussianBlur(mask.astype(np.float32), (51, 51), 20)
    lab[:, :, 1] += a_shift * strength * weight
    lab[:, :, 2] += b_shift * strength * weight
    lab[:, :, 0] = np.clip(lab[:, :, 0], 0, 100)
    return ACCELERATOR.lab_to_rgb_uint8(lab)


def calibrate_skin_priority(
    img_rgb: np.ndarray,
    a_shift: float,
    b_shift: float,
    strength: float = DEFAULT_STRENGTH,
) -> np.ndarray:
    img_rgb = ensure_uint8_rgb(img_rgb)
    lab = rgb_to_lab_float(img_rgb)
    hsv = ACCELERATOR.rgb_to_hsv(img_rgb)
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
    return ACCELERATOR.lab_to_rgb_uint8(lab)


def calibrate_highlights_only(
    img_rgb: np.ndarray,
    a_shift: float,
    b_shift: float,
    strength: float = DEFAULT_STRENGTH,
    highlight_pct: float = 55.0,
    sat_pct: float = 25.0,
) -> np.ndarray:
    img_rgb = ensure_uint8_rgb(img_rgb)
    lab = rgb_to_lab_float(img_rgb)
    l_ch = lab[:, :, 0]
    hsv = ACCELERATOR.rgb_to_hsv(img_rgb)
    s_ch = hsv[:, :, 1].astype(float)
    l_threshold = np.percentile(l_ch, highlight_pct)
    s_threshold = np.percentile(s_ch, sat_pct)
    target_mask = ((l_ch >= l_threshold) & (s_ch <= s_threshold)).astype(np.float32)
    weight = cv2.GaussianBlur(target_mask, (31, 31), 15)
    weight = np.clip(weight, 0, 1.0)
    lab[:, :, 1] += a_shift * strength * weight
    lab[:, :, 2] += b_shift * strength * weight
    lab[:, :, 0] = np.clip(lab[:, :, 0], 0, 100)
    return ACCELERATOR.lab_to_rgb_uint8(lab)


def calibrate_preserve_split_tone(
    img_rgb: np.ndarray,
    a_shift: float,
    b_shift: float,
    strength: float = DEFAULT_STRENGTH,
) -> np.ndarray:
    img_rgb = ensure_uint8_rgb(img_rgb)
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
    return ACCELERATOR.lab_to_rgb_uint8(lab)


def calibrate_rgb_curves(
    img_rgb: np.ndarray,
    strength: float = DEFAULT_STRENGTH,
    low_pct: float = 1.0,
    high_pct: float = 99.0,
    gamma: tuple[float, float, float] | None = None,
) -> np.ndarray:
    """Per-channel black/white/gamma correction for film layer mismatch."""

    img_rgb = ensure_uint8_rgb(img_rgb)
    src = img_rgb.astype(np.float32) / 255.0
    gamma_values = gamma or _estimate_channel_gamma(src)
    luts = []
    for ch in range(3):
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
    return ACCELERATOR.apply_channel_luts(img_rgb, luts)


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

    img_rgb = ensure_uint8_rgb(img_rgb)
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
    return ACCELERATOR.lab_to_rgb_uint8(lab)


def estimate_color_matrix(img_rgb: np.ndarray) -> np.ndarray:
    """Estimate a conservative 3x3 channel matrix from low-saturation pixels."""

    img_rgb = ensure_uint8_rgb(img_rgb)
    hsv = ACCELERATOR.rgb_to_hsv(img_rgb)
    neutral = hsv[:, :, 1] <= min(float(np.percentile(hsv[:, :, 1], 35)), 48.0)
    pixels = img_rgb[neutral] if int(neutral.sum()) >= 100 else img_rgb.reshape(-1, 3)
    means = pixels.astype(np.float32).mean(axis=0)
    target = float(means.mean())
    gains = np.clip(target / np.maximum(means, 1.0), 0.7, 1.35)
    matrix = np.diag(gains)
    # Gentle cross-talk damping to reduce excessive film dye separation.
    mix = np.array([[0.96, 0.02, 0.02], [0.02, 0.96, 0.02], [0.02, 0.02, 0.96]], dtype=np.float32)
    return mix @ matrix.astype(np.float32)


def apply_color_matrix(
    img_rgb: np.ndarray,
    matrix: np.ndarray | None = None,
    strength: float = DEFAULT_STRENGTH,
) -> np.ndarray:
    img_rgb = ensure_uint8_rgb(img_rgb)
    src = img_rgb.astype(np.float32) / 255.0
    mat = estimate_color_matrix(img_rgb) if matrix is None else np.asarray(matrix, dtype=np.float32)
    corrected = ACCELERATOR.apply_color_matrix(src, mat)
    out = src * (1.0 - strength) + corrected * strength
    return np.clip(out * 255.0, 0, 255).astype(np.uint8)


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
    img_rgb = ensure_uint8_rgb(img_rgb)
    src = img_rgb.astype(np.float32) / 255.0
    table = build_auto_lut(img_rgb, size=size) if lut is None else lut.astype(np.float32)
    out = ACCELERATOR.apply_3d_lut(src, table, strength)
    return np.clip(out * 255.0, 0, 255).astype(np.uint8)


def calibrate_selective(
    img_rgb: np.ndarray,
    strength: float = DEFAULT_STRENGTH,
) -> np.ndarray:
    """Apply subject-aware gentle corrections for skin, sky, and foliage."""

    img_rgb = ensure_uint8_rgb(img_rgb)
    lab = rgb_to_lab_float(img_rgb)
    hsv = ACCELERATOR.rgb_to_hsv(img_rgb)
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
    return ACCELERATOR.lab_to_rgb_uint8(lab)


def preserve_luminance(
    original_rgb: np.ndarray,
    corrected_rgb: np.ndarray,
    amount: float = 0.65,
) -> np.ndarray:
    """Blend corrected color back toward the original Lab lightness channel."""

    original_rgb = ensure_uint8_rgb(original_rgb)
    corrected_rgb = ensure_uint8_rgb(corrected_rgb)
    if original_rgb.shape != corrected_rgb.shape:
        raise ValueError("original and corrected images must have the same shape")
    original_lab = rgb_to_lab_float(original_rgb)
    corrected_lab = rgb_to_lab_float(corrected_rgb)
    amount = float(np.clip(amount, 0.0, 1.0))
    corrected_lab[:, :, 0] = corrected_lab[:, :, 0] * (1.0 - amount) + original_lab[:, :, 0] * amount
    return ACCELERATOR.lab_to_rgb_uint8(corrected_lab)


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


def make_comparison(original: np.ndarray, calibrated: np.ndarray) -> np.ndarray:
    original = ensure_uint8_rgb(original)
    calibrated = ensure_uint8_rgb(calibrated)
    h = max(original.shape[0], calibrated.shape[0])
    if original.shape[0] != h:
        w = int(original.shape[1] * h / original.shape[0])
        original = ACCELERATOR.resize_area(original, (w, h))
    if calibrated.shape[0] != h:
        w = int(calibrated.shape[1] * h / calibrated.shape[0])
        calibrated = ACCELERATOR.resize_area(calibrated, (w, h))
    side = np.hstack([original, calibrated])
    cv2.putText(side, "ORIGINAL", (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (255, 255, 255), 2)
    cv2.putText(
        side,
        "CALIBRATED",
        (original.shape[1] + 20, 40),
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
) -> CalibrationResult:
    img_rgb = ensure_uint8_rgb(img_rgb)
    estimate_cast = zones.get("neutral", zones["global"])
    manual_shift = params.a_shift is not None or params.b_shift is not None
    auto_cast_source = "neutral" if "neutral" in zones else "global"
    a_shift = params.a_shift if params.a_shift is not None else -estimate_cast.a_mean
    b_shift = params.b_shift if params.b_shift is not None else -estimate_cast.b_mean
    if not manual_shift and float(np.hypot(a_shift, b_shift)) < 1.0:
        a_shift = 0.0
        b_shift = 0.0
        auto_cast_source = f"{auto_cast_source}-skipped-low-magnitude"

    if abs(float(a_shift)) < 1e-9 and abs(float(b_shift)) < 1e-9:
        if params.mode == CalibrationMode.RGB_CURVES:
            calibrated = calibrate_rgb_curves(
                img_rgb,
                params.strength,
                params.curve_low_pct,
                params.curve_high_pct,
                params.gamma,
            )
        elif params.mode == CalibrationMode.TONE_ZONE:
            calibrated = calibrate_tone_zone(img_rgb, params.strength)
        elif params.mode == CalibrationMode.MATRIX:
            calibrated = apply_color_matrix(
                img_rgb,
                np.asarray(params.matrix, dtype=np.float32) if params.matrix is not None else None,
                params.strength,
            )
        elif params.mode == CalibrationMode.LUT3D:
            calibrated = apply_3d_lut(img_rgb, strength=params.strength, size=params.lut_size)
        elif params.mode == CalibrationMode.SELECTIVE:
            calibrated = calibrate_selective(img_rgb, params.strength)
        elif params.mode == CalibrationMode.FILM:
            calibrated = calibrate_film(img_rgb, params.strength)
        else:
            calibrated = img_rgb.copy()
    elif params.mode == CalibrationMode.GLOBAL:
        calibrated = calibrate_global(img_rgb, a_shift, b_shift, params.strength)
    elif params.mode == CalibrationMode.MIDTONES_ONLY:
        calibrated = calibrate_midtones_only(img_rgb, a_shift, b_shift, params.strength)
    elif params.mode == CalibrationMode.SKIN_PRIORITY:
        calibrated = calibrate_skin_priority(img_rgb, a_shift, b_shift, params.strength)
    elif params.mode == CalibrationMode.HIGHLIGHTS_ONLY:
        calibrated = calibrate_highlights_only(
            img_rgb,
            a_shift,
            b_shift,
            params.strength,
            params.highlight_pct,
            params.sat_pct,
        )
    elif params.mode == CalibrationMode.PRESERVE_SPLIT_TONE:
        calibrated = calibrate_preserve_split_tone(img_rgb, a_shift, b_shift, params.strength)
    elif params.mode == CalibrationMode.RGB_CURVES:
        calibrated = calibrate_rgb_curves(
            img_rgb,
            params.strength,
            params.curve_low_pct,
            params.curve_high_pct,
            params.gamma,
        )
    elif params.mode == CalibrationMode.TONE_ZONE:
        calibrated = calibrate_tone_zone(img_rgb, params.strength)
    elif params.mode == CalibrationMode.MATRIX:
        calibrated = apply_color_matrix(
            img_rgb,
            np.asarray(params.matrix, dtype=np.float32) if params.matrix is not None else None,
            params.strength,
        )
    elif params.mode == CalibrationMode.LUT3D:
        calibrated = apply_3d_lut(img_rgb, strength=params.strength, size=params.lut_size)
    elif params.mode == CalibrationMode.SELECTIVE:
        calibrated = calibrate_selective(img_rgb, params.strength)
    elif params.mode == CalibrationMode.FILM:
        calibrated = calibrate_film(img_rgb, params.strength)
    else:
        raise ValueError(f"Unsupported calibration mode: {params.mode}")

    post_report = analyze_image_array(calibrated)
    return CalibrationResult(
        image=calibrated,
        params=params,
        mode=params.mode,
        pre_report=pre_report,
        post_report=post_report,
        a_shift=float(a_shift),
        b_shift=float(b_shift),
        metadata={
            "pre_cast_strength": pre_report.lab.cast_strength,
            "post_cast_strength": post_report.lab.cast_strength,
            "reduction_pct": (1.0 - post_report.lab.cast_strength / max(pre_report.lab.cast_strength, 0.01)) * 100.0,
            "auto_cast_source": auto_cast_source,
            "auto_cast_confidence": estimate_cast.confidence,
        },
    )


def calibrate_image(img_rgb: np.ndarray, params: CalibrationParams) -> CalibrationResult:
    img_rgb = ensure_uint8_rgb(img_rgb)
    pre_report = analyze_image_array(img_rgb)
    zones = auto_detect_cast(img_rgb)
    return calibrate_image_from_analysis(img_rgb, params, pre_report, zones)
