"""Plugin hook specifications for Photo Calibrator.

Each hook is a protocol (abstract interface) that plugins implement.
The plugin manager discovers and registers conforming implementations,
then the backend/pipeline calls them at the appropriate lifecycle points.
"""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable


# ── Hook protocols ──────────────────────────────────────────────────


@runtime_checkable
class ImageReaderHook(Protocol):
    """Add support for an image input format."""

    @property
    def supported_extensions(self) -> list[str]:
        """File extensions this reader handles, e.g. ['.cr3', '.nef']."""
        ...

    def read(self, path: str, **kwargs: Any) -> Any:
        """Read an image file and return a numpy array or ImageBuffer."""
        ...


@runtime_checkable
class ImageWriterHook(Protocol):
    """Add support for an image output format."""

    @property
    def format_name(self) -> str:
        """Format identifier, e.g. 'jpeg', 'tiff16', 'exr'."""
        ...

    def write(self, image: Any, path: str, **kwargs: Any) -> None:
        """Write image data to a file."""
        ...


@runtime_checkable
class AnalyzerHook(Protocol):
    """Provide additional image analysis beyond the built-in cast detection."""

    @property
    def analyzer_name(self) -> str:
        """Human-readable name, e.g. 'skin-tone', 'sharpness'."""
        ...

    def analyze(self, image: Any, **kwargs: Any) -> dict[str, Any]:
        """Run analysis and return a dict of metrics.

        Returned dict must be JSON-serializable.
        """
        ...


@runtime_checkable
class CalibratorHook(Protocol):
    """Provide a custom calibration algorithm."""

    @property
    def calibrator_name(self) -> str:
        """Human-readable name, e.g. 'film-look', 'cross-process'."""
        ...

    def calibrate(self, image: Any, params: dict[str, Any], **kwargs: Any) -> Any:
        """Apply calibration and optionally consume backend context fields."""
        ...


@runtime_checkable
class FilmScanHook(Protocol):
    """Custom film border / rotation / crop detection."""

    @property
    def detector_name(self) -> str:
        """Human-readable name, e.g. 'medium-format-borders'."""
        ...

    def detect(self, image: Any, **kwargs: Any) -> dict[str, Any]:
        """Detect film frame geometry.

        Returns dict with at minimum: corners, angle_deg, crop_rect, confidence.
        """
        ...


@runtime_checkable
class AIEvaluatorHook(Protocol):
    """Provide AI-powered evaluation of calibration results."""

    @property
    def evaluator_name(self) -> str:
        """Human-readable name, e.g. 'gpt-vision', 'claude-opus'."""
        ...

    @property
    def requires_network(self) -> bool:
        """Whether this evaluator makes network calls."""
        ...

    def evaluate(
        self,
        original: Any,
        calibrated: Any,
        analysis: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Evaluate calibration quality.

        Returns dict with: score, reasoning, suggestions, metadata.
        Must NOT mutate either image.
        """
        ...


# ── Registry ────────────────────────────────────────────────────────

# All known hook types (for discovery and validation)
HOOK_REGISTRY: dict[str, type] = {
    "image_reader": ImageReaderHook,
    "image_writer": ImageWriterHook,
    "analyzer": AnalyzerHook,
    "calibrator": CalibratorHook,
    "film_scan_detector": FilmScanHook,
    "ai_evaluator": AIEvaluatorHook,
}
