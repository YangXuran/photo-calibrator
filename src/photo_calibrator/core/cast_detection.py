from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np

from .accelerator import ACCELERATOR

THRESHOLD_MODERATE = 3.0
THRESHOLD_STRONG = 6.0


@dataclass(frozen=True)
class RgbStats:
    r_mean: float
    g_mean: float
    b_mean: float
    r_std: float
    g_std: float
    b_std: float
    r_bias: float
    g_bias: float
    b_bias: float


@dataclass(frozen=True)
class LabStats:
    l_mean: float
    a_mean: float
    b_star_mean: float
    a_std: float
    b_star_std: float
    cast_strength: float


@dataclass(frozen=True)
class ZoneCast:
    a_mean: float
    b_mean: float
    pixels: int
    confidence: float = 1.0


@dataclass(frozen=True)
class ToneRegion:
    name: str
    pixels: int
    pct: float
    r_mean: float
    g_mean: float
    b_mean: float
    a_star: float
    b_star: float
    l_mean: float
    peaks: dict[str, int]
    peak_spread: int


@dataclass(frozen=True)
class CastReport:
    width: int
    height: int
    rgb: RgbStats
    lab: LabStats
    peaks: dict[str, int]
    severity: str
    cast_direction: str
    diagnosis: list[str] = field(default_factory=list)
    is_gray_ref: bool = False
    gray_deviation: float = 0.0
    skin: ZoneCast | None = None
    zones: dict[str, ZoneCast] = field(default_factory=dict)
    tone_regions: dict[str, ToneRegion] = field(default_factory=dict)

    @property
    def peak_spread(self) -> int:
        return max(self.peaks.values()) - min(self.peaks.values())

    @property
    def channel_spread(self) -> float:
        means = [self.rgb.r_mean, self.rgb.g_mean, self.rgb.b_mean]
        return max(means) - min(means)


def ensure_uint8_rgb(img_rgb: np.ndarray) -> np.ndarray:
    if img_rgb.ndim != 3 or img_rgb.shape[2] != 3:
        raise ValueError("Expected an HxWx3 RGB image")
    if img_rgb.dtype != np.uint8:
        raise ValueError("Phase 1 core expects uint8 RGB images")
    return img_rgb


def rgb_to_lab_float(img_rgb: np.ndarray) -> np.ndarray:
    """Convert uint8 RGB to high-precision CIELAB.

    OpenCV's uint8 Lab path quantizes L/a/b into 8-bit channels. For analysis
    and chart data we use float32 RGB in 0..1, which returns L* in 0..100 and
    a*/b* in real CIELAB units.
    """

    img_rgb = ensure_uint8_rgb(img_rgb)
    return ACCELERATOR.rgb_to_lab_float(img_rgb)


def analyze_rgb(img_rgb: np.ndarray) -> RgbStats:
    img_rgb = ensure_uint8_rgb(img_rgb)
    r, g, b = img_rgb[:, :, 0], img_rgb[:, :, 1], img_rgb[:, :, 2]
    r_mean, g_mean, b_mean = float(r.mean()), float(g.mean()), float(b.mean())
    overall = (r_mean + g_mean + b_mean) / 3.0
    return RgbStats(
        r_mean=r_mean,
        g_mean=g_mean,
        b_mean=b_mean,
        r_std=float(r.std()),
        g_std=float(g.std()),
        b_std=float(b.std()),
        r_bias=r_mean - overall,
        g_bias=g_mean - overall,
        b_bias=b_mean - overall,
    )


def analyze_lab(img_rgb: np.ndarray) -> LabStats:
    img_rgb = ensure_uint8_rgb(img_rgb)
    lab = rgb_to_lab_float(img_rgb)
    l_ch, a_ch, b_ch = lab[:, :, 0], lab[:, :, 1], lab[:, :, 2]
    a_centered = float(a_ch.mean())
    b_centered = float(b_ch.mean())
    return LabStats(
        l_mean=float(l_ch.mean()),
        a_mean=a_centered,
        b_star_mean=b_centered,
        a_std=float(a_ch.std()),
        b_star_std=float(b_ch.std()),
        cast_strength=float(np.sqrt(a_centered**2 + b_centered**2)),
    )


def find_histogram_peaks(img_rgb: np.ndarray, bins: int = 256) -> dict[str, int]:
    img_rgb = ensure_uint8_rgb(img_rgb)
    peaks: dict[str, int] = {}
    for ch, name in [(0, "r"), (1, "g"), (2, "b")]:
        hist = ACCELERATOR.calc_hist(img_rgb, ch, bins)
        peaks[name] = int(np.argmax(hist))
    return peaks


def _detect_faces(img_rgb: np.ndarray) -> list[tuple[int, int, int, int]]:
    """Detect frontal faces using OpenCV Haar cascade.

    Returns list of (x, y, w, h) bounding boxes. Empty if none found.
    """
    gray = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2GRAY)
    cascade = cv2.CascadeClassifier(
        cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    )
    faces = cascade.detectMultiScale(
        gray,
        scaleFactor=1.1,
        minNeighbors=5,
        minSize=(30, 30),
    )
    return [(int(x), int(y), int(w), int(h)) for x, y, w, h in faces]


def _skin_ycrcb(img_rgb: np.ndarray) -> np.ndarray:
    """YCrCb-based skin detection with well-established fixed thresholds.

    Uses the Chai & Ngan (1999) skin color model. YCrCb separates
    luminance from chrominance better than HSV, giving more consistent
    results across lighting conditions.

    Returns boolean mask.
    """
    ycrcb = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2YCrCb)
    cr = ycrcb[:, :, 1]
    cb = ycrcb[:, :, 2]

    # Chai & Ngan skin ranges
    mask = (cr >= 133) & (cr <= 173) & (cb >= 77) & (cb <= 127)
    return mask


def _skin_from_faces(
    img_rgb: np.ndarray, faces: list[tuple[int, int, int, int]]
) -> np.ndarray:
    """Build skin mask from face color sampling + Gaussian model.

    Samples inner 60% of each detected face to avoid hair/background.
    Builds a 2D Gaussian in (Cr, Cb) space and thresholds the full image
    with Mahalanobis distance at 95% confidence.

    Returns boolean mask.
    """
    if not faces:
        return np.zeros(img_rgb.shape[:2], dtype=bool)

    ycrcb = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2YCrCb)
    cr = ycrcb[:, :, 1].astype(np.float64)
    cb = ycrcb[:, :, 2].astype(np.float64)

    # Sample from inner 60% of each face
    samples = []
    for x, y, w, h in faces:
        margin_x = int(w * 0.2)
        margin_y = int(h * 0.2)
        inner_cr = cr[y + margin_y : y + h - margin_y, x + margin_x : x + w - margin_x]
        inner_cb = cb[y + margin_y : y + h - margin_y, x + margin_x : x + w - margin_x]
        if inner_cr.size > 0:
            samples.append(np.column_stack([inner_cr.ravel(), inner_cb.ravel()]))

    if not samples:
        return np.zeros(img_rgb.shape[:2], dtype=bool)

    all_samples = np.vstack(samples)
    if len(all_samples) < 20:
        return np.zeros(img_rgb.shape[:2], dtype=bool)

    # Gaussian model in (Cr, Cb) space
    mean = np.mean(all_samples, axis=0)
    cov = np.cov(all_samples, rowvar=False) + np.eye(2) * 1e-3

    # Mahalanobis distance for every pixel
    inv_cov = np.linalg.inv(cov)
    h, w = img_rgb.shape[:2]
    pixels = np.column_stack([cr.ravel(), cb.ravel()])
    diff = pixels - mean
    mahalanobis = np.sum(diff @ inv_cov * diff, axis=1)

    # Chi-square 2 DOF, 95% confidence ≈ 5.991
    return (mahalanobis <= 5.991).reshape(h, w)


def detect_skin_mask(img_rgb: np.ndarray, min_pixels: int = 200) -> np.ndarray:
    """Detect skin regions using face-seeded adaptive model with YCrCb fallback.

    Primary path: detect faces via Haar cascade, sample face colors,
    build per-image Gaussian model in Cr/Cb space, expand to full image.

    Fallback path: YCrCb fixed-threshold model when no faces detected.

    Morphological open/close removes noise and fills small gaps.
    Returns all-False mask if detected area below ``min_pixels``.
    """
    img_rgb = ensure_uint8_rgb(img_rgb)

    # Primary: face-seeded adaptive model
    faces = _detect_faces(img_rgb)
    if faces:
        mask = _skin_from_faces(img_rgb, faces)
    else:
        # Fallback: YCrCb fixed thresholds
        mask = _skin_ycrcb(img_rgb)

    # Morphological cleanup
    if mask.any():
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        mask_u8 = mask.astype(np.uint8)
        mask_u8 = cv2.morphologyEx(mask_u8, cv2.MORPH_OPEN, kernel)
        mask_u8 = cv2.morphologyEx(mask_u8, cv2.MORPH_CLOSE, kernel)

        if np.count_nonzero(mask_u8) < min_pixels:
            return np.zeros_like(mask, dtype=bool)
        return mask_u8.astype(bool)

    return np.zeros(img_rgb.shape[:2], dtype=bool)


def auto_detect_cast(img_rgb: np.ndarray) -> dict[str, ZoneCast]:
    img_rgb = ensure_uint8_rgb(img_rgb)
    lab = rgb_to_lab_float(img_rgb)
    a_ch = lab[:, :, 1].astype(float)
    b_ch = lab[:, :, 2].astype(float)
    l_ch = lab[:, :, 0].astype(float)

    lo_thr = np.percentile(l_ch, 5)
    hi_thr = np.percentile(l_ch, 95)
    mid_lo = np.percentile(l_ch, 40)
    mid_hi = np.percentile(l_ch, 60)
    masks = {
        "shadow": l_ch <= lo_thr,
        "midtone": (l_ch >= mid_lo) & (l_ch <= mid_hi),
        "highlight": l_ch >= hi_thr,
    }

    result: dict[str, ZoneCast] = {
        "global": ZoneCast(
            a_mean=float(a_ch.mean()),
            b_mean=float(b_ch.mean()),
            pixels=int(img_rgb.shape[0] * img_rgb.shape[1]),
        )
    }

    neutral = detect_neutral_mask(img_rgb)
    neutral_n = int(neutral.sum())
    if neutral_n >= max(100, int(img_rgb.shape[0] * img_rgb.shape[1] * 0.01)):
        result["neutral"] = ZoneCast(
            a_mean=float(a_ch[neutral].mean()),
            b_mean=float(b_ch[neutral].mean()),
            pixels=neutral_n,
            confidence=min(1.0, neutral_n / max(img_rgb.shape[0] * img_rgb.shape[1] * 0.12, 1.0)),
        )
    for name, mask in masks.items():
        n = int(mask.sum())
        if n >= 100:
            result[name] = ZoneCast(
                a_mean=float(a_ch[mask].mean()),
                b_mean=float(b_ch[mask].mean()),
                pixels=n,
            )

    skin = detect_skin_mask(img_rgb, min_pixels=500)
    if skin.sum() > 500:
        result["skin"] = ZoneCast(
            a_mean=float(a_ch[skin].mean()),
            b_mean=float(b_ch[skin].mean()),
            pixels=int(skin.sum()),
        )
    return result


def detect_neutral_mask(img_rgb: np.ndarray) -> np.ndarray:
    """Find low-chroma pixels that are more reliable for white-balance estimation.

    Full-image Lab means are easily biased by large colored subjects. This mask
    favors low-saturation mid/high luminance pixels and rejects strong shadows,
    which usually gives a better estimate of scene illuminant for auto mode.
    """

    img_rgb = ensure_uint8_rgb(img_rgb)
    hsv = ACCELERATOR.rgb_to_hsv(img_rgb)
    lab = rgb_to_lab_float(img_rgb)
    l_ch = lab[:, :, 0].astype(np.float32)
    s_ch = hsv[:, :, 1].astype(np.float32)

    s_threshold = min(float(np.percentile(s_ch, 35)), 42.0)
    l_low = float(np.percentile(l_ch, 20))
    l_high = float(np.percentile(l_ch, 98))
    mask = (s_ch <= s_threshold) & (l_ch >= l_low) & (l_ch <= l_high)

    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    mask_u8 = cv2.morphologyEx(mask.astype(np.uint8), cv2.MORPH_OPEN, kernel)
    return mask_u8.astype(bool)


def diagnose_cast(lab: LabStats, rgb: RgbStats, peaks: dict[str, int]) -> tuple[str, str, list[str]]:
    if lab.cast_strength < THRESHOLD_MODERATE:
        severity = "[OK] Normal"
    elif lab.cast_strength < THRESHOLD_STRONG:
        severity = "WARNING Slight cast"
    else:
        severity = "[R] Strong"

    directions: list[str] = []
    if abs(lab.a_mean) > THRESHOLD_MODERATE:
        directions.append("Red [R]" if lab.a_mean > 0 else "Green [G]")
    if abs(lab.b_star_mean) > THRESHOLD_MODERATE:
        directions.append("Yellow" if lab.b_star_mean > 0 else "Blue")
    if directions:
        direction = " + ".join(directions)
    elif lab.cast_strength < THRESHOLD_MODERATE:
        direction = "Neutral"
    elif abs(rgb.r_bias) > THRESHOLD_MODERATE:
        direction = "Red [R]" if rgb.r_bias > 0 else "Cyan"
    else:
        direction = "Undetermined bias"

    peak_spread = max(peaks.values()) - min(peaks.values())
    diagnosis = [
        f"Lab perceptual cast intensity: {lab.cast_strength:.2f} "
        f"(a*={lab.a_mean:+.1f}, b*={lab.b_star_mean:+.1f})",
        f"RGB mean: R={rgb.r_mean:.1f} G={rgb.g_mean:.1f} B={rgb.b_mean:.1f}",
        f"RGB histogram peaks: R={peaks['r']} G={peaks['g']} B={peaks['b']} "
        f"(spread={peak_spread})",
    ]
    if peak_spread > 15:
        diagnosis.append("Histogram peak gap > 15 may indicate cast or scene content")
    return severity, direction, diagnosis


def analyze_luminance_regions(img_rgb: np.ndarray) -> dict[str, ToneRegion]:
    img_rgb = ensure_uint8_rgb(img_rgb)
    lab = rgb_to_lab_float(img_rgb)
    l_ch = lab[:, :, 0]
    lo_thr = np.percentile(l_ch, 5)
    hi_thr = np.percentile(l_ch, 95)
    mid_lo = np.percentile(l_ch, 40)
    mid_hi = np.percentile(l_ch, 60)
    masks = {
        "Shadow": l_ch <= lo_thr,
        "Midtone": (l_ch >= mid_lo) & (l_ch <= mid_hi),
        "Highlight": l_ch >= hi_thr,
    }
    total = img_rgb.shape[0] * img_rgb.shape[1]
    regions: dict[str, ToneRegion] = {}
    for name, mask in masks.items():
        n = int(mask.sum())
        if n < 300:
            continue
        masked_rgb = img_rgb[mask]
        masked_lab = lab[mask]
        peaks: dict[str, int] = {}
        for ch, ch_name in [(0, "R"), (1, "G"), (2, "B")]:
            hist = ACCELERATOR.calc_hist(img_rgb, ch, 256, mask.astype(np.uint8))
            peaks[ch_name] = int(np.argmax(hist))
        regions[name] = ToneRegion(
            name=name,
            pixels=n,
            pct=n / total * 100.0,
            r_mean=float(masked_rgb[:, 0].mean()),
            g_mean=float(masked_rgb[:, 1].mean()),
            b_mean=float(masked_rgb[:, 2].mean()),
            a_star=float(masked_lab[:, 1].mean()),
            b_star=float(masked_lab[:, 2].mean()),
            l_mean=float(masked_lab[:, 0].mean()),
            peaks=peaks,
            peak_spread=max(peaks.values()) - min(peaks.values()),
        )
    return regions


def analyze_image_array(img_rgb: np.ndarray, is_gray_ref: bool = False) -> CastReport:
    img_rgb = ensure_uint8_rgb(img_rgb)
    rgb = analyze_rgb(img_rgb)
    lab = analyze_lab(img_rgb)
    peaks = find_histogram_peaks(img_rgb)
    severity, direction, diagnosis = diagnose_cast(lab, rgb, peaks)
    gray_deviation = 0.0
    if is_gray_ref:
        gray_deviation = float(
            np.sqrt((rgb.r_mean - 128) ** 2 + (rgb.g_mean - 128) ** 2 + (rgb.b_mean - 128) ** 2)
        )
        diagnosis.append(f"Gray reference deviation: {gray_deviation:.1f}")
    zones = auto_detect_cast(img_rgb)
    return CastReport(
        width=int(img_rgb.shape[1]),
        height=int(img_rgb.shape[0]),
        rgb=rgb,
        lab=lab,
        peaks=peaks,
        severity=severity,
        cast_direction=direction,
        diagnosis=diagnosis,
        is_gray_ref=is_gray_ref,
        gray_deviation=gray_deviation,
        skin=zones.get("skin"),
        zones={k: v for k, v in zones.items() if k != "skin"},
        tone_regions=analyze_luminance_regions(img_rgb),
    )
