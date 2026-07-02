from __future__ import annotations

import cv2
import numpy as np
import pytest

from photo_calibrator.core.calibration import (
    CalibrationMode,
    CalibrationParams,
    apply_3d_lut,
    apply_color_matrix,
    build_auto_lut,
    calibrate_film,
    calibrate_image,
    calibrate_negative_film,
    calibrate_rgb_curves,
    calibrate_selective,
    calibrate_tone_zone,
    analyze_tone_recovery,
    apply_tone_recovery,
    curve_interpolate,
    estimate_color_matrix,
    make_comparison,
    prepare_negative_film_base,
    preserve_luminance,
)
from photo_calibrator.core.cast_detection import analyze_image_array, rgb_to_lab_float


def lab_patch(l_value: int = 160, a_value: int = 145, b_value: int = 150) -> np.ndarray:
    lab = np.zeros((96, 96, 3), dtype=np.uint8)
    lab[:, :, 0] = l_value
    lab[:, :, 1] = a_value
    lab[:, :, 2] = b_value
    return cv2.cvtColor(lab, cv2.COLOR_Lab2RGB)


def test_global_auto_calibration_reduces_lab_cast_strength() -> None:
    img = lab_patch(a_value=146, b_value=151)
    before = analyze_image_array(img).lab.cast_strength
    result = calibrate_image(img, CalibrationParams(mode=CalibrationMode.GLOBAL, strength=0.8))

    assert result.image.shape == img.shape
    assert result.pre_report.lab.cast_strength == before
    assert result.post_report.lab.cast_strength < before
    assert result.reduction_pct > 30


def test_manual_shift_is_preserved_in_result() -> None:
    img = lab_patch(a_value=140, b_value=128)
    result = calibrate_image(
        img,
        CalibrationParams(
            mode=CalibrationMode.GLOBAL,
            a_shift=-5.0,
            b_shift=0.0,
            strength=1.0,
        ),
    )

    assert result.a_shift == -5.0
    assert result.b_shift == 0.0
    assert result.params.a_shift == -5.0


def test_all_phase1_calibration_modes_return_same_shape() -> None:
    img = lab_patch(a_value=142, b_value=148)
    for mode in CalibrationMode:
        result = calibrate_image(img, CalibrationParams(mode=mode, strength=0.5))
        assert result.image.shape == img.shape
        assert result.image.dtype == np.uint8


def test_calibrate_image_preserves_uint16_precision() -> None:
    img_u8 = gradient_image()
    img = (img_u8.astype(np.uint16) * 257).astype(np.uint16)
    result = calibrate_image(img, CalibrationParams(mode=CalibrationMode.GLOBAL, strength=0.8))
    assert result.image.shape == img.shape
    assert result.image.dtype == np.uint16


def test_calibrate_image_preserves_float32_precision() -> None:
    img = gradient_image().astype(np.float32) / 255.0
    result = calibrate_image(img, CalibrationParams(mode=CalibrationMode.RGB_CURVES, strength=0.8))
    assert result.image.shape == img.shape
    assert result.image.dtype == np.float32
    assert float(result.image.max()) <= 1.0 + 1e-6


def test_calibrate_image_uses_scene_linear_working_branch() -> None:
    img = gradient_image().astype(np.float32) / 255.0
    linear_img = np.power(img, 2.2).astype(np.float32)

    result = calibrate_image(
        linear_img,
        CalibrationParams(mode=CalibrationMode.GLOBAL, strength=0.8),
        color_space="Linear",
        data_range=(0.0, 1.0),
    )

    assert result.image.dtype == np.float32
    assert str(result.metadata["working_branch"]).startswith("scene-linear")
    assert result.metadata["working_color_space"] == "Linear"


def test_calibrate_image_uses_hdr_branch_for_linear_values_above_one() -> None:
    img = gradient_image().astype(np.float32) / 255.0
    linear_hdr = np.power(img, 2.2).astype(np.float32) * 1.8

    result = calibrate_image(
        linear_hdr,
        CalibrationParams(mode=CalibrationMode.GLOBAL, strength=0.8),
        color_space="Linear",
        data_range=(0.0, 1.8),
    )

    assert result.image.dtype == np.float32
    assert "hdr" in str(result.metadata["working_branch"])


def test_make_comparison_places_images_side_by_side() -> None:
    img = lab_patch()
    result = calibrate_image(img, CalibrationParams())
    comparison = make_comparison(img, result.image)
    assert comparison.shape[0] == img.shape[0]
    assert comparison.shape[1] == img.shape[1] * 2


def test_auto_calibration_uses_neutral_region_when_scene_content_is_color_biased() -> None:
    img = np.zeros((100, 100, 3), dtype=np.uint8)
    img[:, :] = (170, 30, 30)
    img[25:75, 25:75] = (128, 128, 128)

    result = calibrate_image(img, CalibrationParams(mode=CalibrationMode.GLOBAL, strength=0.8))

    assert str(result.metadata["auto_cast_source"]).startswith("neutral")
    assert abs(result.a_shift) < 2.0
    assert abs(result.b_shift) < 2.0


def test_auto_calibration_skips_tiny_automatic_shift() -> None:
    img = np.zeros((80, 80, 3), dtype=np.uint8)
    img[:, :] = (128, 128, 128)

    result = calibrate_image(img, CalibrationParams(mode=CalibrationMode.GLOBAL, strength=0.8))

    assert result.a_shift == 0.0
    assert result.b_shift == 0.0
    assert "skipped-low-magnitude" in result.metadata["auto_cast_source"]
    assert np.array_equal(result.image, img)


def gradient_image() -> np.ndarray:
    x = np.linspace(20, 235, 96, dtype=np.uint8)
    y = np.linspace(30, 220, 96, dtype=np.uint8)
    xx, yy = np.meshgrid(x, y)
    img = np.stack([xx, yy, ((xx.astype(int) + yy.astype(int)) // 2).astype(np.uint8)], axis=2)
    img[20:60, 20:60] = (178, 132, 104)
    return img


def assert_valid_changed(output: np.ndarray, source: np.ndarray) -> None:
    assert output.shape == source.shape
    assert output.dtype == np.uint8
    assert not np.array_equal(output, source)


def test_rgb_curves_layer_changes_channel_response() -> None:
    img = gradient_image()
    out = calibrate_rgb_curves(img, strength=0.8)
    assert_valid_changed(out, img)


def test_tone_zone_layer_changes_luminance_dependent_color() -> None:
    img = lab_patch(a_value=145, b_value=150)
    out = calibrate_tone_zone(img, strength=0.8)
    assert_valid_changed(out, img)


def test_matrix_layer_estimates_and_applies_3x3_transform() -> None:
    img = gradient_image()
    matrix = estimate_color_matrix(img)
    out = apply_color_matrix(img, matrix=matrix, strength=0.8)
    assert matrix.shape == (3, 3)
    assert_valid_changed(out, img)


def test_lut3d_layer_builds_and_applies_lut() -> None:
    img = gradient_image()
    lut = build_auto_lut(img, size=9)
    out = apply_3d_lut(img, lut=lut, strength=0.8)
    assert lut.shape == (9, 9, 9, 3)
    assert_valid_changed(out, img)


def test_selective_layer_changes_subject_regions() -> None:
    img = gradient_image()
    out = calibrate_selective(img, strength=0.8)
    assert_valid_changed(out, img)


def test_film_mode_combines_multiple_correction_layers() -> None:
    img = gradient_image()
    out = calibrate_film(img, strength=0.8)
    assert_valid_changed(out, img)


def test_negative_film_mode_inverts_a_negative_image() -> None:
    positive = gradient_image()
    negative = 255 - positive
    out = calibrate_negative_film(negative, strength=0.8)

    assert out.shape == negative.shape
    assert out.dtype == np.uint8
    assert float(out.mean()) > float(negative.mean())
    assert np.mean(np.abs(out.astype(np.float32) - negative.astype(np.float32))) > 20.0


def test_negative_film_analysis_uses_positive_base() -> None:
    positive = gradient_image()
    negative = 255 - positive
    base = prepare_negative_film_base(negative)
    result = calibrate_image(negative, CalibrationParams(mode=CalibrationMode.NEGATIVE_FILM, strength=0.8))

    base_report = analyze_image_array(base)
    negative_report = analyze_image_array(negative)

    assert result.metadata["analysis_basis"] == "negative-positive-base"
    assert result.analysis_image is not None
    assert np.mean(np.abs(result.analysis_image.astype(np.float32) - base.astype(np.float32))) < 1.0
    assert result.pre_report.rgb.r_mean == pytest.approx(base_report.rgb.r_mean, abs=1.0)
    assert abs(result.pre_report.rgb.r_mean - negative_report.rgb.r_mean) > 10.0


def test_preserve_luminance_restores_original_lightness() -> None:
    img = gradient_image()
    darkened = np.clip(img.astype(np.float32) * 0.55, 0, 255).astype(np.uint8)

    restored = preserve_luminance(img, darkened, amount=0.9)

    source_l = float(rgb_to_lab_float(img)[:, :, 0].mean())
    dark_l = float(rgb_to_lab_float(darkened)[:, :, 0].mean())
    restored_l = float(rgb_to_lab_float(restored)[:, :, 0].mean())
    assert abs(restored_l - source_l) < abs(dark_l - source_l)


def test_film_mode_keeps_average_luminance_stable() -> None:
    img = gradient_image()
    out = calibrate_film(img, strength=0.8)

    source_l = float(rgb_to_lab_float(img)[:, :, 0].mean())
    out_l = float(rgb_to_lab_float(out)[:, :, 0].mean())
    assert abs(out_l - source_l) < 6.0


def test_new_calibration_modes_are_available_through_calibrate_image() -> None:
    img = gradient_image()
    for mode in [
        CalibrationMode.RGB_CURVES,
        CalibrationMode.TONE_ZONE,
        CalibrationMode.MATRIX,
        CalibrationMode.LUT3D,
        CalibrationMode.SELECTIVE,
        CalibrationMode.FILM,
        CalibrationMode.NEGATIVE_FILM,
    ]:
        result = calibrate_image(img, CalibrationParams(mode=mode, strength=0.6, lut_size=9))
        assert result.image.shape == img.shape


# ── curve_interpolate tests ──────────────────────────────────────────

def test_curve_interpolate_identity() -> None:
    """Identity control points produce identity LUT."""
    cp = [[0, 0], [64, 64], [128, 128], [192, 192], [255, 255]]
    lut = curve_interpolate(cp)
    assert len(lut) == 256
    assert lut[0] == 0
    assert lut[128] == 128
    assert lut[255] == 255


def test_curve_interpolate_boost_midtones() -> None:
    """Boosted midtones lift the middle of the LUT."""
    cp = [[0, 0], [64, 80], [128, 128], [192, 176], [255, 255]]
    lut = curve_interpolate(cp)
    assert lut[64] > 64, f"Expected boosted shadow at 64, got {lut[64]}"
    assert lut[192] < 192, f"Expected compressed highlight at 192, got {lut[192]}"
    assert lut[0] == 0
    assert lut[255] == 255


def test_curve_interpolate_monotonic() -> None:
    """LUT values should be non-decreasing (monotonic)."""
    cp = [[0, 10], [50, 40], [100, 180], [200, 140], [255, 240]]
    lut = curve_interpolate(cp)
    diffs = np.diff(lut)
    assert np.all(diffs >= 0), f"LUT is not monotonic: min diff = {diffs.min()}"


def test_curve_interpolate_minimum_points() -> None:
    """Minimum 2 control points should work."""
    cp = [[0, 0], [255, 255]]
    lut = curve_interpolate(cp)
    assert len(lut) == 256
    assert lut[0] == 0 and lut[255] == 255


def test_curve_interpolate_rejects_single_point() -> None:
    """Less than 2 control points raises ValueError."""
    import pytest
    with pytest.raises(ValueError):
        curve_interpolate([[128, 128]])


def test_curve_interpolate_sorts_by_x() -> None:
    """Unsorted control points should be sorted by x."""
    cp = [[255, 255], [0, 0], [128, 128]]
    lut = curve_interpolate(cp)
    assert lut[0] == 0 and lut[255] == 255


def test_calibration_params_with_curves() -> None:
    """CalibrationParams accepts and stores curve fields."""
    r = [[0, 0], [128, 140], [255, 255]]
    g = [[0, 0], [64, 64], [128, 128], [192, 192], [255, 255]]
    b = [[0, 0], [128, 116], [255, 255]]
    params = CalibrationParams(
        mode=CalibrationMode.RGB_CURVES,
        r_curve=r,
        g_curve=g,
        b_curve=b,
        strength=0.7,
    )
    assert params.r_curve == r
    assert params.g_curve == g
    assert params.b_curve == b
    assert params.strength == 0.7


def test_calibration_params_default_curves_none() -> None:
    """Default CalibrationParams has None for curve fields."""
    params = CalibrationParams(mode=CalibrationMode.GLOBAL)
    assert params.r_curve is None
    assert params.g_curve is None
    assert params.b_curve is None


def test_calibrate_rgb_curves_with_explicit_points() -> None:
    """RGB curves with explicit control points should apply correctly."""
    img = gradient_image()
    r = [[0, 0], [128, 140], [255, 255]]
    g = [[0, 0], [128, 128], [255, 255]]
    b = [[0, 0], [128, 116], [255, 255]]
    result = calibrate_rgb_curves(
        img,
        strength=1.0,
        r_curve=r,
        g_curve=g,
        b_curve=b,
    )
    assert result.shape == img.shape
    assert result.dtype == img.dtype


def test_calibrate_rgb_curves_auto_fallback() -> None:
    """Without explicit curves, should fall back to auto S-curve."""
    img = gradient_image()
    result_auto = calibrate_rgb_curves(img, strength=0.5)
    result_manual = calibrate_rgb_curves(
        img,
        strength=0.5,
        r_curve=[[0, 0], [255, 255]],
    )
    assert result_auto.shape == img.shape
    assert result_manual.shape == img.shape


def test_tone_recovery_expands_flat_luminance_range() -> None:
    axis = np.linspace(96, 160, 96, dtype=np.uint8)
    xx = np.tile(axis, (96, 1))
    img = np.stack([xx, xx, xx], axis=2)
    before = analyze_tone_recovery(img)
    out, analysis = apply_tone_recovery(img, strength=0.7)
    before_span = float(np.percentile(img, 99) - np.percentile(img, 1))
    after_span = float(np.percentile(out, 99) - np.percentile(out, 1))
    assert before["dynamic_range"] < 0.35
    assert analysis["recommended_strength"] > 0.4
    assert after_span > before_span
    assert out.shape == img.shape
    assert out.dtype == img.dtype


def test_tone_recovery_preserves_chroma_on_colored_image() -> None:
    axis = np.linspace(90, 170, 96, dtype=np.float32)
    xx = np.tile(axis, (96, 1))
    img = np.stack(
        [
            np.clip(xx * 1.05 + 14, 0, 255),
            np.clip(xx * 0.82 + 20, 0, 255),
            np.clip(xx * 1.18 + 8, 0, 255),
        ],
        axis=2,
    ).astype(np.uint8)

    out, _ = apply_tone_recovery(img, strength=0.8)
    before_hsv = cv2.cvtColor(img, cv2.COLOR_RGB2HSV)
    after_hsv = cv2.cvtColor(out, cv2.COLOR_RGB2HSV)
    before_sat = float(before_hsv[:, :, 1].mean())
    after_sat = float(after_hsv[:, :, 1].mean())
    before_luma = img.astype(np.float32).mean(axis=2)
    after_luma = out.astype(np.float32).mean(axis=2)

    assert after_sat >= before_sat * 0.98
    assert float(after_luma.mean()) >= float(before_luma.mean()) - 1.0
    assert float(np.percentile(after_luma, 1)) >= float(np.percentile(before_luma, 1)) - 45.0
    assert float(np.percentile(after_luma, 99) - np.percentile(after_luma, 1)) > float(np.percentile(before_luma, 99) - np.percentile(before_luma, 1))


def test_tone_recovery_does_not_darken_bright_compressed_color() -> None:
    axis = np.linspace(150, 210, 96, dtype=np.float32)
    xx = np.tile(axis, (96, 1))
    img = np.stack(
        [
            np.clip(xx * 1.08, 0, 255),
            np.clip(xx * 0.9 + 18, 0, 255),
            np.clip(xx * 0.72 + 32, 0, 255),
        ],
        axis=2,
    ).astype(np.uint8)

    out, analysis = apply_tone_recovery(img, strength=0.8)
    before_hsv = cv2.cvtColor(img, cv2.COLOR_RGB2HSV)
    after_hsv = cv2.cvtColor(out, cv2.COLOR_RGB2HSV)
    before_luma = img.astype(np.float32).mean(axis=2)
    after_luma = out.astype(np.float32).mean(axis=2)
    hue_delta = np.abs(before_hsv[:, :, 0].astype(np.int16) - after_hsv[:, :, 0].astype(np.int16))
    hue_delta = np.minimum(hue_delta, 180 - hue_delta)

    assert analysis["algorithm"] == "luminance-ratio-chroma-preserving"
    assert float(after_luma.mean()) >= float(before_luma.mean()) - 1.0
    assert float(after_hsv[:, :, 1].mean()) >= float(before_hsv[:, :, 1].mean()) * 0.98
    assert float(hue_delta.mean()) <= 1.5
