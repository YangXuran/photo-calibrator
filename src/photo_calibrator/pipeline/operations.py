"""Non-destructive pipeline operation nodes.

Each operation is a frozen dataclass that defines an image transformation.
Operations are chained in PipelineDocument to produce calibrated output.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np


@dataclass(frozen=True)
class Operation:
    """Abstract pipeline operation node."""

    name: str
    params: dict[str, Any] = field(default_factory=dict)

    def apply(self, image: np.ndarray) -> np.ndarray:
        """Apply this operation to an image. Override in subclasses."""
        raise NotImplementedError


@dataclass(frozen=True)
class IdentityOp(Operation):
    """No-op passthrough — useful as placeholder or for testing."""

    name: str = "identity"

    def apply(self, image: np.ndarray) -> np.ndarray:
        return image


@dataclass(frozen=True)
class CalibrationOp(Operation):
    """Generic calibration operation that preserves the backend mode semantics."""

    name: str = "calibration"

    def apply(self, image: np.ndarray) -> np.ndarray:
        from photo_calibrator.core.calibration import CalibrationMode, CalibrationParams, calibrate_image

        params = dict(self.params)
        mode = CalibrationMode(params.pop("mode", "global"))
        calibration_params = CalibrationParams(mode=mode, **params)
        return calibrate_image(image, calibration_params).image


@dataclass(frozen=True)
class LabShiftOp(Operation):
    """Lab a*/b* channel shift — the primary calibration operation.

    Applies a global Lab color shift with configurable strength.
    """

    name: str = "lab-shift"

    def apply(self, image: np.ndarray) -> np.ndarray:
        a_shift = float(self.params.get("a_shift", 0.0))
        b_shift = float(self.params.get("b_shift", 0.0))
        strength = float(self.params.get("strength", 0.8))
        from photo_calibrator.core.calibration import calibrate_global
        return calibrate_global(image, a_shift, b_shift, strength)


@dataclass(frozen=True)
class RgbCurvesOp(Operation):
    """Per-channel RGB curve correction."""

    name: str = "rgb-curves"

    def apply(self, image: np.ndarray) -> np.ndarray:
        strength = float(self.params.get("strength", 0.8))
        low_pct = float(self.params.get("curve_low_pct", 1.0))
        high_pct = float(self.params.get("curve_high_pct", 99.0))
        gamma = self.params.get("gamma")
        r_curve = self.params.get("r_curve")
        g_curve = self.params.get("g_curve")
        b_curve = self.params.get("b_curve")
        from photo_calibrator.core.calibration import calibrate_rgb_curves
        return calibrate_rgb_curves(
            image,
            strength=strength,
            low_pct=low_pct,
            high_pct=high_pct,
            gamma=gamma,
            r_curve=r_curve,
            g_curve=g_curve,
            b_curve=b_curve,
        )


@dataclass(frozen=True)
class MatrixOp(Operation):
    """3x3 color matrix transform."""

    name: str = "matrix"

    def apply(self, image: np.ndarray) -> np.ndarray:
        strength = float(self.params.get("strength", 0.8))
        matrix = self.params.get("matrix")
        from photo_calibrator.core.calibration import apply_color_matrix
        return apply_color_matrix(image, matrix=matrix, strength=strength)


@dataclass(frozen=True)
class Lut3DOp(Operation):
    """3D LUT application."""

    name: str = "lut3d"

    def apply(self, image: np.ndarray) -> np.ndarray:
        strength = float(self.params.get("strength", 0.8))
        size = int(self.params.get("lut_size", 17))
        from photo_calibrator.core.calibration import apply_3d_lut
        return apply_3d_lut(image, strength=strength, size=size)


@dataclass(frozen=True)
class LookAdjustmentOp(Operation):
    """Creative look adjustment applied after objective calibration."""

    name: str = "look-adjustment"

    def apply(self, image: np.ndarray) -> np.ndarray:
        from photo_calibrator.core.look import apply_look_adjustments
        return apply_look_adjustments(image, self.params)


@dataclass(frozen=True)
class ToneRecoveryOp(Operation):
    """Luminance depth restoration after color calibration."""

    name: str = "tone-recovery"

    def apply(self, image: np.ndarray) -> np.ndarray:
        from photo_calibrator.core.calibration import apply_tone_recovery

        out, _ = apply_tone_recovery(
            image,
            strength=self.params.get("strength"),
            black_point=self.params.get("black_point"),
            white_point=self.params.get("white_point"),
            midtone=self.params.get("midtone"),
            local_contrast=self.params.get("local_contrast"),
        )
        return out


@dataclass(frozen=True)
class NegativeFilmBaseOp(Operation):
    """Remove color mask and invert a color negative into a positive baseline."""

    name: str = "negative-film-base"

    def apply(self, image: np.ndarray) -> np.ndarray:
        from photo_calibrator.core.calibration import prepare_negative_film_base
        return prepare_negative_film_base(image)


@dataclass(frozen=True)
class NegativeFilmRefineOp(Operation):
    """Refine the positive baseline produced by NegativeFilmBaseOp."""

    name: str = "negative-film-refine"

    def apply(self, image: np.ndarray) -> np.ndarray:
        strength = float(self.params.get("strength", 0.8))
        from photo_calibrator.core.calibration import refine_negative_film_positive
        return refine_negative_film_positive(image, strength=strength)
