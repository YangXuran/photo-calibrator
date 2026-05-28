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
        from photo_calibrator.core.calibration import calibrate_rgb_curves
        return calibrate_rgb_curves(image, strength=strength)


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
