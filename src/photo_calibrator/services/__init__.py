from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

from photo_calibrator.ai import EvalInput, EvalOutput, EvalScore, MockProvider
from photo_calibrator.core.image_model import ImageBuffer
from photo_calibrator.plugins import PluginManager

from .contracts import HookNotSupportedError, ServiceError


@dataclass(frozen=True)
class PluginInfo:
    id: str
    name: str
    version: str
    hooks: list[str]
    permissions: list[str]


@dataclass(frozen=True)
class ReaderResult:
    image: ImageBuffer
    plugin_id: str
    reader_name: str
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class WriterResult:
    plugin_id: str
    writer_name: str
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class AnalyzerResult:
    plugin_id: str
    analyzer_name: str
    result: dict[str, Any]


@dataclass(frozen=True)
class CalibratorResult:
    image: np.ndarray
    plugin_id: str
    calibrator_name: str
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class FilmScanResult:
    plugin_id: str
    detector_name: str
    corners: list[Any]
    angle_deg: float
    crop_rect: dict[str, float]
    confidence: float
    border_type: str | None
    film_format: str | None
    is_perspective: bool
    metadata: dict[str, Any] = field(default_factory=dict)


class PluginService:
    def __init__(self, search_paths: list[Path] | None = None):
        self.manager = PluginManager(search_paths=search_paths)

    def discover(self) -> list[str]:
        return self.manager.discover()

    def _plugin(self, plugin_id: str, hook: str):
        registered = self.manager.get(plugin_id)
        if registered is None or registered not in self.manager.list_for_hook(hook):
            raise HookNotSupportedError(f"Plugin {plugin_id!r} does not provide {hook}")
        return registered

    def _iter(self, hook: str):
        for plugin_id in self.manager.list():
            registered = self.manager.get(plugin_id)
            if registered is not None and registered in self.manager.list_for_hook(hook):
                yield plugin_id, registered

    def list_plugins(self) -> list[PluginInfo]:
        return [self._info(plugin_id, registered) for plugin_id, registered in self._iter_all()]

    def list_hooks_for(self, hook: str) -> list[PluginInfo]:
        return [self._info(plugin_id, registered) for plugin_id, registered in self._iter(hook)]

    def _iter_all(self):
        for plugin_id in self.manager.list():
            registered = self.manager.get(plugin_id)
            if registered is not None:
                yield plugin_id, registered

    def _info(self, plugin_id: str, registered) -> PluginInfo:
        manifest = registered.manifest
        hooks = [name for name in ("image_reader", "image_writer", "analyzer", "calibrator", "film_scan_detector", "ai_evaluator") if registered in self.manager.list_for_hook(name)]
        return PluginInfo(
            id=plugin_id,
            name=manifest.name if manifest else type(registered.instance).__name__,
            version=manifest.version if manifest else "builtin",
            hooks=hooks,
            permissions=list(manifest.permissions) if manifest else [],
        )

    def run_image_reader(self, path: str | Path, *, reader_id: str | None = None, **kwargs: Any) -> ReaderResult:
        suffix = Path(path).suffix.lower()
        candidates = [(reader_id, self._plugin(reader_id, "image_reader"))] if reader_id else list(self._iter("image_reader"))
        for plugin_id, registered in candidates:
            instance = registered.instance
            if not reader_id and suffix not in {str(ext).lower() for ext in instance.supported_extensions}:
                continue
            try:
                image = instance.read(str(path), **kwargs)
            except Exception as exc:
                raise ServiceError(f"Image reader {plugin_id} failed: {exc}") from exc
            if isinstance(image, np.ndarray):
                image = ImageBuffer(image)
            if not isinstance(image, ImageBuffer):
                raise ServiceError(f"Image reader {plugin_id} returned an unsupported result")
            return ReaderResult(image, plugin_id, type(instance).__name__)
        raise HookNotSupportedError(f"No image reader supports {suffix or path}")

    def run_image_writer(self, image: ImageBuffer, path: str | Path, *, writer_id: str | None = None, format: str = "", **kwargs: Any) -> WriterResult:
        candidates = [(writer_id, self._plugin(writer_id, "image_writer"))] if writer_id else list(self._iter("image_writer"))
        for plugin_id, registered in candidates:
            instance = registered.instance
            if not writer_id and str(instance.format_name).lower() != format.lower():
                continue
            try:
                result = instance.write(image, str(path), **kwargs)
            except Exception as exc:
                raise ServiceError(f"Image writer {plugin_id} failed: {exc}") from exc
            return WriterResult(plugin_id, str(instance.format_name), result if isinstance(result, dict) else {})
        raise HookNotSupportedError(f"No image writer supports {format}")

    def run_analyzers(self, image: np.ndarray, *, analyzer_ids: list[str] | None = None, **kwargs: Any) -> list[AnalyzerResult]:
        candidates = [(plugin_id, self._plugin(plugin_id, "analyzer")) for plugin_id in analyzer_ids] if analyzer_ids else list(self._iter("analyzer"))
        results = []
        for plugin_id, registered in candidates:
            instance = registered.instance
            try:
                value = instance.analyze(image, **kwargs)
            except Exception as exc:
                raise ServiceError(f"Analyzer {plugin_id} failed: {exc}") from exc
            results.append(AnalyzerResult(plugin_id, str(instance.analyzer_name), value))
        return results

    def run_calibrator(self, image: np.ndarray, params: dict[str, Any], *, calibrator_id: str, **kwargs: Any) -> CalibratorResult:
        registered = self._plugin(calibrator_id, "calibrator")
        instance = registered.instance
        try:
            value = instance.calibrate(image, params, **kwargs)
        except TypeError:
            value = instance.calibrate(image, params)
        except Exception as exc:
            raise ServiceError(f"Calibrator {calibrator_id} failed: {exc}") from exc
        metadata = value.get("metadata", {}) if isinstance(value, dict) else {}
        output = value.get("image") if isinstance(value, dict) else value
        return CalibratorResult(np.asarray(output), calibrator_id, str(instance.calibrator_name), metadata)

    def run_film_scan(self, image: np.ndarray, *, detector_id: str, **kwargs: Any) -> FilmScanResult:
        registered = self._plugin(detector_id, "film_scan_detector")
        instance = registered.instance
        try:
            value = instance.detect(image, **kwargs)
        except Exception as exc:
            raise ServiceError(f"Film detector {detector_id} failed: {exc}") from exc
        return FilmScanResult(
            plugin_id=detector_id,
            detector_name=str(instance.detector_name),
            corners=list(value.get("corners", [])),
            angle_deg=float(value.get("angle_deg", 0.0)),
            crop_rect=dict(value.get("crop_rect", {})),
            confidence=float(value.get("confidence", 0.0)),
            border_type=value.get("border_type"),
            film_format=value.get("film_format"),
            is_perspective=bool(value.get("is_perspective", False)),
            metadata={key: item for key, item in value.items() if key not in {"corners", "angle_deg", "crop_rect", "confidence", "border_type", "film_format", "is_perspective"}},
        )


class AIEvaluationService:
    def __init__(self, plugin_service: PluginService):
        self.plugin_service = plugin_service

    def list_evaluators(self) -> list[dict[str, Any]]:
        result = [{"id": "__default__", "name": "Built-in mock evaluator", "source": "native", "supports_network": False}]
        for item in self.plugin_service.list_hooks_for("ai_evaluator"):
            registered = self.plugin_service.manager.get(item.id)
            instance = registered.instance
            result.append({"id": item.id, "name": str(instance.evaluator_name), "source": "plugin", "supports_network": bool(instance.requires_network)})
        return result

    def evaluate(self, evaluator_name: str, input: EvalInput, images: list[np.ndarray], *, timeout_seconds: float | None = None) -> EvalOutput:
        if evaluator_name == "__default__":
            output = self.evaluate_with_provider(MockProvider(), input, images, timeout_seconds=timeout_seconds)
            return _with_metadata(output, {"source": "native"})
        registered = self.plugin_service._plugin(evaluator_name, "ai_evaluator")
        instance = registered.instance
        output = _run_with_timeout(lambda: instance.evaluate(images[0], images[1], analysis=input.analysis, context=input.context, calibration_params=input.calibration_params), timeout_seconds)
        return _normalize_eval(output, {"source": "plugin", "plugin_id": evaluator_name, "context": input.context, "has_calibration_params": input.calibration_params is not None})

    def evaluate_with_provider(self, provider, input: EvalInput, images: list[np.ndarray], *, timeout_seconds: float | None = None) -> EvalOutput:
        output = _run_with_timeout(lambda: provider.evaluate(input, images), timeout_seconds)
        return _normalize_eval(output, {"source": "native", "provider": provider.name})


def _run_with_timeout(callback, timeout_seconds: float | None):
    if not timeout_seconds:
        return callback()
    executor = ThreadPoolExecutor(max_workers=1)
    future = executor.submit(callback)
    try:
        return future.result(timeout=timeout_seconds)
    except FutureTimeoutError as exc:
        future.cancel()
        raise ServiceError(f"Evaluation timed out after {timeout_seconds:.3f}s") from exc
    finally:
        executor.shutdown(wait=False, cancel_futures=True)


def _with_metadata(output: EvalOutput, metadata: dict[str, Any]) -> EvalOutput:
    return EvalOutput(output.overall_score, output.scores, output.reasoning, output.suggestions, output.warnings, {**output.metadata, **metadata})


def _normalize_eval(value: Any, metadata: dict[str, Any]) -> EvalOutput:
    if isinstance(value, EvalOutput):
        return _with_metadata(value, metadata)
    if not isinstance(value, dict):
        raise ServiceError("AI evaluator returned an unsupported result")
    scores = [EvalScore(**score) for score in value.get("scores", []) if isinstance(score, dict)]
    return EvalOutput(
        overall_score=float(value.get("overall_score", value.get("score", 0.0))),
        scores=scores,
        reasoning=str(value.get("reasoning", "")),
        suggestions=list(value.get("suggestions", [])),
        warnings=list(value.get("warnings", [])),
        metadata={**dict(value.get("metadata", {})), **metadata},
    )


__all__ = ["AIEvaluationService", "PluginService", "HookNotSupportedError", "ServiceError"]
