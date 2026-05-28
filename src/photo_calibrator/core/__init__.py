"""Core image analysis and calibration primitives."""

from .calibration import CalibrationMode, CalibrationParams, CalibrationResult, calibrate_image
from .cast_detection import CastReport, analyze_image_array, auto_detect_cast
from .image_model import ImageBuffer

__all__ = [
    "CalibrationMode",
    "CalibrationParams",
    "CalibrationResult",
    "CastReport",
    "ImageBuffer",
    "analyze_image_array",
    "auto_detect_cast",
    "calibrate_image",
]
