"""Creative look adjustment helpers.

The functions in this module apply lightweight, deterministic color grading
after objective calibration. Inputs are RGB images in uint8 or float [0, 1].
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any

import cv2
import numpy as np


def _clamp(value: Any, low: float, high: float, default: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = default
    if not np.isfinite(number):
        number = default
    return float(np.clip(number, low, high))


def _as_uint8_rgb(image: np.ndarray) -> tuple[np.ndarray, bool]:
    arr = np.asarray(image)
    was_float = np.issubdtype(arr.dtype, np.floating)
    if was_float:
        return np.clip(arr * 255.0, 0, 255).astype(np.uint8), True
    return np.clip(arr, 0, 255).astype(np.uint8), False


def _restore_dtype(image: np.ndarray, was_float: bool) -> np.ndarray:
    if was_float:
        return (image.astype(np.float32) / 255.0).clip(0, 1)
    return image.astype(np.uint8)


def normalize_look_adjustments(raw: Any) -> dict[str, Any]:
    """Return a safe, JSON-serializable look adjustment payload."""
    if not isinstance(raw, dict):
        raw = {}
    lab_raw = raw.get("lab_bias") if isinstance(raw.get("lab_bias"), dict) else {}
    grade_raw = raw.get("color_grade") if isinstance(raw.get("color_grade"), dict) else {}
    point_raw = raw.get("point_color") if isinstance(raw.get("point_color"), dict) else {}

    color_grade: dict[str, Any] = {
        "blending": _clamp(grade_raw.get("blending", 0.55), 0.0, 1.0, 0.55),
        "balance": _clamp(grade_raw.get("balance", 0.0), -1.0, 1.0, 0.0),
    }
    for zone in ("shadows", "midtones", "highlights", "global"):
        zone_raw = grade_raw.get(zone) if isinstance(grade_raw.get(zone), dict) else {}
        color_grade[zone] = {
            "hue": _clamp(zone_raw.get("hue", 35.0), 0.0, 360.0, 35.0),
            "saturation": _clamp(zone_raw.get("saturation", 0.0), 0.0, 1.0, 0.0),
            "luminance": _clamp(zone_raw.get("luminance", 0.0), -1.0, 1.0, 0.0),
        }

    return {
        "lab_bias": {
            "a": _clamp(lab_raw.get("a", 0.0), -40.0, 40.0, 0.0),
            "b": _clamp(lab_raw.get("b", 0.0), -40.0, 40.0, 0.0),
        },
        "color_grade": color_grade,
        "point_color": {
            "enabled": bool(point_raw.get("enabled", False)),
            "hue": _clamp(point_raw.get("hue", 0.0), 0.0, 360.0, 0.0),
            "range": _clamp(point_raw.get("range", 24.0), 2.0, 90.0, 24.0),
            "hue_shift": _clamp(point_raw.get("hue_shift", 0.0), -180.0, 180.0, 0.0),
            "saturation": _clamp(point_raw.get("saturation", 0.0), -1.0, 1.0, 0.0),
            "luminance": _clamp(point_raw.get("luminance", 0.0), -1.0, 1.0, 0.0),
        },
    }


def is_identity_look(look: Any) -> bool:
    data = normalize_look_adjustments(look)
    if abs(data["lab_bias"]["a"]) > 0.001 or abs(data["lab_bias"]["b"]) > 0.001:
        return False
    point = data["point_color"]
    if point["enabled"] and (
        abs(point["hue_shift"]) > 0.001
        or abs(point["saturation"]) > 0.001
        or abs(point["luminance"]) > 0.001
    ):
        return False
    grade = data["color_grade"]
    for zone in ("shadows", "midtones", "highlights", "global"):
        if abs(grade[zone]["saturation"]) > 0.001 or abs(grade[zone]["luminance"]) > 0.001:
            return False
    return True


def _softstep(edge0: float, edge1: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - edge0) / max(edge1 - edge0, 1e-6), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def _zone_mask(l_values: np.ndarray, zone: str, blending: float, balance: float) -> np.ndarray:
    blend = 0.65 + blending * 0.7
    shadow_end = 42.0 + balance * 12.0
    highlight_start = 58.0 + balance * 12.0
    if zone == "shadows":
        return 1.0 - _softstep(18.0, shadow_end + 18.0 * blend, l_values)
    if zone == "highlights":
        return _softstep(highlight_start - 18.0 * blend, 88.0, l_values)
    if zone == "midtones":
        width = 34.0 + 22.0 * blend
        return np.clip(1.0 - np.abs(l_values - (50.0 + balance * 8.0)) / width, 0.0, 1.0)
    return np.ones_like(l_values, dtype=np.float32)


def _apply_lab_bias_and_grade(rgb_u8: np.ndarray, look: dict[str, Any]) -> np.ndarray:
    lab = cv2.cvtColor(rgb_u8, cv2.COLOR_RGB2LAB).astype(np.float32)
    l = lab[:, :, 0] * (100.0 / 255.0)
    a_delta = np.full(l.shape, look["lab_bias"]["a"], dtype=np.float32)
    b_delta = np.full(l.shape, look["lab_bias"]["b"], dtype=np.float32)
    l_delta = np.zeros(l.shape, dtype=np.float32)

    grade = look["color_grade"]
    blending = float(grade["blending"])
    balance = float(grade["balance"])
    for zone in ("shadows", "midtones", "highlights", "global"):
        wheel = grade[zone]
        sat = float(wheel["saturation"])
        lum = float(wheel["luminance"])
        if abs(sat) < 0.001 and abs(lum) < 0.001:
            continue
        hue = np.deg2rad(float(wheel["hue"]))
        mask = _zone_mask(l, zone, blending, balance)
        a_delta += np.cos(hue) * sat * 28.0 * mask
        b_delta += np.sin(hue) * sat * 28.0 * mask
        l_delta += lum * 22.0 * mask

    lab[:, :, 0] = np.clip(lab[:, :, 0] + l_delta * 2.55, 0, 255)
    lab[:, :, 1] = np.clip(lab[:, :, 1] + a_delta, 0, 255)
    lab[:, :, 2] = np.clip(lab[:, :, 2] + b_delta, 0, 255)
    return cv2.cvtColor(lab.astype(np.uint8), cv2.COLOR_LAB2RGB)


def _circular_hue_distance(hue: np.ndarray, target: float) -> np.ndarray:
    diff = np.abs(hue - target)
    return np.minimum(diff, 360.0 - diff)


def _apply_point_color(rgb_u8: np.ndarray, look: dict[str, Any]) -> np.ndarray:
    point = look["point_color"]
    if not point["enabled"]:
        return rgb_u8
    if (
        abs(point["hue_shift"]) < 0.001
        and abs(point["saturation"]) < 0.001
        and abs(point["luminance"]) < 0.001
    ):
        return rgb_u8

    hsv = cv2.cvtColor(rgb_u8, cv2.COLOR_RGB2HSV).astype(np.float32)
    hue = hsv[:, :, 0] * 2.0
    dist = _circular_hue_distance(hue, float(point["hue"]))
    range_width = float(point["range"])
    mask = np.clip(1.0 - dist / range_width, 0.0, 1.0)
    mask = mask * mask * (3.0 - 2.0 * mask)
    sat_gate = np.clip((hsv[:, :, 1] - 18.0) / 70.0, 0.0, 1.0)
    mask *= sat_gate

    hsv[:, :, 0] = (hsv[:, :, 0] + (float(point["hue_shift"]) / 2.0) * mask) % 180.0
    hsv[:, :, 1] = np.clip(hsv[:, :, 1] + float(point["saturation"]) * 90.0 * mask, 0, 255)
    hsv[:, :, 2] = np.clip(hsv[:, :, 2] + float(point["luminance"]) * 70.0 * mask, 0, 255)
    return cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2RGB)


def apply_look_adjustments(image: np.ndarray, look: Any) -> np.ndarray:
    """Apply creative look adjustments after objective calibration."""
    normalized = normalize_look_adjustments(deepcopy(look))
    if is_identity_look(normalized):
        return image
    rgb_u8, was_float = _as_uint8_rgb(image)
    adjusted = _apply_lab_bias_and_grade(rgb_u8, normalized)
    adjusted = _apply_point_color(adjusted, normalized)
    return _restore_dtype(adjusted, was_float)
