from __future__ import annotations

import argparse
import base64
import io
from copy import deepcopy
from dataclasses import asdict, is_dataclass, replace
import hashlib
import json
import mimetypes
import os
import sys
import tempfile
import time
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor, as_completed
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Event, Lock, Thread
from urllib.parse import parse_qs, urlparse
from uuid import uuid4

import cv2
import numpy as np

from photo_calibrator.core.accelerator import ACCELERATOR, accelerator_payload, benchmark_accelerator, set_accelerator_backend
from photo_calibrator.core.calibration import (
    CalibrationMode,
    CalibrationParams,
    _from_calibration_working_space,
    _to_calibration_working_space,
    apply_3d_lut,
    apply_tone_recovery,
    calibrate_global,
    calibrate_image,
    calibrate_image_from_analysis,
    calibrate_rgb_curves,
    curve_interpolate,
    prepare_negative_film_base,
)
from photo_calibrator.core.cast_detection import analyze_image_array, auto_detect_cast, detect_neutral_mask, ensure_uint8_rgb, rgb_to_lab_float
from photo_calibrator.core.film_scan import detect_film_frame
from photo_calibrator.core.look import apply_look_adjustments, is_identity_look, normalize_look_adjustments
from photo_calibrator.backend.schemas import AnalysisEntry, PreparedImage
from photo_calibrator.ai import EvalImageRef, EvalInput, MockProvider, OpenAICompatibleProvider, ProviderConfig
from photo_calibrator.core.image_model import ImageBuffer
from photo_calibrator.io import read_image
from photo_calibrator.io.icc_profiles import ExportProfile
from photo_calibrator.io.raw import decode_raw_image, is_raw_extension
from photo_calibrator.pipeline import CalibrationOp, LookAdjustmentOp, NegativeFilmBaseOp, NegativeFilmRefineOp, PipelineDocument, ToneRecoveryOp
from photo_calibrator.services import AIEvaluationService, PluginService
from photo_calibrator.services.contracts import HookNotSupportedError, ServiceError
from photo_calibrator.backend.workspace_db import get_workspace_db
from photo_calibrator.backend.config import load_config, save_config as _save_config_to_file

ROOT = Path(__file__).resolve().parents[3]
_FRONTEND_DIST = ROOT / "frontend" / "dist"
WEB_ROOT = _FRONTEND_DIST if _FRONTEND_DIST.is_dir() else ROOT / "web"
PREVIEW_CACHE_DIR = ROOT / ".cache" / "previews"
SESSION_STORE_DIR = ROOT / ".cache" / "sessions"
DEFAULT_ANALYSIS_MAX_SIDE = 3200
FILM_SCAN_MAX_SIDE = 960
MEMORY_CACHE_LIMIT = 128
BATCH_WORKERS = max(1, min(4, os.cpu_count() or 1))
AUTO_BEST_EVAL_MAX_SIDE = 480
AUTO_BEST_MODE = "auto-best"
AUTO_BEST_CANDIDATES = (
    CalibrationMode.GLOBAL,
    CalibrationMode.MIDTONES_ONLY,
    CalibrationMode.HIGHLIGHTS_ONLY,
    CalibrationMode.PRESERVE_SPLIT_TONE,
    CalibrationMode.TONE_ZONE,
    CalibrationMode.MATRIX,
    CalibrationMode.SELECTIVE,
    CalibrationMode.FILM,
)
AUTO_STYLE_PRESETS = {
    "custom",
    "neutral",
    "film",
    "portrait",
    "slide",
    "soft",
}

cv2.setUseOptimized(True)
try:
    cv2.setNumThreads(max(1, (os.cpu_count() or 2) - 1))
except Exception:
    pass


_ANALYSIS_CACHE: OrderedDict[str, AnalysisEntry] = OrderedDict()
_CACHE_LOCK = Lock()
_ANALYSIS_KEY_LOCKS: dict[str, Lock] = {}
_SESSION_SOURCE_CACHE: OrderedDict[str, dict] = OrderedDict()
SESSION_TTL_SECONDS = 3600  # 1 hour
MAX_SESSION_SOURCES = 2048
_PLUGIN_SERVICE: PluginService | None = None
_AI_EVALUATION_SERVICE: AIEvaluationService | None = None
_JOB_EXECUTOR = ThreadPoolExecutor(max_workers=max(2, min(4, os.cpu_count() or 2)))
_BASE_URL: str = "http://127.0.0.1:8765"
PREVIEW_CACHE_DIR = Path(tempfile.gettempdir()) / "photo-calibrator-previews"


def _plugin_service() -> PluginService:
    global _PLUGIN_SERVICE
    if _PLUGIN_SERVICE is None:
        _PLUGIN_SERVICE = PluginService()
        _PLUGIN_SERVICE.discover()
    return _PLUGIN_SERVICE


def _ai_evaluation_service() -> AIEvaluationService:
    global _AI_EVALUATION_SERVICE
    if _AI_EVALUATION_SERVICE is None:
        _AI_EVALUATION_SERVICE = AIEvaluationService(_plugin_service())
    return _AI_EVALUATION_SERVICE


def _remember_analysis(entry: AnalysisEntry) -> AnalysisEntry:
    with _CACHE_LOCK:
        _ANALYSIS_CACHE[entry.cache_key] = entry
        _ANALYSIS_CACHE.move_to_end(entry.cache_key)
        while len(_ANALYSIS_CACHE) > MEMORY_CACHE_LIMIT:
            evicted_key, _ = _ANALYSIS_CACHE.popitem(last=False)
            _ANALYSIS_KEY_LOCKS.pop(evicted_key, None)
    return entry


def _remember_session_source(cache_key: str, source_info: dict) -> None:
    with _CACHE_LOCK:
        _SESSION_SOURCE_CACHE[cache_key] = source_info
        _SESSION_SOURCE_CACHE.move_to_end(cache_key)
        while len(_SESSION_SOURCE_CACHE) > MAX_SESSION_SOURCES:
            _SESSION_SOURCE_CACHE.popitem(last=False)
        # Also store under a stable key (without max_side suffix) for recovery
        stable_key = _stable_session_key(cache_key)
        if stable_key:
            _SESSION_SOURCE_CACHE[stable_key] = source_info
            _SESSION_SOURCE_CACHE.move_to_end(stable_key)


def _stable_session_key(cache_key: str) -> str | None:
    parts = cache_key.split(":")
    if parts[0] == "file":
        idx = next((i for i in range(2, len(parts)) if parts[i].isdigit()), None)
        if idx is not None:
            return ":".join(parts[:idx] + parts[idx + 1:])
    return None


def _get_analysis(cache_key: str) -> AnalysisEntry | None:
    with _CACHE_LOCK:
        entry = _ANALYSIS_CACHE.get(cache_key)
        if entry is not None:
            if time.time() - entry.created_at > SESSION_TTL_SECONDS:
                _ANALYSIS_CACHE.pop(cache_key, None)
                _ANALYSIS_KEY_LOCKS.pop(cache_key, None)
                return None
            _ANALYSIS_CACHE.move_to_end(cache_key)
            return entry

    source = _SESSION_SOURCE_CACHE.get(cache_key)
    if source is None:
        stable_key = _stable_session_key(cache_key)
        if stable_key:
            source = _SESSION_SOURCE_CACHE.get(stable_key)
    if source and source.get("source_path"):
        return _prepare_file_analysis(
            source["source_path"],
            reader_plugin=source.get("reader_plugin"),
            raw_options=source.get("raw_options"),
        )
    if source and source.get("image_data"):
        return _prepare_uploaded_analysis(
            source["image_data"],
            file_name=source.get("file_name", ""),
            reader_plugin=source.get("reader_plugin"),
            raw_options=source.get("raw_options"),
        )
    return None


def _analysis_key_lock(cache_key: str) -> Lock:
    with _CACHE_LOCK:
        lock = _ANALYSIS_KEY_LOCKS.get(cache_key)
        if lock is None:
            lock = Lock()
            _ANALYSIS_KEY_LOCKS[cache_key] = lock
        return lock


def _build_analysis_entry(cache_key: str, prepare) -> AnalysisEntry:
    cached = _get_analysis(cache_key)
    if cached is not None:
        return cached

    lock = _analysis_key_lock(cache_key)
    with lock:
        cached = _get_analysis(cache_key)
        if cached is not None:
            return cached
        prepared = prepare()
        input_report = analyze_image_array(prepared.image)
        zones = auto_detect_cast(prepared.image)
        static_charts = _static_chart_payload(
            input_report,
            _render_preview_rgb(
                prepared.image,
                color_space=prepared.color_space,
                data_range=prepared.data_range,
            ),
        )
        return _remember_analysis(
            AnalysisEntry(
                prepared=prepared,
                input_report=input_report,
                zones=zones,
                static_charts=static_charts,
                cache_key=cache_key,
                created_at=time.time(),
            )
        )


def _decode_data_url(data_url: str) -> np.ndarray:
    raw, _ = _data_url_bytes(data_url)
    bgr, _ = _decode_preview_bgr(raw, "", DEFAULT_ANALYSIS_MAX_SIDE)
    return ACCELERATOR.bgr_to_rgb(_normalize_bgr(bgr))


def _data_url_bytes(data_url: str) -> tuple[bytes, str]:
    if "," not in data_url:
        raise ValueError("image_data must be a data URL")
    header, payload = data_url.split(",", 1)
    return base64.b64decode(payload), header


def _uploaded_cache_key(raw: bytes, file_name: str, max_side: int, reader_plugin: str | None = None) -> str:
    digest = hashlib.sha256(raw).hexdigest()
    plugin_part = f":reader={reader_plugin}" if reader_plugin else ""
    return f"upload:{digest}:{Path(file_name).name.lower()}:{int(max_side)}{plugin_part}"


def _file_cache_key(path: Path, max_side: int, reader_plugin: str | None = None) -> str:
    plugin_part = f":reader={reader_plugin}" if reader_plugin else ""
    return f"file:{_preview_cache_key(path, max_side)}{plugin_part}"


def _analysis_entry_for_prepared(prepared: PreparedImage, cache_key: str) -> AnalysisEntry:
    return _build_analysis_entry(cache_key, lambda: prepared)


def _session_metadata(entry: AnalysisEntry) -> dict:
    return entry.session_metadata


def _json_safe(value):
    if is_dataclass(value):
        return _json_safe(asdict(value))
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, np.ndarray):
        return value.tolist()
    return value


def _encode_array_payload(array: np.ndarray) -> dict[str, object]:
    buffer = io.BytesIO()
    np.save(buffer, array, allow_pickle=False)
    return {
        "dtype": str(array.dtype),
        "shape": list(array.shape),
        "data": base64.b64encode(buffer.getvalue()).decode("ascii"),
    }


def _decode_array_payload(payload: dict) -> np.ndarray:
    raw = base64.b64decode(payload["data"])
    return np.load(io.BytesIO(raw), allow_pickle=False)


def _record_session_calibration(entry: AnalysisEntry, payload: dict) -> None:
    meta = _session_metadata(entry)
    processing = payload.get("processing", {})
    meta["last_calibration"] = {
        "mode": payload.get("mode"),
        "shift": deepcopy(payload.get("shift", {})),
        "reduction_pct": payload.get("reduction_pct"),
        "processing": {
            "calibration_source": processing.get("calibration_source"),
            "plugin_id": processing.get("calibration_plugin_id"),
            "plugin_name": processing.get("calibration_plugin_name"),
        },
    }
    if "document" in payload:
        meta["document"] = deepcopy(payload["document"])


def _record_ai_evaluation(entry: AnalysisEntry, evaluator_name: str, evaluation: dict) -> None:
    meta = _session_metadata(entry)
    evaluations = meta.setdefault("ai_evaluations", {})
    evaluations[evaluator_name] = deepcopy(_json_safe(evaluation))


def _record_ai_request(entry: AnalysisEntry, payload: dict) -> None:
    meta = _session_metadata(entry)
    requests = meta.setdefault("ai_requests", [])
    requests.append(deepcopy(_json_safe(payload)))
    if len(requests) > 20:
        del requests[:-20]


def _session_sidecar_metadata(entry: AnalysisEntry) -> dict[str, object]:
    meta = _session_metadata(entry)
    return {
        "session_id": entry.cache_key,
        "analysis": {
            "width": entry.prepared.analysis_width,
            "height": entry.prepared.analysis_height,
            "preview_source": entry.prepared.preview_source,
            "source_dtype": entry.prepared.source_dtype,
            "color_space": entry.prepared.color_space,
            "data_range": list(entry.prepared.data_range) if entry.prepared.data_range is not None else None,
        },
        "last_calibration": deepcopy(meta.get("last_calibration")),
        "document": deepcopy(meta.get("document")),
        "ai_requests": deepcopy(meta.get("ai_requests", [])),
    }


def _provider_summary(provider) -> dict[str, object]:
    if isinstance(provider, MockProvider):
        return {"type": "mock", "name": provider.name}
    if isinstance(provider, OpenAICompatibleProvider):
        config = getattr(provider, "_config", None)
        if config is not None:
            return {
                "type": "openai_compatible",
                "name": provider.name,
                "base_url": config.base_url,
                "model": config.model,
                "timeout": config.timeout,
                "max_tokens": config.max_tokens,
            }
    return {"type": "custom", "name": getattr(provider, "name", provider.__class__.__name__)}


def _provider_from_body(body: dict):
    config = body.get("provider") or body.get("provider_config")
    if not isinstance(config, dict):
        return None
    provider_type = str(config.get("type", "openai_compatible")).strip().lower()
    if provider_type == "mock":
        return MockProvider(
            score=float(config.get("score", 0.5)),
            reasoning=str(config.get("reasoning", "")),
        )
    if provider_type in {"openai", "openai_compatible", "openai-compatible"}:
        base_url = str(config.get("base_url", "")).strip()
        model = str(config.get("model", "")).strip()
        if not base_url or not model:
            raise ValueError("provider_config requires base_url and model")
        return OpenAICompatibleProvider(
            ProviderConfig(
                base_url=base_url,
                model=model,
                api_key=str(config.get("api_key", "")),
                timeout=int(config.get("timeout", 60)),
                max_tokens=int(config.get("max_tokens", 1024)),
                temperature=float(config.get("temperature", 0.3)),
            )
        )
    raise ValueError(f"Unsupported provider type: {provider_type}")


def _export_settings_payload(
    *,
    fmt: str,
    output_path: Path,
    source_buffer,
    quality: int | None = None,
    embed_icc: bool = True,
    preserve_metadata: bool = True,
    transform: str = "auto",
    export_profile: str | None = None,
    user_profile_path: str | None = None,
    ocio_config_path: str | None = None,
    ocio_display_space: str = "sRGB - Display",
    ocio_scene_linear_space: str = "scene_linear",
) -> dict[str, object]:
    return {
        "format": fmt,
        "output_path": str(output_path),
        "quality": quality,
        "export_transform": transform,
        "export_profile": export_profile or "passthrough",
        "embed_icc": bool(embed_icc),
        "preserve_metadata": bool(preserve_metadata),
        "ocio_config_path": ocio_config_path,
        "ocio_display_space": ocio_display_space,
        "ocio_scene_linear_space": ocio_scene_linear_space,
        "color_space": source_buffer.color_space,
        "bit_depth": int(source_buffer.bit_depth),
        "data_range": list(source_buffer.data_range) if source_buffer.data_range is not None else None,
        "icc_embedded": bool(embed_icc and source_buffer.icc_profile),
        "metadata_keys": sorted(str(key) for key in source_buffer.metadata.keys()),
    }


def _source_input_metadata(source_buffer) -> dict[str, object]:
    return {
        "color_space": source_buffer.color_space,
        "bit_depth": int(source_buffer.bit_depth),
        "data_range": list(source_buffer.data_range) if source_buffer.data_range is not None else None,
        "icc_embedded": bool(source_buffer.icc_profile),
        "metadata": deepcopy(source_buffer.metadata),
    }


def _document_operations_from_payload(payload: dict) -> list[dict[str, object]]:
    processing = payload.get("processing", {})
    calibration_source = processing.get("calibration_source") or payload.get("metadata", {}).get("calibration_source")
    if calibration_source == "plugin":
        plugin_id = processing.get("calibration_plugin_id") or payload.get("metadata", {}).get("plugin_id")
        return [{
            "name": "plugin-calibration",
            "params": {
                "plugin_id": plugin_id,
                "plugin_name": processing.get("calibration_plugin_name") or payload.get("metadata", {}).get("plugin_name"),
                "mode": payload.get("mode"),
                "strength": payload.get("params").strength if payload.get("params") is not None else None,
            },
            "replayable": False,
        }]
    params = payload.get("params")
    if params is None:
        return []
    operations: list[dict[str, object]] = []
    if processing.get("analysis_basis") == "negative-positive-base" and params.mode != CalibrationMode.NEGATIVE_FILM:
        operations.append({
            "name": NegativeFilmBaseOp().name,
            "params": {"enabled": True, "stage": "base"},
            "replayable": True,
        })
    if params.mode == CalibrationMode.NEGATIVE_FILM:
        operations.extend([
            {
                "name": NegativeFilmBaseOp().name,
                "params": {"mode": params.mode.value, "stage": "base"},
                "replayable": True,
            },
            {
                "name": NegativeFilmRefineOp().name,
                "params": {"strength": params.strength, "stage": "refine"},
                "replayable": True,
            },
        ])
    else:
        op = CalibrationOp(
            params={
                "mode": params.mode.value,
                "a_shift": payload.get("shift", {}).get("a"),
                "b_shift": payload.get("shift", {}).get("b"),
                "strength": params.strength,
                "highlight_pct": params.highlight_pct,
                "sat_pct": params.sat_pct,
                "curve_low_pct": params.curve_low_pct,
                "curve_high_pct": params.curve_high_pct,
                "gamma": list(params.gamma) if params.gamma is not None else None,
                "matrix": [list(row) for row in params.matrix] if params.matrix is not None else None,
                "lut_size": params.lut_size,
            },
        )
        operations.append({"name": op.name, "params": _json_safe(op.params), "replayable": True})
    look_adjustments = payload.get("look_adjustments") or processing.get("look_adjustments")
    if look_adjustments is not None and not is_identity_look(look_adjustments):
        operations.append({
            "name": LookAdjustmentOp().name,
            "params": _json_safe(normalize_look_adjustments(look_adjustments)),
            "replayable": True,
        })
    tone_recovery = payload.get("tone_recovery") or processing.get("tone_recovery")
    if isinstance(tone_recovery, dict) and tone_recovery.get("enabled"):
        operations.append({
            "name": ToneRecoveryOp().name,
            "params": _json_safe(tone_recovery),
            "replayable": True,
        })
    return operations


def _render_document_from_metadata(entry: AnalysisEntry) -> tuple[dict[str, object], np.ndarray]:
    meta = _session_metadata(entry)
    stored = deepcopy(meta.get("document")) if isinstance(meta.get("document"), dict) else None
    source = entry.prepared.image
    if not stored:
        return {"source": "session-analysis", "operations": []}, source
    operations = stored.get("operations", [])
    doc = PipelineDocument(source_image=source)
    replayable_ops: list[dict[str, object]] = []
    for op in operations:
        if not op.get("replayable", False):
            continue
        if op.get("name") == "calibration":
            doc.add_op(CalibrationOp(params=dict(op.get("params", {}))))
            replayable_ops.append(op)
        elif op.get("name") == "negative-film-base":
            doc.add_op(NegativeFilmBaseOp(params=dict(op.get("params", {}))))
            replayable_ops.append(op)
        elif op.get("name") == "negative-film-refine":
            doc.add_op(NegativeFilmRefineOp(params=dict(op.get("params", {}))))
            replayable_ops.append(op)
        elif op.get("name") == "look-adjustment":
            doc.add_op(LookAdjustmentOp(params=dict(op.get("params", {}))))
            replayable_ops.append(op)
        elif op.get("name") == "tone-recovery":
            doc.add_op(ToneRecoveryOp(params=dict(op.get("params", {}))))
            replayable_ops.append(op)
    rendered = doc.render() if replayable_ops else source
    return {
        "source": stored.get("source", "session-analysis"),
        "operations": operations,
        "replayable_operations": replayable_ops,
    }, rendered


def _session_document_payload(entry: AnalysisEntry, payload: dict | None = None) -> dict[str, object]:
    meta = _session_metadata(entry)
    existing = deepcopy(meta.get("document")) if isinstance(meta.get("document"), dict) else None
    if payload is None:
        if existing is not None:
            return existing
        return {"source": "session-analysis", "operations": []}
    new_ops = _document_operations_from_payload(payload)
    operations = []
    if existing is not None:
        operations.extend(existing.get("operations", []))
    operations.extend(new_ops)
    return {"source": "session-analysis", "operations": operations}


def _document_payload(body: dict) -> dict:
    session_id = str(body["session_id"])
    entry = _get_analysis(session_id)
    if entry is None:
        raise ValueError("Unknown or expired session_id")
    document, _ = _render_document_from_metadata(entry)
    return {
        "ok": True,
        "session_id": session_id,
        "document": document,
    }


def _document_render_payload(body: dict) -> dict:
    session_id = str(body["session_id"])
    entry = _get_analysis(session_id)
    if entry is None:
        raise ValueError("Unknown or expired session_id")
    document, rendered = _render_document_from_metadata(entry)
    report = analyze_image_array(rendered)
    prepared = entry.prepared
    return {
        "ok": True,
        "session_id": session_id,
        "document": document,
        "output": _report_payload(report),
        "calibrated_image": _save_preview_image(
            _render_preview_rgb(
                rendered,
                color_space=prepared.color_space,
                data_range=prepared.data_range,
            )
        ),
        "processing": {
            "analysis_width": prepared.analysis_width,
            "analysis_height": prepared.analysis_height,
            "preview_source": prepared.preview_source,
            "document_replayable_ops": len(document.get("replayable_operations", [])),
        },
    }


def _export_policy(body: dict) -> dict[str, object]:
    return {
        "embed_icc": bool(body.get("embed_icc", True)),
        "preserve_metadata": bool(body.get("preserve_metadata", True)),
        "transform": str(body.get("export_transform", "auto")),
        "export_profile": body.get("export_profile"),
        "user_profile_path": body.get("user_profile_path"),
        "ocio_config_path": body.get("ocio_config_path"),
        "ocio_display_space": str(body.get("ocio_display_space", "sRGB - Display")),
        "ocio_scene_linear_space": str(body.get("ocio_scene_linear_space", "scene_linear")),
    }


def _export_buffer_from_result(source_buffer: ImageBuffer, export_image: np.ndarray, body: dict) -> ImageBuffer:
    policy = _export_policy(body)
    return ImageBuffer(
        data=export_image,
        color_space=source_buffer.color_space,
        data_range=source_buffer.data_range,
        icc_profile=source_buffer.icc_profile if policy["embed_icc"] else None,
        metadata=deepcopy(source_buffer.metadata) if policy["preserve_metadata"] else {},
        orientation=source_buffer.orientation,
    )


def _crop_rect_from_body(body: dict) -> dict[str, float] | None:
    value = body.get("crop_rect")
    if not isinstance(value, dict):
        return None
    try:
        left = float(value.get("left", 0.0))
        top = float(value.get("top", 0.0))
        width = float(value.get("width", 1.0))
        height = float(value.get("height", 1.0))
    except (TypeError, ValueError):
        raise ValueError("crop_rect values must be numbers") from None

    left = float(np.clip(left, 0.0, 0.999))
    top = float(np.clip(top, 0.0, 0.999))
    width = float(np.clip(width, 0.0, 1.0 - left))
    height = float(np.clip(height, 0.0, 1.0 - top))
    if width <= 0.0 or height <= 0.0:
        raise ValueError("crop_rect width and height must be positive")
    if left <= 0.0001 and top <= 0.0001 and width >= 0.999 and height >= 0.999:
        return None
    return {"left": left, "top": top, "width": width, "height": height}


def _perspective_correction_from_body(body: dict) -> dict | None:
    value = body.get("perspective_correction", body.get("perspective"))
    if not isinstance(value, dict):
        return None
    enabled = bool(value.get("enabled", True))
    if not enabled:
        return None

    raw_corners = value.get("corners_normalized", value.get("corners"))
    if not isinstance(raw_corners, list) or len(raw_corners) != 4:
        raise ValueError("perspective_correction requires four corners")

    try:
        source_width = float(value.get("source_width") or 0.0)
        source_height = float(value.get("source_height") or 0.0)
    except (TypeError, ValueError):
        raise ValueError("perspective_correction source size must be numeric") from None

    corners: list[tuple[float, float]] = []
    for point in raw_corners:
        if isinstance(point, dict):
            x = float(point.get("x"))
            y = float(point.get("y"))
        elif isinstance(point, (list, tuple)) and len(point) >= 2:
            x = float(point[0])
            y = float(point[1])
        else:
            raise ValueError("perspective_correction corners must be [x, y] pairs")
        corners.append((x, y))

    normalized = all(-0.001 <= x <= 1.001 and -0.001 <= y <= 1.001 for x, y in corners)
    if not normalized:
        if source_width <= 0.0 or source_height <= 0.0:
            raise ValueError("absolute perspective_correction corners require source_width/source_height")
        corners = [(x / source_width, y / source_height) for x, y in corners]

    clipped = [
        (float(np.clip(x, 0.0, 1.0)), float(np.clip(y, 0.0, 1.0)))
        for x, y in corners
    ]
    if len({(round(x, 5), round(y, 5)) for x, y in clipped}) < 4:
        raise ValueError("perspective_correction corners must describe a quadrilateral")

    return {
        "enabled": True,
        "corners": [[x, y] for x, y in clipped],
        "source_width": source_width or None,
        "source_height": source_height or None,
    }


def _apply_crop_rect(image: np.ndarray, crop_rect: dict[str, float] | None) -> np.ndarray:
    if not crop_rect:
        return image
    height, width = image.shape[:2]
    if width <= 1 or height <= 1:
        return image
    x0 = int(round(crop_rect["left"] * width))
    y0 = int(round(crop_rect["top"] * height))
    x1 = int(round((crop_rect["left"] + crop_rect["width"]) * width))
    y1 = int(round((crop_rect["top"] + crop_rect["height"]) * height))
    x0 = max(0, min(x0, width - 1))
    y0 = max(0, min(y0, height - 1))
    x1 = max(x0 + 1, min(x1, width))
    y1 = max(y0 + 1, min(y1, height))
    return np.ascontiguousarray(image[y0:y1, x0:x1])


def _perspective_points_for_image(
    correction: dict,
    width: int,
    height: int,
) -> np.ndarray:
    scale_x = max(width - 1, 1)
    scale_y = max(height - 1, 1)
    return np.array(
        [
            [float(point[0]) * scale_x, float(point[1]) * scale_y]
            for point in correction["corners"]
        ],
        dtype=np.float32,
    )


def _perspective_target_size(src: np.ndarray) -> tuple[int, int]:
    tl, tr, br, bl = src
    top = float(np.linalg.norm(tr - tl))
    bottom = float(np.linalg.norm(br - bl))
    left = float(np.linalg.norm(bl - tl))
    right = float(np.linalg.norm(br - tr))
    target_w = max(1, int(round((top + bottom) * 0.5)))
    target_h = max(1, int(round((left + right) * 0.5)))
    return target_w, target_h


def _warp_border_value(image: np.ndarray):
    if image.size == 0:
        return 0.0
    if image.ndim == 3:
        return tuple(float(np.median(image[:, :, idx])) for idx in range(image.shape[2]))
    return float(np.median(image))


def _project_crop_rect_after_perspective(
    crop_rect: dict[str, float] | None,
    matrix: np.ndarray,
    source_size: tuple[int, int],
    target_size: tuple[int, int],
) -> dict[str, float] | None:
    if not crop_rect:
        return None
    src_w, src_h = source_size
    dst_w, dst_h = target_size
    x0 = crop_rect["left"] * max(src_w - 1, 1)
    y0 = crop_rect["top"] * max(src_h - 1, 1)
    x1 = (crop_rect["left"] + crop_rect["width"]) * max(src_w - 1, 1)
    y1 = (crop_rect["top"] + crop_rect["height"]) * max(src_h - 1, 1)
    points = np.array([[[x0, y0]], [[x1, y0]], [[x1, y1]], [[x0, y1]]], dtype=np.float32)
    projected = cv2.perspectiveTransform(points, matrix).reshape(-1, 2)
    left = float(np.floor(np.min(projected[:, 0]))) / max(dst_w, 1)
    top = float(np.floor(np.min(projected[:, 1]))) / max(dst_h, 1)
    right = float(np.ceil(np.max(projected[:, 0]))) / max(dst_w, 1)
    bottom = float(np.ceil(np.max(projected[:, 1]))) / max(dst_h, 1)
    left = float(np.clip(left, 0.0, 0.999))
    top = float(np.clip(top, 0.0, 0.999))
    right = float(np.clip(right, 0.0, 1.0))
    bottom = float(np.clip(bottom, 0.0, 1.0))
    if right <= left or bottom <= top:
        return None
    return {"left": left, "top": top, "width": right - left, "height": bottom - top}


def _apply_perspective_correction(
    image: np.ndarray,
    correction: dict | None,
) -> tuple[np.ndarray, np.ndarray | None, tuple[int, int]]:
    if not correction:
        height, width = image.shape[:2]
        return image, None, (width, height)
    height, width = image.shape[:2]
    if width <= 1 or height <= 1:
        return image, None, (width, height)
    src = _perspective_points_for_image(correction, width, height)
    target_w, target_h = _perspective_target_size(src)
    dst = np.array(
        [[0, 0], [target_w - 1, 0], [target_w - 1, target_h - 1], [0, target_h - 1]],
        dtype=np.float32,
    )
    matrix = cv2.getPerspectiveTransform(src, dst)
    warped = cv2.warpPerspective(
        image,
        matrix,
        (target_w, target_h),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=_warp_border_value(image),
    )
    return np.ascontiguousarray(warped), matrix, (target_w, target_h)


def _image_transform_from_body(body: dict) -> dict[str, float | bool] | None:
    value = body.get("image_transform")
    if not isinstance(value, dict):
        return None
    try:
        rotation = float(value.get("rotation", 0.0))
        flip_h = bool(value.get("flipH", value.get("flip_h", False)))
        flip_v = bool(value.get("flipV", value.get("flip_v", False)))
    except (TypeError, ValueError):
        raise ValueError("image_transform values must be rotation/flip numbers") from None

    rotation = ((rotation + 180.0) % 360.0) - 180.0
    if abs(rotation) < 0.0001 and not flip_h and not flip_v:
        return None
    return {"rotation": rotation, "flip_h": flip_h, "flip_v": flip_v}


def _apply_image_transform(image: np.ndarray, transform: dict[str, float | bool] | None) -> np.ndarray:
    if not transform:
        return image
    result = image
    if transform.get("flip_h") and transform.get("flip_v"):
        result = cv2.flip(result, -1)
    elif transform.get("flip_h"):
        result = cv2.flip(result, 1)
    elif transform.get("flip_v"):
        result = cv2.flip(result, 0)

    rotation = float(transform.get("rotation", 0.0))
    rotation = ((rotation + 180.0) % 360.0) - 180.0
    if abs(rotation) < 0.0001:
        return np.ascontiguousarray(result)
    if abs(rotation - 90.0) < 0.0001:
        return np.ascontiguousarray(cv2.rotate(result, cv2.ROTATE_90_CLOCKWISE))
    if abs(rotation + 90.0) < 0.0001:
        return np.ascontiguousarray(cv2.rotate(result, cv2.ROTATE_90_COUNTERCLOCKWISE))
    if abs(abs(rotation) - 180.0) < 0.0001:
        return np.ascontiguousarray(cv2.rotate(result, cv2.ROTATE_180))

    height, width = result.shape[:2]
    center = (width / 2.0, height / 2.0)
    matrix = cv2.getRotationMatrix2D(center, rotation, 1.0)
    cos = abs(matrix[0, 0])
    sin = abs(matrix[0, 1])
    new_width = int(round(height * sin + width * cos))
    new_height = int(round(height * cos + width * sin))
    matrix[0, 2] += new_width / 2.0 - center[0]
    matrix[1, 2] += new_height / 2.0 - center[1]
    border = float(np.median(result)) if result.size else 0.0
    return cv2.warpAffine(
        result,
        matrix,
        (max(1, new_width), max(1, new_height)),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(border, border, border),
    )


def _apply_crop_and_transform(
    image: np.ndarray,
    crop_rect: dict[str, float] | None,
    image_transform: dict[str, float | bool] | None,
) -> np.ndarray:
    """Apply a source-space crop before rotating or flipping its pixels."""
    return _apply_image_transform(_apply_crop_rect(image, crop_rect), image_transform)


def _apply_geometry_corrections(
    image: np.ndarray,
    crop_rect: dict[str, float] | None,
    image_transform: dict[str, float | bool] | None,
    perspective_correction: dict | None,
) -> np.ndarray:
    """Apply source-space perspective, crop, then rotate/flip.

    Crop rectangles are authored in original image coordinates.  When a
    perspective correction is active, the crop corners are projected through
    the same homography and then cropped in the rectified image.
    """
    if not perspective_correction:
        return _apply_crop_and_transform(image, crop_rect, image_transform)
    src_h, src_w = image.shape[:2]
    corrected, matrix, target_size = _apply_perspective_correction(image, perspective_correction)
    projected_crop = _project_crop_rect_after_perspective(
        crop_rect,
        matrix,
        (src_w, src_h),
        target_size,
    ) if matrix is not None else crop_rect
    return _apply_image_transform(_apply_crop_rect(corrected, projected_crop), image_transform)


def _plugin_reader_id(body: dict) -> str | None:
    value = body.get("reader_plugin")
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _raw_decode_options(body: dict) -> dict[str, object] | None:
    keys = {"raw_white_balance", "white_balance", "raw_output_bps", "output_bps", "raw_no_auto_bright", "no_auto_bright", "raw_user_wb"}
    if not any(key in body for key in keys):
        return None
    white_balance = str(body.get("raw_white_balance", body.get("white_balance", "camera"))).strip().lower()
    options: dict[str, object] = {
        "output_bps": int(body.get("raw_output_bps", body.get("output_bps", 16))),
        "white_balance": white_balance or "camera",
        "no_auto_bright": bool(body.get("raw_no_auto_bright", body.get("no_auto_bright", True))),
    }
    user_wb = body.get("raw_user_wb")
    if user_wb is not None:
        if not isinstance(user_wb, (list, tuple)) or len(user_wb) != 4:
            raise ValueError("raw_user_wb must contain four white-balance multipliers")
        options["user_wb"] = tuple(float(v) for v in user_wb)
    return options


def _plugin_writer_id(body: dict) -> str | None:
    value = body.get("writer_plugin")
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _plugin_film_scan_detector_id(body: dict) -> str | None:
    for key in ("film_scan_detector_plugin", "film_scan_plugin", "detector_plugin"):
        value = body.get(key)
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return None


def _image_buffer_from_plugin_output(image, plugin_id: str, metadata: dict | None = None) -> ImageBuffer:
    if isinstance(image, ImageBuffer):
        merged_metadata = {**image.metadata, **(metadata or {})}
        if merged_metadata == image.metadata:
            return image
        return ImageBuffer(
            data=image.data,
            color_space=image.color_space,
            bit_depth=image.bit_depth,
            data_range=image.data_range,
            icc_profile=image.icc_profile,
            metadata=merged_metadata,
            orientation=image.orientation,
        )
    rgb = np.asarray(image)
    return ImageBuffer(
        data=rgb,
        metadata={"reader": f"plugin:{plugin_id}", **(metadata or {})},
    )


def _read_image_with_plugins(path: str | Path, *, reader_plugin: str | None = None) -> ImageBuffer:
    service = _plugin_service()
    explicit = reader_plugin is not None
    try:
        result = service.run_image_reader(path, reader_id=reader_plugin)
        return _image_buffer_from_plugin_output(result.image, result.plugin_id, result.metadata)
    except HookNotSupportedError:
        if explicit:
            raise
    except ServiceError:
        if explicit:
            raise
    return read_image(path)


def _write_image_with_plugins(
    buf: ImageBuffer,
    path: str | Path,
    *,
    fmt: str,
    quality: int = 92,
    writer_plugin: str | None = None,
    embed_icc: bool = True,
    preserve_metadata: bool = True,
    transform: str = "auto",
    export_profile: str | None = None,
    user_profile_path: str | None = None,
    ocio_config_path: str | Path | None = None,
    ocio_display_space: str = "sRGB - Display",
    ocio_scene_linear_space: str = "scene_linear",
) -> dict[str, object] | None:
    from photo_calibrator.io.writers import write_image

    service = _plugin_service()
    explicit = writer_plugin is not None
    try:
        result = service.run_image_writer(
            buf,
            path,
            writer_id=writer_plugin,
            quality=quality,
            format=fmt,
            embed_icc=embed_icc,
            preserve_metadata=preserve_metadata,
            transform=transform,
            ocio_config_path=ocio_config_path,
            ocio_display_space=ocio_display_space,
            ocio_scene_linear_space=ocio_scene_linear_space,
        )
        return {
            "writer_plugin_id": result.plugin_id,
            "writer_plugin_name": result.writer_name,
            **result.metadata,
        }
    except HookNotSupportedError:
        if explicit:
            raise
    except ServiceError:
        if explicit:
            raise
    write_image(
        buf,
        path,
        quality=quality,
        embed_icc=embed_icc,
        preserve_metadata=preserve_metadata,
        transform=transform,
        export_profile=ExportProfile.from_string(export_profile) if export_profile else None,
        user_profile_path=user_profile_path,
        ocio_config_path=ocio_config_path,
        ocio_display_space=ocio_display_space,
        ocio_scene_linear_space=ocio_scene_linear_space,
    )
    return None


def _prepare_uploaded_analysis(
    data_url: str,
    file_name: str = "",
    max_side: int = DEFAULT_ANALYSIS_MAX_SIDE,
    reader_plugin: str | None = None,
    raw_options: dict[str, object] | None = None,
) -> AnalysisEntry:
    raw, _ = _data_url_bytes(data_url)
    cache_key = _uploaded_cache_key(raw, file_name, max_side, reader_plugin)

    def prepare() -> PreparedImage:
        if reader_plugin:
            suffix = Path(file_name).suffix or ".png"
            with tempfile.NamedTemporaryFile(suffix=suffix) as tmp:
                tmp.write(raw)
                tmp.flush()
                image_buffer = _read_image_with_plugins(tmp.name, reader_plugin=reader_plugin)
            return _prepare_image_buffer_for_analysis(image_buffer, max_side)
        if raw_options is None:
            bgr, preview_source = _decode_preview_bgr(raw, file_name, max_side)
        else:
            bgr, preview_source = _decode_preview_bgr(raw, file_name, max_side, raw_options=raw_options)
        return _prepare_bgr_for_analysis(bgr, preview_source, max_side)

    return _build_analysis_entry(cache_key, prepare)


def _prepare_file_analysis(
    file_path: str | Path,
    max_side: int = DEFAULT_ANALYSIS_MAX_SIDE,
    reader_plugin: str | None = None,
    raw_options: dict[str, object] | None = None,
) -> AnalysisEntry:
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"Input file does not exist: {path}")
    cache_key = _file_cache_key(path, max_side, reader_plugin)
    
    source_info = {
        "source_path": str(path.resolve()),
        "reader_plugin": reader_plugin,
        "raw_options": raw_options,
    }
    
    if reader_plugin is None:
        if raw_options is None:
            entry = _build_analysis_entry(cache_key, lambda: _prepare_file_for_analysis(path, max_side))
        else:
            entry = _build_analysis_entry(cache_key, lambda: _prepare_file_for_analysis(path, max_side, raw_options=raw_options))
    else:
        entry = _build_analysis_entry(
            cache_key,
            lambda: _prepare_file_for_analysis(path, max_side, reader_plugin=reader_plugin, raw_options=raw_options),
        )
    
    entry.session_metadata.update(source_info)
    _remember_session_source(cache_key, source_info)
    return entry


class AnalysisSessionResolver:
    """Resolve path/upload/session inputs into an analysis entry at the needed size."""

    def __init__(
        self,
        body: dict,
        *,
        default_max_side: int,
        min_max_side: int | None = None,
        max_max_side: int = DEFAULT_ANALYSIS_MAX_SIDE,
        resolution_mode: str = "minimum",
        reader_plugin: str | None = None,
        raw_options: dict[str, object] | None = None,
        missing_session_message: str = "Unknown or expired session_id",
        missing_input_message: str = "request requires path, session_id, or image_data",
    ) -> None:
        if resolution_mode not in {"minimum", "target"}:
            raise ValueError("resolution_mode must be 'minimum' or 'target'")
        self.body = body
        self.default_max_side = int(default_max_side)
        self.min_max_side = int(min_max_side) if min_max_side is not None else None
        self.max_max_side = int(max_max_side)
        self.resolution_mode = resolution_mode
        self.reader_plugin = reader_plugin
        self.raw_options = raw_options
        self.missing_session_message = missing_session_message
        self.missing_input_message = missing_input_message

    def resolve(self) -> AnalysisEntry:
        if self.body.get("path"):
            return _prepare_file_analysis(
                str(self.body["path"]),
                max_side=self._target_max_side(),
                reader_plugin=self.reader_plugin,
                raw_options=self.raw_options,
            )
        if self.body.get("session_id"):
            entry = _get_analysis(str(self.body["session_id"]))
            if entry is None:
                raise ValueError(self.missing_session_message)
            return self._rehydrate_if_needed(entry)
        if self.body.get("image_data"):
            return _prepare_uploaded_analysis(
                self.body["image_data"],
                file_name=str(self.body.get("file_name", "")),
                max_side=self._target_max_side(),
                reader_plugin=self.reader_plugin,
                raw_options=self.raw_options,
            )
        raise ValueError(self.missing_input_message)

    def _target_max_side(self, entry: AnalysisEntry | None = None) -> int:
        requested = self._int_body("analysis_max_side", self.default_max_side)
        target = max(1, requested)
        if self.min_max_side is not None:
            target = max(target, self.min_max_side)
        target = min(target, self.max_max_side)
        if entry is not None:
            original_side = max(
                int(entry.prepared.original_width),
                int(entry.prepared.original_height),
                self._current_side(entry),
            )
            target = min(target, original_side)
        return max(1, int(target))

    def _rehydrate_if_needed(self, entry: AnalysisEntry) -> AnalysisEntry:
        target_side = self._target_max_side(entry)
        if not self._needs_rehydrate(entry, target_side):
            return entry
        source_path = entry.session_metadata.get("source_path")
        if not source_path:
            return entry
        return _prepare_file_analysis(
            source_path,
            max_side=target_side,
            reader_plugin=entry.session_metadata.get("reader_plugin"),
            raw_options=entry.session_metadata.get("raw_options"),
        )

    def _needs_rehydrate(self, entry: AnalysisEntry, target_side: int) -> bool:
        current_side = self._current_side(entry)
        if self.resolution_mode == "target":
            return abs(target_side - current_side) > max(current_side, 1) * 0.10
        return current_side < target_side * 0.95

    @staticmethod
    def _current_side(entry: AnalysisEntry) -> int:
        return max(int(entry.prepared.analysis_width), int(entry.prepared.analysis_height), 1)

    def _int_body(self, key: str, default: int) -> int:
        try:
            return int(self.body.get(key, default))
        except (TypeError, ValueError):
            return int(default)


def _prepare_image_for_analysis(data_url: str, max_side: int = DEFAULT_ANALYSIS_MAX_SIDE) -> PreparedImage:
    return _prepare_uploaded_image(data_url, "", max_side)


def _prepare_uploaded_image(
    data_url: str,
    file_name: str = "",
    max_side: int = DEFAULT_ANALYSIS_MAX_SIDE,
    reader_plugin: str | None = None,
    raw_options: dict[str, object] | None = None,
) -> PreparedImage:
    return _prepare_uploaded_analysis(
        data_url,
        file_name,
        max_side,
        reader_plugin=reader_plugin,
        raw_options=raw_options,
    ).prepared


def _prepare_file_for_analysis(
    file_path: str | Path,
    max_side: int = DEFAULT_ANALYSIS_MAX_SIDE,
    reader_plugin: str | None = None,
    raw_options: dict[str, object] | None = None,
) -> PreparedImage:
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"Input file does not exist: {path}")

    cached = _load_cached_preview(path, max_side) if reader_plugin is None else None
    if cached is not None:
        return cached

    if reader_plugin is not None:
        image_buffer = _read_image_with_plugins(path, reader_plugin=reader_plugin)
        prepared = _prepare_image_buffer_for_analysis(image_buffer, max_side)
        return prepared

    if is_raw_extension(path.name):
        raw = path.read_bytes()
        bgr_source = _try_decode_raw_preview(raw, path.name, raw_options=raw_options)
        if bgr_source is None:
            raise ValueError("Unsupported RAW file")
        bgr, source = bgr_source
        prepared = _prepare_bgr_for_analysis(bgr, source, max_side)
        _write_cached_preview(path, max_side, prepared)
        return prepared

    image_buffer = _read_image_with_plugins(path)
    prepared = _prepare_image_buffer_for_analysis(image_buffer, max_side)
    _write_cached_preview(path, max_side, prepared)
    return prepared


def _preview_cache_key(path: Path, max_side: int) -> str:
    stat = path.stat()
    payload = {
        "path": str(path.resolve()),
        "size": stat.st_size,
        "mtime_ns": stat.st_mtime_ns,
        "max_side": int(max_side),
        "version": 1,
    }
    raw = json.dumps(payload, sort_keys=True).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()[:32]


def _preview_cache_paths(path: Path, max_side: int) -> tuple[Path, Path]:
    key = _preview_cache_key(path, max_side)
    return PREVIEW_CACHE_DIR / f"{key}.jpg", PREVIEW_CACHE_DIR / f"{key}.json"


def _load_cached_preview(path: Path, max_side: int) -> PreparedImage | None:
    image_path, meta_path = _preview_cache_paths(path, max_side)
    if not image_path.exists() or not meta_path.exists():
        return None
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        bgr = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
        if bgr is None:
            return None
        return _prepare_bgr_for_analysis(
            bgr,
            "preview-cache",
            max_side,
            source_size=(int(meta["original_width"]), int(meta["original_height"])),
        )
    except Exception:
        return None


def _write_cached_preview(path: Path, max_side: int, prepared: PreparedImage) -> None:
    if prepared.preview_source in {"preview-cache", "raw-embedded-jpeg", "raw-embedded-bitmap", "tiff-pil-preview-page"}:
        return
    try:
        PREVIEW_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        image_path, meta_path = _preview_cache_paths(path, max_side)
        preview_rgb = _render_preview_rgb(
            prepared.image,
            color_space=prepared.color_space,
            data_range=prepared.data_range,
        )
        bgr = ACCELERATOR.rgb_to_bgr(preview_rgb)
        ok = cv2.imwrite(str(image_path), bgr, [cv2.IMWRITE_JPEG_QUALITY, 92])
        if not ok:
            return
        meta = {
            "original_width": prepared.original_width,
            "original_height": prepared.original_height,
            "analysis_width": prepared.analysis_width,
            "analysis_height": prepared.analysis_height,
            "source_dtype": prepared.source_dtype,
            "preview_source": prepared.preview_source,
            "color_space": prepared.color_space,
            "data_range": list(prepared.data_range) if prepared.data_range is not None else None,
            "created_at": time.time(),
        }
        meta_path.write_text(json.dumps(meta, sort_keys=True), encoding="utf-8")
    except Exception:
        return


def _decode_tiff_file_preview(path: Path, max_side: int) -> tuple[np.ndarray, str]:
    try:
        from PIL import Image

        with Image.open(path) as image:
            frames = getattr(image, "n_frames", 1)
            if frames > 1:
                candidates: list[tuple[int, int, int]] = []
                for index in range(frames):
                    image.seek(index)
                    longest = max(image.size)
                    if longest >= 160:
                        candidates.append((longest, index, frames))
                if candidates:
                    candidates.sort(key=lambda item: item[0])
                    image.seek(candidates[0][1])
                    rgb = np.array(image.convert("RGB"))
                    return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR), "tiff-pil-preview-page"
    except Exception:
        pass

    flag = _reduced_imread_flag_for_path(path, max_side)
    bgr = cv2.imread(str(path), flag)
    if bgr is None:
        raise ValueError(f"Unsupported or corrupt TIFF file: {path}")
    return bgr, "tiff-reduced-decode" if flag != cv2.IMREAD_COLOR else "tiff-full-decode"


def _reduced_imread_flag_for_path(path: Path, max_side: int) -> int:
    size = _image_size_hint(path)
    if size is None:
        return cv2.IMREAD_COLOR
    longest = max(size)
    if longest / 8 >= max_side:
        return cv2.IMREAD_REDUCED_COLOR_8
    if longest / 4 >= max_side:
        return cv2.IMREAD_REDUCED_COLOR_4
    if longest / 2 >= max_side:
        return cv2.IMREAD_REDUCED_COLOR_2
    return cv2.IMREAD_COLOR


def _image_size_hint(path: Path) -> tuple[int, int] | None:
    try:
        from PIL import Image

        with Image.open(path) as image:
            return int(image.width), int(image.height)
    except Exception:
        return None


def _decode_preview_bgr(
    raw: bytes,
    file_name: str,
    max_side: int,
    *,
    raw_options: dict[str, object] | None = None,
) -> tuple[np.ndarray, str]:
    arr = np.frombuffer(raw, dtype=np.uint8)
    lower_name = file_name.lower()

    if lower_name.endswith((".tif", ".tiff")):
        ok, pages = cv2.imdecodemulti(arr, cv2.IMREAD_UNCHANGED)
        if ok and pages:
            page = _choose_tiff_preview_page(pages, max_side)
            source = "tiff-preview-page" if len(pages) > 1 and page is not pages[0] else "tiff-full-page"
            return page, source

    bgr = cv2.imdecode(arr, cv2.IMREAD_UNCHANGED)
    if bgr is not None:
        return bgr, "opencv-decode"

    raw_preview = _try_decode_raw_preview(raw, file_name, raw_options=raw_options)
    if raw_preview is not None:
        return raw_preview

    raise ValueError("Unsupported or corrupt image data")


def _prepare_bgr_for_analysis(
    bgr: np.ndarray,
    preview_source: str,
    max_side: int,
    source_size: tuple[int, int] | None = None,
) -> PreparedImage:
    source_dtype = str(bgr.dtype)
    if source_size:
        original_width, original_height = source_size
    else:
        original_height, original_width = int(bgr.shape[0]), int(bgr.shape[1])
    bgr = _normalize_bgr(bgr)
    rgb = ACCELERATOR.bgr_to_rgb(bgr)
    analysis = _resize_to_max_side(rgb, max_side)
    downsample_ratio = analysis.shape[1] / max(original_width, 1)
    return PreparedImage(
        image=analysis,
        original_width=original_width,
        original_height=original_height,
        analysis_width=int(analysis.shape[1]),
        analysis_height=int(analysis.shape[0]),
        downsample_ratio=float(downsample_ratio),
        source_dtype=source_dtype,
        preview_source=preview_source,
        color_space="sRGB",
        data_range=(0.0, 255.0),
    )


def _prepare_image_buffer_for_analysis(image_buffer, max_side: int) -> PreparedImage:
    rgb = image_buffer.data
    analysis = _resize_to_max_side(rgb, max_side)
    width = int(image_buffer.width)
    height = int(image_buffer.height)
    downsample_ratio = analysis.shape[1] / max(width, 1)
    source_dtype = str(image_buffer.dtype)
    reader = image_buffer.metadata.get("reader", "image-buffer")
    return PreparedImage(
        image=analysis,
        original_width=width,
        original_height=height,
        analysis_width=int(analysis.shape[1]),
        analysis_height=int(analysis.shape[0]),
        downsample_ratio=float(downsample_ratio),
        source_dtype=source_dtype,
        preview_source=f"io-{reader}",
        color_space=image_buffer.color_space,
        data_range=image_buffer.data_range,
    )


def _resize_to_max_side(img_rgb: np.ndarray, max_side: int) -> np.ndarray:
    if max_side <= 0:
        return img_rgb
    h, w = img_rgb.shape[:2]
    longest = max(h, w)
    if longest <= max_side:
        return img_rgb
    scale = max_side / float(longest)
    target = (max(1, int(round(w * scale))), max(1, int(round(h * scale))))
    return ACCELERATOR.resize_area(img_rgb, target)


def _choose_tiff_preview_page(pages: list[np.ndarray], max_side: int) -> np.ndarray:
    if len(pages) == 1:
        return pages[0]
    min_usable_preview = 160
    ranked: list[tuple[int, int, np.ndarray]] = []
    for index, page in enumerate(pages):
        h, w = page.shape[:2]
        longest = max(h, w)
        if longest >= min_usable_preview:
            ranked.append((longest, index, page))
    if ranked:
        ranked.sort(key=lambda item: (item[0], item[1]))
        return ranked[0][2]
    return max(pages, key=lambda page: max(page.shape[:2]))


def _try_decode_raw_preview(
    raw: bytes,
    file_name: str,
    *,
    raw_options: dict[str, object] | None = None,
) -> tuple[np.ndarray, str] | None:
    from photo_calibrator.io.raw import RAW_EXTENSIONS, decode_raw_preview

    if not file_name.lower().endswith(RAW_EXTENSIONS):
        return None
    return decode_raw_preview(raw, file_name, **(raw_options or {}))


def _normalize_bgr(bgr: np.ndarray) -> np.ndarray:
    if bgr.ndim == 2:
        bgr = cv2.cvtColor(bgr, cv2.COLOR_GRAY2BGR)
    if bgr.shape[2] == 4:
        bgr = cv2.cvtColor(bgr, cv2.COLOR_BGRA2BGR)
    if bgr.dtype != np.uint8:
        bgr = _to_uint8_preview(bgr)
    return bgr


def _to_uint8_preview(img: np.ndarray) -> np.ndarray:
    if img.dtype == np.uint8:
        return img
    data = img.astype(np.float32)
    max_value = float(data.max()) if data.size else 0.0
    if np.issubdtype(img.dtype, np.integer):
        dtype_max = float(np.iinfo(img.dtype).max)
        if dtype_max > 0:
            data = data / dtype_max * 255.0
    elif max_value <= 1.0:
        data = data * 255.0
    else:
        data = data / max(max_value, 1.0) * 255.0
    return np.clip(data, 0, 255).astype(np.uint8)


def _render_preview_rgb(
    img_rgb: np.ndarray,
    *,
    color_space: str = "sRGB",
    data_range: tuple[float, float] | None = None,
) -> np.ndarray:
    if img_rgb.dtype == np.uint8 and color_space.lower() == "srgb":
        return img_rgb
    data = img_rgb.astype(np.float32, copy=False)
    if np.issubdtype(img_rgb.dtype, np.integer):
        info = np.iinfo(img_rgb.dtype)
        scale = float(info.max) if info.max > 0 else 255.0
        data = data / scale
    else:
        rng = data_range or (float(data.min()) if data.size else 0.0, float(data.max()) if data.size else 1.0)
        peak = float(rng[1]) if rng is not None else (float(data.max()) if data.size else 1.0)
        if peak > 1.0:
            tone_ref = float(np.percentile(data, 99.5)) if data.size else peak
            peak = max(tone_ref, 1.0)
            data = np.clip(data / peak, 0.0, 1.0)
        else:
            data = np.clip(data, 0.0, 1.0)

    if color_space.lower() == "linear":
        data = np.power(np.clip(data, 0.0, 1.0), 1.0 / 2.2)

    return np.clip(np.rint(data * 255.0), 0, 255).astype(np.uint8)


def _save_preview_image(img_rgb: np.ndarray, ext: str = ".jpg", quality: int = 92) -> str:
    bgr = ACCELERATOR.rgb_to_bgr(img_rgb)
    params: list[int] = []
    if ext == ".jpg":
        params = [cv2.IMWRITE_JPEG_QUALITY, quality]
    ok, encoded = cv2.imencode(ext, bgr, params)
    if not ok:
        raise ValueError("Could not encode output image")
    h = hashlib.sha1(encoded.tobytes()).hexdigest()[:16]
    name = f"{h}{ext}"
    path = PREVIEW_CACHE_DIR / name
    PREVIEW_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path.write_bytes(encoded.tobytes())
    return f"{_BASE_URL}/api/preview-image/{name}"


def _report_payload(report) -> dict:
    return {
        "width": report.width,
        "height": report.height,
        "severity": report.severity,
        "direction": report.cast_direction,
        "diagnosis": getattr(report, "diagnosis", []),
        "lab": {
            "l": report.lab.l_mean,
            "a": report.lab.a_mean,
            "b": report.lab.b_star_mean,
            "strength": report.lab.cast_strength,
        },
        "rgb": {
            "r": report.rgb.r_mean,
            "g": report.rgb.g_mean,
            "b": report.rgb.b_mean,
            "spread": report.channel_spread,
        },
        "peaks": report.peaks,
        "peak_spread": report.peak_spread,
        "zones": {
            name: {"a": zone.a_mean, "b": zone.b_mean, "pixels": zone.pixels, "confidence": zone.confidence}
            for name, zone in report.zones.items()
        },
        "skin": (
            {"a": report.skin.a_mean, "b": report.skin.b_mean, "pixels": report.skin.pixels}
            if report.skin
            else None
        ),
        "tone_regions": {
            name: {
                "pixels": tr.pixels,
                "pct": tr.pct,
                "r_mean": tr.r_mean,
                "g_mean": tr.g_mean,
                "b_mean": tr.b_mean,
                "a_star": tr.a_star,
                "b_star": tr.b_star,
                "l_mean": tr.l_mean,
                "peaks": tr.peaks,
                "peak_spread": tr.peak_spread,
            }
            for name, tr in getattr(report, "tone_regions", {}).items()
        },
    }


def _histogram_payload(img_rgb: np.ndarray, bins: int = 256) -> dict:
    histograms = {}
    for ch, name in [(0, "r"), (1, "g"), (2, "b")]:
        hist = ACCELERATOR.calc_hist(img_rgb, ch, bins)
        max_count = float(hist.max()) or 1.0
        histograms[name] = {
            "normalized": [float(v / max_count) for v in hist],
            "counts": [int(v) for v in hist],
            "peak_bin": int(np.argmax(hist)),
        }
    return {"bins": bins, "channels": histograms}


def _static_chart_payload(input_report, img_rgb: np.ndarray, input_label: str = "Original") -> dict:
    zone_order = ["shadow", "midtone", "highlight"]
    zones = []
    for name in zone_order:
        zone = input_report.zones.get(name)
        if zone:
            zones.append({"name": name, "a": zone.a_mean, "b": zone.b_mean, "pixels": zone.pixels})
    return {
        "rgb_histogram": _histogram_payload(img_rgb, bins=256),
        "ccc": _ccc_payload(img_rgb),
        "pci": _pci_payload(input_report),
        "neutral_mask": _neutral_mask_payload(img_rgb),
        "zones": zones,
        "input_lab_vector": {"name": input_label, "a": input_report.lab.a_mean, "b": input_report.lab.b_star_mean},
        "skin_lab_vector": (
            {"name": "Skin", "a": input_report.skin.a_mean, "b": input_report.skin.b_mean}
            if input_report.skin
            else None
        ),
    }


def _chart_payload(
    input_report,
    output_report,
    img_rgb: np.ndarray,
    static_charts: dict | None = None,
    input_label: str = "Original",
) -> dict:
    static = static_charts or _static_chart_payload(input_report, img_rgb, input_label=input_label)
    lab_vectors = [
        static["input_lab_vector"],
        {"name": "Calibrated", "a": output_report.lab.a_mean, "b": output_report.lab.b_star_mean},
    ]
    if static.get("skin_lab_vector"):
        lab_vectors.append(static["skin_lab_vector"])
    return {
        "rgb_histogram": static["rgb_histogram"],
        "ccc": static["ccc"],
        "pci": static["pci"],
        "neutral_mask": static["neutral_mask"],
        "rgb_means": {
            "input": {
                "r": input_report.rgb.r_mean,
                "g": input_report.rgb.g_mean,
                "b": input_report.rgb.b_mean,
            },
            "output": {
                "r": output_report.rgb.r_mean,
                "g": output_report.rgb.g_mean,
                "b": output_report.rgb.b_mean,
            },
        },
        "lab_vectors": lab_vectors,
        "strengths": [
            {"name": input_label, "value": input_report.lab.cast_strength},
            {"name": "Calibrated", "value": output_report.lab.cast_strength},
        ],
        "zones": static["zones"],
    }


def _ccc_payload(img_rgb: np.ndarray) -> dict:
    lab = rgb_to_lab_float(img_rgb)
    a_values = lab[:, :, 1].astype(np.float64)
    b_values = lab[:, :, 2].astype(np.float64)
    mu_a = float(a_values.mean())
    mu_b = float(b_values.mean())
    sigma_a = float(a_values.std())
    sigma_b = float(b_values.std())
    mu = float(np.sqrt(mu_a**2 + mu_b**2))
    sigma = float(np.sqrt(sigma_a**2 + sigma_b**2))
    distance = mu - sigma
    d_sigma = distance / sigma if sigma > 1e-9 else 0.0
    k = distance / mu if mu > 1e-9 else 0.0
    return {
        "mu_a": mu_a,
        "mu_b": mu_b,
        "sigma_a": sigma_a,
        "sigma_b": sigma_b,
        "mu": mu,
        "sigma": sigma,
        "distance": distance,
        "d_sigma": d_sigma,
        "k": k,
    }


def _pci_payload(report) -> dict:
    a_value = float(report.lab.a_mean)
    b_value = float(report.lab.b_star_mean)
    l_value = float(report.lab.l_mean)
    weighted = float(np.sqrt((a_value * 1.8) ** 2 + b_value**2))
    if l_value < 30:
        luminance_factor = 0.55
    elif l_value > 70:
        luminance_factor = 1.0
    else:
        luminance_factor = 0.55 + (l_value - 30) / 40 * 0.45
    pci = weighted * luminance_factor
    return {
        "weighted_delta": weighted,
        "luminance_factor": luminance_factor,
        "value": pci,
    }


def _lut_analysis_payload(params: CalibrationParams) -> dict | None:
    if params.mode != CalibrationMode.LUT3D:
        return None
    try:
        hue_count = 24
        sat_levels = 3
        total = hue_count * sat_levels
        rgb = np.zeros((total, 3), dtype=np.float32)
        for i in range(hue_count):
            hue = i * 360.0 / hue_count
            for j in range(sat_levels):
                sat = 0.35 + j * 0.3
                rgb[i * sat_levels + j] = _hsv_to_rgb_float(hue, sat, 0.8)
        rgb_u8 = np.clip(np.rint(rgb * 255.0), 0, 255).astype(np.uint8)
        rgb_in = rgb_u8.reshape(1, total, 3)
        corrected = apply_3d_lut(rgb_in, strength=params.strength, size=params.lut_size)
        corrected = np.clip(corrected, 0, 255).astype(np.uint8)
        lab_before = rgb_to_lab_float(rgb_in)
        lab_after = rgb_to_lab_float(corrected)
        vectors = []
        for i in range(total):
            a_before = float(lab_before[0, i, 1])
            b_before = float(lab_before[0, i, 2])
            a_after = float(lab_after[0, i, 1])
            b_after = float(lab_after[0, i, 2])
            hue_idx = i // sat_levels
            sat_idx = i % sat_levels
            vectors.append({
                "hue_angle": round(hue_idx * 360.0 / hue_count, 1),
                "saturation": round(0.35 + sat_idx * 0.3, 2),
                "a_before": round(a_before, 2),
                "b_before": round(b_before, 2),
                "a_after": round(a_after, 2),
                "b_after": round(b_after, 2),
                "delta_a": round(a_after - a_before, 2),
                "delta_b": round(b_after - b_before, 2),
            })
        return {"vectors": vectors, "source_mode": params.mode.value, "lut_size": params.lut_size}
    except Exception:
        return None


def _hsv_to_rgb_float(h: float, s: float, v: float) -> np.ndarray:
    h = h % 360.0
    c = v * s
    x = c * (1.0 - abs((h / 60.0) % 2.0 - 1.0))
    m = v - c
    if h < 60:
        rgb = np.array([c, x, 0.0], dtype=np.float32)
    elif h < 120:
        rgb = np.array([x, c, 0.0], dtype=np.float32)
    elif h < 180:
        rgb = np.array([0.0, c, x], dtype=np.float32)
    elif h < 240:
        rgb = np.array([0.0, x, c], dtype=np.float32)
    elif h < 300:
        rgb = np.array([x, 0.0, c], dtype=np.float32)
    else:
        rgb = np.array([c, 0.0, x], dtype=np.float32)
    return rgb + m


def _neutral_mask_payload(img_rgb: np.ndarray) -> dict:
    mask = detect_neutral_mask(img_rgb)
    pixels = int(mask.sum())
    total = int(mask.size)
    return {
        "pixels": pixels,
        "total": total,
        "coverage": pixels / max(total, 1),
    }


def _accelerator_payload() -> dict:
    return accelerator_payload()


def _set_accelerator_payload(backend: str) -> dict:
    return set_accelerator_backend(backend)


def _accelerator_benchmark_payload(image_side: int = 256, lut_size: int = 17, iterations: int = 3) -> dict:
    return benchmark_accelerator(image_side=image_side, lut_size=lut_size, iterations=iterations)


def _calibration_params_from_body(body: dict) -> CalibrationParams:
    def _opt_float(key: str, default: float | None = None) -> float | None:
        v = body.get(key)
        return float(v) if v is not None else default

    def _opt_curve(key: str) -> list[list[float]] | None:
        v = body.get(key)
        if v is None or (isinstance(v, list) and len(v) == 0):
            return None
        if isinstance(v, list) and all(isinstance(pt, list) and len(pt) == 2 for pt in v):
            return [[float(x), float(y)] for x, y in v]
        return None

    def _opt_gamma(key: str) -> tuple[float, float, float] | None:
        v = body.get(key)
        if v is None or (isinstance(v, list) and len(v) == 0):
            return None
        if isinstance(v, list) and len(v) == 3:
            return (float(v[0]), float(v[1]), float(v[2]))
        return None

    def _opt_matrix(key: str) -> tuple | None:
        v = body.get(key)
        if v is None or (isinstance(v, list) and len(v) == 0):
            return None
        if isinstance(v, list) and len(v) == 3 and all(isinstance(r, list) and len(r) == 3 for r in v):
            return (
                (float(v[0][0]), float(v[0][1]), float(v[0][2])),
                (float(v[1][0]), float(v[1][1]), float(v[1][2])),
                (float(v[2][0]), float(v[2][1]), float(v[2][2])),
            )
        return None

    requested_mode = str(body.get("mode", CalibrationMode.GLOBAL.value))
    mode = CalibrationMode.GLOBAL if requested_mode == AUTO_BEST_MODE else CalibrationMode(requested_mode)
    auto_style = _auto_style_from_body(body)
    strength = float(body.get("strength", 0.8))
    if auto_style is not None:
        strength = float(auto_style["neutralization"])
    return CalibrationParams(
        mode=mode,
        a_shift=_opt_float("a_shift"),
        b_shift=_opt_float("b_shift"),
        strength=strength,
        highlight_pct=float(body.get("highlight_pct", 55.0)),
        sat_pct=float(body.get("sat_pct", 25.0)),
        curve_low_pct=float(body.get("curve_low_pct", 1.0)),
        curve_high_pct=float(body.get("curve_high_pct", 99.0)),
        gamma=_opt_gamma("gamma"),
        r_curve=_opt_curve("r_curve"),
        g_curve=_opt_curve("g_curve"),
        b_curve=_opt_curve("b_curve"),
        matrix=_opt_matrix("matrix"),
        lut_size=int(body.get("lut_size", 17)),
    )


def _clamp_float(value: object, low: float, high: float, default: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = default
    if not np.isfinite(number):
        number = default
    return float(np.clip(number, low, high))


def _auto_style_from_body(body: dict) -> dict[str, object] | None:
    raw = body.get("auto_style") or body.get("autoStyle")
    if raw in (None, False):
        return None
    if not isinstance(raw, dict):
        raw = {}
    preset = str(raw.get("preset", "neutral")).strip().lower().replace("_", "-")
    if preset not in AUTO_STYLE_PRESETS:
        preset = "neutral"
    neutralization = _clamp_float(raw.get("neutralization", body.get("strength", 0.8)), 0.0, 1.2, 0.8)
    look_preservation = _clamp_float(raw.get("look_preservation", raw.get("lookPreservation", 0.0)), 0.0, 1.0, 0.0)
    warmth_bias = _clamp_float(raw.get("warmth_bias", raw.get("warmthBias", 0.0)), -1.0, 1.0, 0.0)
    tint_bias = _clamp_float(raw.get("tint_bias", raw.get("tintBias", 0.0)), -1.0, 1.0, 0.0)
    tone_style = _clamp_float(raw.get("tone_style", raw.get("toneStyle", 0.0)), -1.0, 1.0, 0.0)
    highlight_protection = _clamp_float(raw.get("highlight_protection", raw.get("highlightProtection", 0.0)), 0.0, 1.0, 0.0)
    skin_priority = _clamp_float(raw.get("skin_priority", raw.get("skinPriority", 0.0)), 0.0, 1.0, 0.0)
    return {
        "preset": preset,
        "neutralization": neutralization,
        "look_preservation": look_preservation,
        "warmth_bias": warmth_bias,
        "tint_bias": tint_bias,
        "tone_style": tone_style,
        "highlight_protection": highlight_protection,
        "skin_priority": skin_priority,
    }


def _merge_auto_style_look(look: dict, auto_style: dict[str, object] | None) -> dict:
    normalized = normalize_look_adjustments(look)
    if auto_style is None:
        return normalized

    warmth_bias = float(auto_style["warmth_bias"])
    tint_bias = float(auto_style["tint_bias"])
    look_preservation = float(auto_style["look_preservation"])
    tone_style = float(auto_style["tone_style"])
    preset = str(auto_style["preset"])

    normalized["lab_bias"]["a"] = float(np.clip(normalized["lab_bias"]["a"] + tint_bias * 7.0, -40.0, 40.0))
    normalized["lab_bias"]["b"] = float(np.clip(normalized["lab_bias"]["b"] + warmth_bias * 8.0, -40.0, 40.0))

    grade = normalized["color_grade"]
    preserve_sat = look_preservation * 0.22
    clarity = max(0.0, tone_style)
    softness = max(0.0, -tone_style)
    clarity_sat = clarity * 0.18
    softness_lum = softness * 0.16
    grade["blending"] = min(1.0, float(grade["blending"]) + look_preservation * 0.16)
    if preset == "film":
        grade["shadows"]["hue"] = 220.0
        grade["shadows"]["saturation"] = min(1.0, grade["shadows"]["saturation"] + 0.08 + preserve_sat * 1.05)
        grade["highlights"]["hue"] = 45.0
        grade["highlights"]["saturation"] = min(1.0, grade["highlights"]["saturation"] + 0.06 + preserve_sat)
        grade["global"]["saturation"] = min(1.0, grade["global"]["saturation"] + clarity_sat * 0.45)
    elif preset == "slide":
        grade["global"]["saturation"] = min(1.0, grade["global"]["saturation"] + 0.09 + clarity_sat)
        grade["highlights"]["luminance"] = min(1.0, grade["highlights"]["luminance"] + clarity * 0.05)
    elif preset == "portrait":
        grade["midtones"]["hue"] = 32.0
        grade["midtones"]["saturation"] = min(1.0, grade["midtones"]["saturation"] + 0.055 + preserve_sat * 0.25)
    elif preset == "soft":
        grade["global"]["luminance"] = min(1.0, grade["global"]["luminance"] + 0.035 + softness_lum * 0.65)
        grade["shadows"]["luminance"] = min(1.0, grade["shadows"]["luminance"] + softness * 0.05)
    elif look_preservation > 0.001 or abs(tone_style) > 0.001:
        grade["global"]["saturation"] = min(1.0, grade["global"]["saturation"] + look_preservation * 0.08 + clarity_sat * 0.8)
        grade["midtones"]["saturation"] = min(1.0, grade["midtones"]["saturation"] + preserve_sat * 0.28)
    if clarity > 0.001:
        grade["shadows"]["luminance"] = max(-1.0, grade["shadows"]["luminance"] - clarity * 0.05)
        grade["highlights"]["luminance"] = min(1.0, grade["highlights"]["luminance"] + clarity * 0.045)
    if softness > 0.001 and preset != "soft":
        grade["global"]["luminance"] = min(1.0, grade["global"]["luminance"] + softness_lum * 0.45)
        grade["shadows"]["luminance"] = min(1.0, grade["shadows"]["luminance"] + softness * 0.035)
    return normalize_look_adjustments(normalized)


def _merge_auto_style_tone(tone: dict, auto_style: dict[str, object] | None) -> dict:
    if auto_style is None:
        return tone

    merged = dict(tone)
    tone_style = float(auto_style["tone_style"])
    highlight_protection = float(auto_style["highlight_protection"])
    look_preservation = float(auto_style["look_preservation"])
    preset = str(auto_style["preset"])
    style_wants_tone = (
        abs(tone_style) > 0.025
        or highlight_protection > 0.18
        or look_preservation > 0.45
        or preset in {"slide", "soft"}
    )
    if style_wants_tone and not merged.get("enabled"):
        merged["enabled"] = True
        merged["auto"] = True

    if not merged.get("enabled"):
        return merged

    base_strength = float(merged.get("strength", 0.45))
    clarity = max(0.0, tone_style)
    softness = max(0.0, -tone_style)
    strength_delta = clarity * 0.32 + softness * 0.08 + highlight_protection * 0.09 + look_preservation * 0.04
    if preset == "soft":
        strength_delta -= 0.06
    merged["strength"] = float(np.clip(base_strength + strength_delta, 0.0, 1.0))
    if tone_style > 0.05:
        merged["local_contrast"] = float(np.clip(0.06 + tone_style * 0.22, 0.0, 0.34))
    elif tone_style < -0.05:
        merged["local_contrast"] = float(np.clip(0.025 - softness * 0.018, 0.0, 0.06))
    if highlight_protection > 0.001 and merged.get("white_point") is None:
        merged["white_point"] = float(np.clip(0.985 - highlight_protection * 0.09, 0.86, 1.0))
    if clarity > 0.05 and merged.get("black_point") is None:
        merged["black_point"] = float(np.clip(0.012 + clarity * 0.035, 0.0, 0.08))
    if tone_style < -0.05 and merged.get("midtone") is None:
        merged["midtone"] = float(np.clip(0.5 + softness * 0.08, 0.35, 0.68))
    return merged


def _negative_base_enabled(body: dict) -> bool:
    return bool(body.get("negative_base", body.get("negative_base_enabled", False)))


def _look_adjustments_from_body(body: dict) -> dict:
    return _merge_auto_style_look(
        body.get("look") or body.get("look_adjustments") or {},
        _auto_style_from_body(body),
    )


def _tone_recovery_from_body(body: dict) -> dict:
    raw = body.get("tone_recovery") or body.get("toneRecovery") or {}
    if raw is True:
        raw = {"enabled": True}
    if not isinstance(raw, dict):
        return {"enabled": False}
    enabled = bool(raw.get("enabled", False))
    payload: dict[str, object] = {
        "enabled": enabled,
        "auto": bool(raw.get("auto", True)),
    }
    for key in ("strength", "black_point", "white_point", "midtone", "local_contrast"):
        if raw.get(key) is not None:
            payload[key] = float(raw[key])
    return _merge_auto_style_tone(payload, _auto_style_from_body(body))


def _plugin_calibrator_id(body: dict) -> str | None:
    plugin_id = body.get("calibrator_plugin")
    if plugin_id in {"", None}:
        return None
    return str(plugin_id)


def _apply_plugin_calibration(
    entry: AnalysisEntry,
    image: np.ndarray,
    params: CalibrationParams,
    calibrator_id: str,
    fast: bool = False,
) -> dict:
    params_dict = {
        "mode": params.mode.value,
        "strength": params.strength,
        "highlight_pct": params.highlight_pct,
        "sat_pct": params.sat_pct,
    }
    plugin_result = _plugin_service().run_calibrator(
        image,
        params_dict,
        calibrator_id=calibrator_id,
        session_id=entry.cache_key,
        analysis=_report_payload(entry.input_report),
        zones=entry.zones,
    )
    calibrated = ensure_uint8_rgb(plugin_result.image)
    post_report = entry.input_report if fast else analyze_image_array(calibrated)
    before = entry.input_report.lab.cast_strength
    after = post_report.lab.cast_strength
    reduction_pct = (1.0 - after / max(before, 0.01)) * 100.0
    return {
        "image": calibrated,
        "post_report": post_report,
        "mode": params.mode.value,
        "shift": {"a": None, "b": None},
        "metadata": {
            "auto_cast_source": "plugin",
            "auto_cast_confidence": 1.0,
            "plugin_id": plugin_result.plugin_id,
            "plugin_name": plugin_result.calibrator_name,
            "plugin_metadata": _json_safe(plugin_result.metadata),
            "calibration_source": "plugin",
            "reduction_pct": reduction_pct,
        },
        "reduction_pct": reduction_pct,
    }


def _is_identity_curve(curve: list[list[float]] | None) -> bool:
    if curve is None:
        return True
    if len(curve) < 2:
        return True
    for pt in curve:
        if abs(float(pt[0]) - float(pt[1])) > 2:
            return False
    return True


def _auto_best_score(
    input_report,
    output_report,
    *,
    mode: CalibrationMode | None = None,
    auto_style: dict[str, object] | None = None,
) -> float:
    """Lower is better; prefer low residual cast without excessive RGB imbalance."""
    neutralization_weight = 1.0
    style_bias = 0.0
    if auto_style is not None:
        look_preservation = float(auto_style["look_preservation"])
        tone_style = float(auto_style["tone_style"])
        highlight_protection = float(auto_style["highlight_protection"])
        skin_priority = float(auto_style["skin_priority"])
        neutralization_weight = max(0.7, 1.0 - look_preservation * 0.22 - max(0.0, -tone_style) * 0.08)
        if mode == CalibrationMode.PRESERVE_SPLIT_TONE:
            style_bias -= look_preservation * 0.65 + highlight_protection * 0.18
        elif mode == CalibrationMode.FILM:
            style_bias -= look_preservation * 0.58 + max(0.0, tone_style) * 0.18
        elif mode == CalibrationMode.SKIN_PRIORITY:
            style_bias -= skin_priority * 0.72
        elif mode == CalibrationMode.HIGHLIGHTS_ONLY:
            style_bias -= highlight_protection * 0.55
        elif mode == CalibrationMode.TONE_ZONE:
            style_bias -= max(0.0, tone_style) * 0.35 + highlight_protection * 0.12
        elif mode == CalibrationMode.MIDTONES_ONLY:
            style_bias -= max(0.0, -tone_style) * 0.22 + look_preservation * 0.18
        elif mode == CalibrationMode.SELECTIVE:
            style_bias -= skin_priority * 0.22 + look_preservation * 0.1
    cast_score = float(output_report.lab.cast_strength) * neutralization_weight
    rgb_spread_score = float(output_report.channel_spread) / 32.0
    regression_penalty = max(0.0, float(output_report.lab.cast_strength) - float(input_report.lab.cast_strength)) * 2.0
    return cast_score + rgb_spread_score + regression_penalty + style_bias


def _apply_core_calibration(
    entry: AnalysisEntry,
    image: np.ndarray,
    params: CalibrationParams,
    fast: bool = False,
    requested_mode: str | None = None,
    negative_base: bool = False,
    auto_style: dict[str, object] | None = None,
) -> dict:
    prepared = entry.prepared
    requested_mode = requested_mode or params.mode.value
    use_negative_base = negative_base and params.mode != CalibrationMode.NEGATIVE_FILM
    analysis_image: np.ndarray | None = None
    input_image = image
    input_report = entry.input_report
    input_zones = entry.zones
    if use_negative_base:
        input_image = prepare_negative_film_base(image)
        analysis_image = input_image
        input_report = analyze_image_array(input_image)
        input_zones = auto_detect_cast(input_image)

    if requested_mode == AUTO_BEST_MODE:
        fast = False
        candidates = []
        best_params = params
        best_score = float("inf")
        eval_image = _resize_to_max_side(input_image, AUTO_BEST_EVAL_MAX_SIDE)
        eval_report = analyze_image_array(eval_image)
        eval_zones = auto_detect_cast(eval_image)
        for candidate_mode in AUTO_BEST_CANDIDATES:
            candidate_params = replace(params, mode=candidate_mode)
            eval_result = calibrate_image_from_analysis(
                eval_image,
                candidate_params,
                eval_report,
                eval_zones,
                color_space=prepared.color_space,
                data_range=prepared.data_range,
                reuse_input_analysis=False,
                analyze_output=True,
            )
            base_score = _auto_best_score(eval_report, eval_result.post_report)
            score = _auto_best_score(
                eval_report,
                eval_result.post_report,
                mode=candidate_mode,
                auto_style=auto_style,
            )
            candidates.append({
                "mode": candidate_mode.value,
                "score": score,
                "base_score": base_score,
                "input_strength": eval_report.lab.cast_strength,
                "output_strength": eval_result.post_report.lab.cast_strength,
                "reduction_pct": eval_result.reduction_pct,
            })
            if score < best_score:
                best_score = score
                best_params = candidate_params
        if not candidates:
            raise ValueError("auto-best did not produce a calibration candidate")
        best_result = calibrate_image_from_analysis(
            input_image,
            best_params,
            input_report,
            input_zones,
            color_space=prepared.color_space,
            data_range=prepared.data_range,
            reuse_input_analysis=False,
            analyze_output=True,
        )
        metadata = {
            **best_result.metadata,
            "calibration_source": "core",
            "requested_mode": AUTO_BEST_MODE,
            "auto_best_selected_mode": best_params.mode.value,
            "auto_best_score": best_score,
            "auto_best_eval_max_side": AUTO_BEST_EVAL_MAX_SIDE,
        }
        if auto_style is not None:
            metadata["auto_style_preset"] = str(auto_style["preset"])
        if use_negative_base:
            metadata["analysis_basis"] = "negative-positive-base"
            metadata["negative_base_enabled"] = "true"
        return {
            "image": best_result.image,
            "input_report": input_report,
            "analysis_image": analysis_image if analysis_image is not None else best_result.analysis_image,
            "post_report": best_result.post_report,
            "mode": best_params.mode.value,
            "shift": {"a": best_result.a_shift, "b": best_result.b_shift},
            "metadata": metadata,
            "reduction_pct": best_result.reduction_pct,
            "params_override": best_params,
            "auto_best": {
                "selected_mode": best_params.mode.value,
                "score": best_score,
                "eval_max_side": AUTO_BEST_EVAL_MAX_SIDE,
                "auto_style": auto_style,
                "candidates": candidates,
            },
        }

    has_curves = params.r_curve is not None or params.g_curve is not None or params.b_curve is not None
    all_identity = _is_identity_curve(params.r_curve) and _is_identity_curve(params.g_curve) and _is_identity_curve(params.b_curve)
    cached_img = getattr(prepared, "cached_working_img", None)
    cached_ctx = getattr(prepared, "cached_working_context", None)

    if not use_negative_base and not all_identity and cached_img is not None and cached_ctx is not None:
        try:
            curved = calibrate_rgb_curves(
                cached_img, params.strength, params.curve_low_pct, params.curve_high_pct,
                params.gamma, r_curve=params.r_curve, g_curve=params.g_curve, b_curve=params.b_curve,
            )
            calibrated = _from_calibration_working_space(curved, cached_ctx)
            return {
                "image": calibrated,
                "post_report": entry.input_report,
                "mode": params.mode.value,
                "shift": {"a": 0.0, "b": 0.0},
                "metadata": {"calibration_source": "core", "fast_path": "curves_cached"},
                "reduction_pct": 0.0,
            }
        except Exception:
            object.__setattr__(prepared, "cached_working_img", None)
            object.__setattr__(prepared, "cached_working_context", None)

    result = calibrate_image_from_analysis(
        input_image, params, input_report, input_zones,
        color_space=prepared.color_space, data_range=prepared.data_range,
        reuse_input_analysis=fast and not use_negative_base,
        analyze_output=not fast,
    )
    if not use_negative_base and cached_img is None and not all_identity:
        try:
            wi, wc = _to_calibration_working_space(
                input_image, color_space=prepared.color_space, data_range=prepared.data_range,
            )
            shifted = calibrate_global(wi, result.a_shift, result.b_shift, params.strength)
            object.__setattr__(prepared, "cached_working_img", shifted)
            object.__setattr__(prepared, "cached_working_context", wc)
        except Exception:
            pass
    metadata = {**result.metadata, "calibration_source": "core"}
    if auto_style is not None:
        metadata["auto_style_preset"] = str(auto_style["preset"])
    if use_negative_base:
        metadata["analysis_basis"] = "negative-positive-base"
        metadata["negative_base_enabled"] = "true"
    return {
        "image": result.image,
        "input_report": input_report if use_negative_base else result.pre_report,
        "analysis_image": analysis_image if analysis_image is not None else result.analysis_image,
        "post_report": result.post_report,
        "mode": result.mode.value,
        "shift": {"a": result.a_shift, "b": result.b_shift},
        "metadata": metadata,
        "reduction_pct": result.reduction_pct,
    }


def _apply_calibration(entry: AnalysisEntry, image: np.ndarray, body: dict) -> dict:
    params = _calibration_params_from_body(body)
    calibrator_id = _plugin_calibrator_id(body)
    requested_mode = str(body.get("mode", params.mode.value))
    negative_base = _negative_base_enabled(body)
    auto_style = _auto_style_from_body(body)
    look_adjustments = _look_adjustments_from_body(body)
    tone_recovery = _tone_recovery_from_body(body)
    fast = bool(body.get("fast", False)) and requested_mode != AUTO_BEST_MODE
    if calibrator_id:
        payload = _apply_plugin_calibration(entry, image, params, calibrator_id, fast=fast)
    else:
        payload = _apply_core_calibration(
            entry,
            image,
            params,
            fast=fast,
            requested_mode=requested_mode,
            negative_base=negative_base,
            auto_style=auto_style,
        )
    if not is_identity_look(look_adjustments):
        payload["image"] = ensure_uint8_rgb(apply_look_adjustments(payload["image"], look_adjustments))
        payload.setdefault("metadata", {})["look_adjustments"] = look_adjustments
        payload.setdefault("metadata", {})["look_enabled"] = "true"
        if not fast:
            post_report = analyze_image_array(payload["image"])
            input_report = payload.get("input_report") or entry.input_report
            before = input_report.lab.cast_strength
            after = post_report.lab.cast_strength
            payload["post_report"] = post_report
            payload["reduction_pct"] = (1.0 - after / max(before, 0.01)) * 100.0
    if tone_recovery.get("enabled"):
        explicit_strength = tone_recovery.get("strength")
        tone_image, tone_analysis = apply_tone_recovery(
            payload["image"],
            strength=float(explicit_strength) if explicit_strength is not None else None,
            black_point=tone_recovery.get("black_point"),
            white_point=tone_recovery.get("white_point"),
            midtone=tone_recovery.get("midtone"),
            local_contrast=tone_recovery.get("local_contrast"),
        )
        resolved_tone = {
            **tone_recovery,
            **tone_analysis,
            "enabled": True,
            "auto": bool(tone_recovery.get("auto", True)),
        }
        payload["image"] = ensure_uint8_rgb(tone_image)
        payload.setdefault("metadata", {})["tone_recovery"] = resolved_tone
        payload.setdefault("metadata", {})["tone_recovery_enabled"] = "true"
        payload["tone_recovery"] = resolved_tone
        if not fast:
            post_report = analyze_image_array(payload["image"])
            input_report = payload.get("input_report") or entry.input_report
            before = input_report.lab.cast_strength
            after = post_report.lab.cast_strength
            payload["post_report"] = post_report
            payload["reduction_pct"] = (1.0 - after / max(before, 0.01)) * 100.0
    payload["params"] = payload.pop("params_override", params)
    payload["calibrator_plugin"] = calibrator_id
    payload["look_adjustments"] = look_adjustments
    payload.setdefault("tone_recovery", tone_recovery)
    if auto_style is not None:
        payload["auto_style"] = auto_style
        payload.setdefault("metadata", {})["auto_style"] = auto_style
    return payload


def _calibrate_payload(body: dict) -> dict:
    start = time.perf_counter()
    if body.get("path"):
        entry = _prepare_file_analysis(
            str(body["path"]),
            max_side=int(body.get("analysis_max_side", DEFAULT_ANALYSIS_MAX_SIDE)),
            reader_plugin=_plugin_reader_id(body),
            raw_options=_raw_decode_options(body),
        )
        return _calibrate_entry_payload(entry, body, start)
    if "image_data" not in body:
        raise ValueError("calibrate requires 'path' or 'image_data'")
    entry = _prepare_uploaded_analysis(
        body["image_data"],
        file_name=str(body.get("file_name", "")),
        max_side=int(body.get("analysis_max_side", DEFAULT_ANALYSIS_MAX_SIDE)),
        reader_plugin=_plugin_reader_id(body),
        raw_options=_raw_decode_options(body),
    )
    return _calibrate_entry_payload(entry, body, start)


def _preview_payload(body: dict) -> dict:
    start = time.perf_counter()
    entry = AnalysisSessionResolver(
        body,
        default_max_side=320,
        resolution_mode="target",
        reader_plugin=_plugin_reader_id(body),
        raw_options=_raw_decode_options(body),
        missing_input_message="preview requires path, session_id, or image_data",
    ).resolve()
    prepared = entry.prepared
    elapsed_ms = (time.perf_counter() - start) * 1000.0
    return {
        "session_id": entry.cache_key,
        "original_preview": _save_preview_image(
            _render_preview_rgb(
                prepared.image,
                color_space=prepared.color_space,
                data_range=prepared.data_range,
            )
        ),
        "processing": {
            "original_width": prepared.original_width,
            "original_height": prepared.original_height,
            "analysis_width": prepared.analysis_width,
            "analysis_height": prepared.analysis_height,
            "downsample_ratio": prepared.downsample_ratio,
            "source_dtype": prepared.source_dtype,
            "preview_source": prepared.preview_source,
            "color_space": prepared.color_space,
            "data_range": list(prepared.data_range) if prepared.data_range is not None else None,
            "elapsed_ms": elapsed_ms,
            "cache_key": entry.cache_key,
            "memory_cache_items": len(_ANALYSIS_CACHE),
        },
    }


def _preview_batch_items(body: dict) -> list[dict]:
    if isinstance(body.get("items"), list):
        items = [dict(item) for item in body["items"] if isinstance(item, dict)]
    elif isinstance(body.get("paths"), list):
        items = [
            {
                "path": str(path),
                "file_name": Path(str(path)).name,
            }
            for path in body["paths"]
        ]
    else:
        items = []
    if not items:
        raise ValueError("preview-batch requires items or paths")
    return items


def _preview_batch_item_payload(index: int, item: dict, body: dict, max_side: int) -> dict:
    request_body = {
        key: value
        for key, value in body.items()
        if key not in {"items", "paths", "workers", "async"}
    }
    request_body.update(item)
    request_body["analysis_max_side"] = max_side
    payload = _preview_payload(request_body)
    return {
        "index": index,
        "client_id": item.get("client_id"),
        "path": item.get("path"),
        "file_name": item.get("file_name"),
        "ok": True,
        **payload,
    }


def _preview_batch_cancel_result(index: int, item: dict, error: str) -> dict:
    return {
        "index": index,
        "client_id": item.get("client_id"),
        "path": item.get("path"),
        "file_name": item.get("file_name"),
        "cancelled": True,
        "error": error,
    }


def _run_preview_batch_sync(body: dict) -> dict:
    items = _preview_batch_items(body)
    max_side = int(body.get("analysis_max_side", 320))
    workers = max(1, min(int(body.get("workers", BATCH_WORKERS)), BATCH_WORKERS, len(items)))
    results: list[dict | None] = [None] * len(items)

    def one(index: int, item: dict) -> dict:
        return _preview_batch_item_payload(index, item, body, max_side)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        future_map = {pool.submit(one, index, item): index for index, item in enumerate(items)}
        for future in as_completed(future_map):
            index = future_map[future]
            try:
                results[index] = future.result()
            except Exception as exc:
                results[index] = {
                    "index": index,
                    "client_id": items[index].get("client_id"),
                    "path": items[index].get("path"),
                    "file_name": items[index].get("file_name"),
                    "ok": False,
                    "error": str(exc),
                }

    return {"workers": workers, "results": results}


def _start_preview_batch_job(body: dict) -> dict:
    items = _preview_batch_items(body)
    max_side = int(body.get("analysis_max_side", 320))
    workers = max(1, min(int(body.get("workers", BATCH_WORKERS)), BATCH_WORKERS, len(items)))
    job = _job_create(
        "preview-batch",
        total_items=len(items),
        workers=workers,
        metadata={"analysis_max_side": max_side},
    )

    def run_one(index: int, item: dict, cancel_event: Event) -> dict:
        if cancel_event.is_set():
            return _preview_batch_cancel_result(index, item, "cancelled")
        result = _preview_batch_item_payload(index, item, body, max_side)
        if cancel_event.is_set():
            return _preview_batch_cancel_result(index, item, "cancelled")
        return result

    def cancel_result(index: int, item: dict, error: str) -> dict:
        return _preview_batch_cancel_result(index, item, error)

    _JOB_EXECUTOR.submit(
        _run_async_batch_job,
        job["job_id"],
        items,
        workers=workers,
        run_one=run_one,
        cancel_result=cancel_result,
    )
    return _job_status_snapshot(job["job_id"]) or {"error": "unknown job_id"}


def _preview_batch_payload(body: dict) -> dict:
    if body.get("async"):
        return _start_preview_batch_job(body)
    return _run_preview_batch_sync(body)


def _calibrate_session_payload(body: dict) -> dict:
    start = time.perf_counter()
    entry = _get_analysis(str(body["session_id"]))
    if entry is None:
        raise ValueError("Unknown or expired session_id")
    return _calibrate_entry_payload(entry, body, start)


def _calibrate_entry_payload(entry: AnalysisEntry, body: dict, start: float) -> dict:
    t0 = time.perf_counter()
    image_transform = _image_transform_from_body(body)
    perspective_correction = _perspective_correction_from_body(body)
    img = entry.prepared.image
    crop_rect = _crop_rect_from_body(body)
    calibration_start = time.perf_counter()
    calibration = _apply_calibration(entry, img, body)
    if crop_rect or image_transform or perspective_correction:
        calibration = dict(calibration)
        calibration["image"] = _apply_geometry_corrections(
            calibration["image"],
            crop_rect,
            image_transform,
            perspective_correction,
        )
        if bool(body.get("fast", False)) and is_dataclass(calibration["post_report"]):
            transformed = calibration["image"]
            calibration["post_report"] = replace(
                calibration["post_report"],
                width=int(transformed.shape[1]),
                height=int(transformed.shape[0]),
            )
        else:
            calibration["post_report"] = analyze_image_array(calibration["image"])
        metadata = dict(calibration.get("metadata") or {})
        metadata["crop_applied"] = bool(crop_rect)
        metadata["image_transform_applied"] = bool(image_transform)
        metadata["perspective_applied"] = bool(perspective_correction)
        calibration["metadata"] = metadata
    calibration_ms = (time.perf_counter() - calibration_start) * 1000.0
    elapsed_ms = (time.perf_counter() - start) * 1000.0
    include_original = bool(body.get("include_original", True))
    fast = bool(body.get("fast", False))
    has_curves = bool(body.get("r_curve") or body.get("g_curve") or body.get("b_curve"))
    resp_start = time.perf_counter()
    result = _calibration_response(
        entry,
        calibration,
        _apply_geometry_corrections(img, crop_rect, image_transform, perspective_correction),
        elapsed_ms,
        include_original=include_original,
        fast=fast,
        crop_rect=crop_rect,
        image_transform=image_transform,
        perspective_correction=perspective_correction,
    )
    resp_ms = (time.perf_counter() - resp_start) * 1000.0
    total_ms = (time.perf_counter() - t0) * 1000.0
    result["_timing"] = {
        "calibration_ms": round(calibration_ms, 2),
        "response_ms": round(resp_ms, 2),
        "total_payload_ms": round(total_ms, 2),
        "has_curves": has_curves,
        "fast": fast,
    }
    return result


def _calibrate_path_payload(body: dict) -> dict:
    start = time.perf_counter()
    entry = _prepare_file_analysis(
        body["path"],
        max_side=int(body.get("analysis_max_side", DEFAULT_ANALYSIS_MAX_SIDE)),
        reader_plugin=_plugin_reader_id(body),
        raw_options=_raw_decode_options(body),
    )
    return _calibrate_entry_payload(entry, body, start)


def _run_paths_batch_sync(body: dict) -> dict:
    paths = [str(path) for path in body.get("paths", [])]
    if not paths:
        raise ValueError("paths must contain at least one image path")
    max_side = int(body.get("analysis_max_side", DEFAULT_ANALYSIS_MAX_SIDE))
    workers = max(1, min(int(body.get("workers", BATCH_WORKERS)), BATCH_WORKERS, len(paths)))

    def one(path: str) -> dict:
        start = time.perf_counter()
        entry = _prepare_file_analysis(
            path,
            max_side=max_side,
            reader_plugin=_plugin_reader_id(body),
            raw_options=_raw_decode_options(body),
        )
        return _calibrate_entry_payload(entry, body | {"path": path}, start)

    results: list[dict | None] = [None] * len(paths)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        future_map = {pool.submit(one, path): index for index, path in enumerate(paths)}
        for future in as_completed(future_map):
            index = future_map[future]
            try:
                results[index] = future.result()
            except Exception as exc:
                results[index] = {"path": paths[index], "error": str(exc)}
    return {"workers": workers, "results": results}


def _calibrate_paths_payload(body: dict) -> dict:
    if body.get("async"):
        return _start_paths_batch_job(body)
    return _run_paths_batch_sync(body)


def _run_upload_batch_sync(body: dict) -> dict:
    items = list(body.get("items", []))
    if not items:
        raise ValueError("items must contain at least one uploaded image")
    max_side = int(body.get("analysis_max_side", DEFAULT_ANALYSIS_MAX_SIDE))
    workers = max(1, min(int(body.get("workers", BATCH_WORKERS)), BATCH_WORKERS, len(items)))

    def one(index: int, item: dict) -> dict:
        start = time.perf_counter()
        entry = _prepare_uploaded_analysis(
            item["image_data"],
            file_name=str(item.get("file_name", f"upload-{index}")),
            max_side=max_side,
            reader_plugin=_plugin_reader_id(body | item),
            raw_options=_raw_decode_options(body | item),
        )
        request_body = body | item
        request_body.pop("items", None)
        return _calibrate_entry_payload(entry, request_body, start)

    results: list[dict | None] = [None] * len(items)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        future_map = {pool.submit(one, index, item): index for index, item in enumerate(items)}
        for future in as_completed(future_map):
            index = future_map[future]
            try:
                results[index] = future.result()
            except Exception as exc:
                results[index] = {"file_name": str(items[index].get("file_name", f"upload-{index}")), "error": str(exc)}
    return {"workers": workers, "results": results}


def _calibrate_batch_payload(body: dict) -> dict:
    if body.get("async"):
        return _start_upload_batch_job(body)
    return _run_upload_batch_sync(body)


def _calibration_response(
    entry: AnalysisEntry,
    calibration: dict,
    img: np.ndarray,
    elapsed_ms: float,
    include_original: bool = True,
    fast: bool = False,
    crop_rect: dict[str, float] | None = None,
    image_transform: dict[str, float | bool] | None = None,
    perspective_correction: dict | None = None,
) -> dict:
    prepared = entry.prepared
    accelerator = _accelerator_payload()
    input_report = calibration.get("input_report") or entry.input_report
    post_report = calibration["post_report"]
    metadata = calibration.get("metadata", {})
    original_preview = _render_preview_rgb(
        img,
        color_space=prepared.color_space,
        data_range=prepared.data_range,
    )
    calibrated_preview = _render_preview_rgb(
        calibration["image"],
        color_space=prepared.color_space,
        data_range=prepared.data_range,
    )
    analysis_image = calibration.get("analysis_image")
    analysis_preview = (
        _render_preview_rgb(
            analysis_image,
            color_space=prepared.color_space,
            data_range=prepared.data_range,
        )
        if isinstance(analysis_image, np.ndarray)
        else original_preview
    )
    input_label = "Positive base" if metadata.get("analysis_basis") == "negative-positive-base" else "Original"
    static_charts = None if isinstance(analysis_image, np.ndarray) else entry.static_charts
    charts = {} if fast else _chart_payload(input_report, post_report, analysis_preview, static_charts, input_label=input_label)
    if not fast:
        charts["calibrated_rgb_histogram"] = _histogram_payload(calibrated_preview, bins=256)
        cal_params = calibration.get("params")
        if isinstance(cal_params, CalibrationParams):
            lut_analysis = _lut_analysis_payload(cal_params)
            if lut_analysis is not None:
                charts["lut_analysis"] = lut_analysis
    payload = {
        "session_id": entry.cache_key,
        "input": _report_payload(input_report),
        "output": _report_payload(post_report),
        "mode": calibration["mode"],
        "shift": calibration["shift"],
        "reduction_pct": calibration["reduction_pct"],
        "original_preview": _save_preview_image(original_preview) if include_original else None,
        "calibrated_image": _save_preview_image(calibrated_preview),
        "charts": charts,
        "processing": {
            "original_width": prepared.original_width,
            "original_height": prepared.original_height,
            "analysis_width": prepared.analysis_width,
            "analysis_height": prepared.analysis_height,
            "downsample_ratio": prepared.downsample_ratio,
            "source_dtype": prepared.source_dtype,
            "preview_source": prepared.preview_source,
            "color_space": prepared.color_space,
            "data_range": list(prepared.data_range) if prepared.data_range is not None else None,
            "elapsed_ms": elapsed_ms,
            "cache_key": entry.cache_key,
            "memory_cache_items": len(_ANALYSIS_CACHE),
            "opencv_threads": cv2.getNumThreads(),
            "accelerator_backend": accelerator["active_backend"],
            "accelerator_requested": accelerator["requested_backend"],
            "accelerated_ops": accelerator["accelerated_ops"],
            "cpu_fallback_ops": accelerator["cpu_fallback_ops"],
            "gpu_ops": accelerator["gpu_ops"],
            "fallback_reason": accelerator["fallback_reason"],
            "opencl_available": accelerator["opencl_available"],
            "opencl_enabled": accelerator["opencl_enabled"],
            "auto_cast_source": metadata.get("auto_cast_source", "global"),
            "auto_cast_confidence": metadata.get("auto_cast_confidence", 1.0),
            "calibration_source": metadata.get("calibration_source", "core"),
            "calibration_plugin_id": metadata.get("plugin_id"),
            "calibration_plugin_name": metadata.get("plugin_name"),
            "analysis_basis": metadata.get("analysis_basis"),
            "negative_base_enabled": metadata.get("negative_base_enabled") == "true",
            "requested_mode": metadata.get("requested_mode"),
            "auto_best_selected_mode": metadata.get("auto_best_selected_mode"),
            "auto_best_score": metadata.get("auto_best_score"),
            "auto_best": calibration.get("auto_best"),
            "auto_style": calibration.get("auto_style"),
            "look_enabled": metadata.get("look_enabled") == "true",
            "look_adjustments": calibration.get("look_adjustments"),
            "tone_recovery_enabled": metadata.get("tone_recovery_enabled") == "true",
            "tone_recovery": calibration.get("tone_recovery"),
            "crop_rect": crop_rect,
            "crop_applied": bool(crop_rect),
            "image_transform": image_transform,
            "image_transform_applied": bool(image_transform),
            "perspective_correction": perspective_correction,
            "perspective_applied": bool(perspective_correction),
        },
    }
    payload["document"] = _session_document_payload(entry, {**calibration, "processing": payload["processing"]})
    _record_session_calibration(entry, payload)
    return payload


def _generate_cube_lut_data(export_result: dict, size: int = 17) -> np.ndarray | None:
    """Generate 3D LUT data from calibration result.

    Returns None when shift is negligible or mode is not representable as a 3D LUT,
    in which case the caller should fall back to identity or raise an error.
    """
    axis = np.linspace(0, 1, size, dtype=np.float32)
    r, g, b = np.meshgrid(axis, axis, axis, indexing="ij")
    grid = np.stack([r, g, b], axis=-1)
    flat = grid.reshape(-1, 3)

    params: CalibrationParams | None = export_result.get("params")
    strength = float(params.strength) if params else 1.0
    mode = export_result.get("mode", "global")

    if mode in ("matrix", "lut3d") and params is not None and params.matrix is not None:
        mat = np.array(params.matrix, dtype=np.float32)
        flat_out = flat @ mat.T
        return np.clip(flat_out.reshape(size, size, size, 3), 0.0, 1.0)

    if mode in ("global", "midtones-only", "skin-priority",
                "highlights-only", "preserve-split-tone",
                "tone-zone", "selective", "film", "negative-film"):
        a_shift = (export_result.get("shift") or {}).get("a") or 0.0
        b_shift = (export_result.get("shift") or {}).get("b") or 0.0
        if abs(a_shift) < 0.001 and abs(b_shift) < 0.001:
            return None
        flat_u8 = np.clip(np.rint(flat * 255.0), 0, 255).astype(np.uint8).reshape(-1, 1, 3)
        lab = ACCELERATOR.rgb_to_lab_float(flat_u8)
        lab[:, :, 1] += a_shift * strength
        lab[:, :, 2] += b_shift * strength
        flat_out = ACCELERATOR.lab_to_rgb_float(lab).reshape(-1, 3)
        return np.clip(flat_out.reshape(size, size, size, 3), 0.0, 1.0)

    return None


def _export_payload(body: dict) -> dict:
    """Export calibrated image to disk file."""
    start = time.perf_counter()

    output_path = _resolve_output_path(body["output_path"], body.get("format", "jpeg"))
    fmt = body.get("format", "jpeg")
    policy = _export_policy(body)

    if body.get("path"):
        entry = _prepare_file_analysis(
            str(body["path"]),
            reader_plugin=_plugin_reader_id(body),
            raw_options=_raw_decode_options(body),
        )
    else:
        entry = _prepare_uploaded_analysis(
            body["image_data"],
            file_name=str(body.get("file_name", "")),
            reader_plugin=_plugin_reader_id(body),
            raw_options=_raw_decode_options(body),
        )

    if body.get("path"):
        source_buffer = _load_file_source_buffer(
            str(body["path"]),
            reader_plugin=_plugin_reader_id(body),
            raw_options=_raw_decode_options(body),
        )
    else:
        source_buffer = _load_uploaded_source_buffer(
            body["image_data"],
            file_name=str(body.get("file_name", "")),
            reader_plugin=_plugin_reader_id(body),
            raw_options=_raw_decode_options(body),
        )
    export_result = _apply_calibration(entry, source_buffer.data, body)
    export_image = _apply_geometry_corrections(
        export_result["image"],
        _crop_rect_from_body(body),
        _image_transform_from_body(body),
        _perspective_correction_from_body(body),
    )
    buf = _export_buffer_from_result(source_buffer, export_image, body)
    writer_metadata = None

    if fmt in {"jpeg", "jpg", "png", "tiff16", "tif16", "exr", "hdr"}:
        writer_metadata = _write_image_with_plugins(
            buf,
            output_path,
            fmt=fmt,
            quality=int(body.get("quality", 92)),
            writer_plugin=_plugin_writer_id(body),
            **policy,
        )
    elif fmt == "sidecar":
        from photo_calibrator.io.sidecar import write_sidecar_json

        params = _calibration_params_from_body(body)
        calib_params = {
            "mode": export_result["mode"],
            "a_shift": export_result["shift"].get("a"),
            "b_shift": export_result["shift"].get("b"),
            "strength": params.strength,
            "calibrator_plugin": _plugin_calibrator_id(body),
        }
        write_sidecar_json(
            output_path,
            calib_params,
            input_metadata=_source_input_metadata(source_buffer),
            ai_evaluations=deepcopy(_session_metadata(entry).get("ai_evaluations")),
            session_metadata=_session_sidecar_metadata(entry),
            export_settings=_export_settings_payload(
                fmt=fmt,
                output_path=output_path,
                source_buffer=source_buffer,
                quality=int(body.get("quality", 92)),
                **policy,
            ),
        )
    elif fmt == "cube":
        from photo_calibrator.io.lut_export import write_cube_lut

        lut_data = _generate_cube_lut_data(export_result)
        if lut_data is None and export_result.get("mode") == "rgb-curves":
            raise ValueError(
                "Cube LUT export is not supported for rgb-curves mode. "
                "Use 'sidecar' format instead to export calibration parameters."
            )
        write_cube_lut(output_path, size=17, lut_data=lut_data)
    else:
        raise ValueError(f"Unsupported export format: {fmt}")

    elapsed_ms = (time.perf_counter() - start) * 1000.0
    return {
        "ok": True,
        "path": str(output_path),
        "format": fmt,
        "size": output_path.stat().st_size if output_path.exists() else 0,
        "elapsed_ms": elapsed_ms,
        "writer": writer_metadata,
        "export_settings": _export_settings_payload(
            fmt=fmt,
            output_path=output_path,
            source_buffer=source_buffer,
            quality=int(body.get("quality", 92)),
            **policy,
        ),
    }


def _cache_stats_payload() -> dict:
    """GET /api/cache/stats — cache statistics."""
    with _CACHE_LOCK:
        now = time.time()
        oldest = 0.0
        for entry in _ANALYSIS_CACHE.values():
            age = now - entry.created_at
            if oldest == 0.0 or age > oldest:
                oldest = age
        preview_files = 0
        if PREVIEW_CACHE_DIR.exists():
            preview_files = sum(1 for path in PREVIEW_CACHE_DIR.iterdir() if path.is_file())
        return {
            "items": len(_ANALYSIS_CACHE),
            "limit": MEMORY_CACHE_LIMIT,
            "ttl_seconds": SESSION_TTL_SECONDS,
            "oldest_age_seconds": oldest,
            "preview_cache_files": preview_files,
        }


def _cache_clear_payload() -> dict:
    """POST /api/cache/clear — clear all cached analysis entries."""
    preview_deleted = 0
    with _CACHE_LOCK:
        count = len(_ANALYSIS_CACHE)
        _ANALYSIS_CACHE.clear()
        _ANALYSIS_KEY_LOCKS.clear()
    if PREVIEW_CACHE_DIR.exists():
        for path in PREVIEW_CACHE_DIR.iterdir():
            if path.is_file():
                path.unlink(missing_ok=True)
                preview_deleted += 1
    return {"ok": True, "cleared": count, "preview_cache_deleted": preview_deleted}


def _preview_cache_cleanup_payload(body: dict) -> dict:
    max_age_seconds = max(0.0, float(body.get("max_age_seconds", SESSION_TTL_SECONDS)))
    deleted = 0
    kept = 0
    now = time.time()
    PREVIEW_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    for path in PREVIEW_CACHE_DIR.iterdir():
        if not path.is_file():
            continue
        age = now - path.stat().st_mtime
        if age >= max_age_seconds:
            path.unlink(missing_ok=True)
            deleted += 1
        else:
            kept += 1
    return {
        "ok": True,
        "deleted": deleted,
        "kept": kept,
        "max_age_seconds": max_age_seconds,
    }


def _sidecar_save_payload(body: dict) -> dict:
    """POST /api/sidecar/save — write calibration sidecar JSON."""
    from photo_calibrator.io.sidecar import write_sidecar_json

    path = Path(body["path"])
    calib = body.get("calibration", {})
    version = body.get("algorithm_version", "0.2.0")
    metadata = body.get("input_metadata")
    session_meta = body.get("session_metadata")
    ai_evaluations = body.get("ai_evaluations")
    export_settings = body.get("export_settings")
    session_id = body.get("session_id")
    if session_id:
        entry = _get_analysis(str(session_id))
        if entry is None:
            raise ValueError("Unknown or expired session_id")
        if not calib:
            calib = deepcopy(_session_metadata(entry).get("last_calibration", {}))
        if session_meta is None:
            session_meta = _session_sidecar_metadata(entry)
        if ai_evaluations is None:
            ai_evaluations = deepcopy(_session_metadata(entry).get("ai_evaluations"))
    write_sidecar_json(
        path,
        calib,
        algorithm_version=version,
        input_metadata=metadata,
        ai_evaluations=ai_evaluations,
        session_metadata=session_meta,
        export_settings=export_settings,
    )
    return {"ok": True, "path": str(path), "size": path.stat().st_size}


def _sidecar_load_payload(body: dict) -> dict:
    """GET /api/sidecar/load?path=... — read calibration sidecar JSON."""
    from photo_calibrator.io.sidecar import read_sidecar_json

    return read_sidecar_json(body["path"])


def _serialize_analysis_entry(entry: AnalysisEntry) -> dict[str, object]:
    return {
        "cache_key": entry.cache_key,
        "created_at": entry.created_at,
        "prepared": {
            "image": _encode_array_payload(entry.prepared.image),
            "original_width": entry.prepared.original_width,
            "original_height": entry.prepared.original_height,
            "analysis_width": entry.prepared.analysis_width,
            "analysis_height": entry.prepared.analysis_height,
            "downsample_ratio": entry.prepared.downsample_ratio,
            "source_dtype": entry.prepared.source_dtype,
            "preview_source": entry.prepared.preview_source,
            "color_space": entry.prepared.color_space,
            "data_range": list(entry.prepared.data_range) if entry.prepared.data_range is not None else None,
        },
        "input_report": _report_payload(entry.input_report),
        "zones": _json_safe(entry.zones),
        "static_charts": _json_safe(entry.static_charts),
        "session_metadata": _json_safe(entry.session_metadata),
    }


def _deserialize_analysis_entry(payload: dict) -> AnalysisEntry:
    prepared_payload = payload["prepared"]
    prepared = PreparedImage(
        image=_decode_array_payload(prepared_payload["image"]),
        original_width=int(prepared_payload["original_width"]),
        original_height=int(prepared_payload["original_height"]),
        analysis_width=int(prepared_payload["analysis_width"]),
        analysis_height=int(prepared_payload["analysis_height"]),
        downsample_ratio=float(prepared_payload["downsample_ratio"]),
        source_dtype=str(prepared_payload["source_dtype"]),
        preview_source=str(prepared_payload["preview_source"]),
        color_space=str(prepared_payload.get("color_space", "sRGB")),
        data_range=tuple(prepared_payload["data_range"]) if prepared_payload.get("data_range") is not None else None,
    )
    input_report = analyze_image_array(prepared.image)
    zones = payload.get("zones") or auto_detect_cast(prepared.image)
    static_charts = payload.get("static_charts") or _static_chart_payload(
        input_report,
        _render_preview_rgb(
            prepared.image,
            color_space=prepared.color_space,
            data_range=prepared.data_range,
        ),
    )
    return AnalysisEntry(
        prepared=prepared,
        input_report=input_report,
        zones=zones,
        static_charts=static_charts,
        cache_key=str(payload["cache_key"]),
        created_at=float(payload.get("created_at", time.time())),
        session_metadata=deepcopy(payload.get("session_metadata", {})),
    )


def _session_save_payload(body: dict) -> dict:
    session_id = str(body["session_id"])
    path_value = body.get("path")
    path = Path(path_value) if path_value else (SESSION_STORE_DIR / f"{session_id}.json")
    entry = _get_analysis(session_id)
    if entry is None:
        raise ValueError("Unknown or expired session_id")
    doc = {
        "session_version": 1,
        "saved_at": time.time(),
        "entry": _serialize_analysis_entry(entry),
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")
    return {
        "ok": True,
        "path": str(path),
        "session_id": session_id,
        "size": path.stat().st_size,
    }


def _session_load_payload(body: dict) -> dict:
    path = Path(body["path"])
    payload = json.loads(path.read_text(encoding="utf-8"))
    entry = _deserialize_analysis_entry(payload["entry"])
    if body.get("new_session_id"):
        entry = AnalysisEntry(
            prepared=entry.prepared,
            input_report=entry.input_report,
            zones=entry.zones,
            static_charts=entry.static_charts,
            cache_key=str(body["new_session_id"]),
            created_at=time.time(),
            session_metadata=deepcopy(entry.session_metadata),
        )
    _remember_analysis(entry)
    return {
        "ok": True,
        "path": str(path),
        "session_id": entry.cache_key,
        "processing": {
            "analysis_width": entry.prepared.analysis_width,
            "analysis_height": entry.prepared.analysis_height,
            "preview_source": entry.prepared.preview_source,
            "color_space": entry.prepared.color_space,
            "data_range": list(entry.prepared.data_range) if entry.prepared.data_range is not None else None,
        },
    }


def _session_list_payload(_query: dict) -> dict:
    SESSION_STORE_DIR.mkdir(parents=True, exist_ok=True)
    sessions: list[dict[str, object]] = []
    for path in sorted(SESSION_STORE_DIR.glob("*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            entry = payload.get("entry", {})
            prepared = entry.get("prepared", {})
            sessions.append(
                {
                    "path": str(path),
                    "session_id": str(entry.get("cache_key", path.stem)),
                    "saved_at": payload.get("saved_at"),
                    "size": path.stat().st_size,
                    "analysis_width": prepared.get("analysis_width"),
                    "analysis_height": prepared.get("analysis_height"),
                    "preview_source": prepared.get("preview_source"),
                }
            )
        except Exception:
            sessions.append(
                {
                    "path": str(path),
                    "session_id": path.stem,
                    "error": "unreadable",
                    "size": path.stat().st_size,
                }
            )
    return {"sessions": sessions}


def _session_delete_payload(body: dict) -> dict:
    path_value = body.get("path")
    session_id = body.get("session_id")
    if path_value:
        path = Path(path_value)
    elif session_id:
        path = SESSION_STORE_DIR / f"{session_id}.json"
    else:
        raise ValueError("session delete requires path or session_id")
    existed = path.exists()
    path.unlink(missing_ok=True)
    return {"ok": True, "path": str(path), "deleted": existed}


def _session_cleanup_payload(body: dict) -> dict:
    max_age_seconds = max(0.0, float(body.get("max_age_seconds", SESSION_TTL_SECONDS)))
    SESSION_STORE_DIR.mkdir(parents=True, exist_ok=True)
    deleted = 0
    kept = 0
    now = time.time()
    for path in SESSION_STORE_DIR.glob("*.json"):
        age = now - path.stat().st_mtime
        if age >= max_age_seconds:
            path.unlink(missing_ok=True)
            deleted += 1
        else:
            kept += 1
    return {
        "ok": True,
        "deleted": deleted,
        "kept": kept,
        "max_age_seconds": max_age_seconds,
    }


# ---------------------------------------------------------------------------
# Workspace DB API
# ---------------------------------------------------------------------------


def _workspace_stats_payload() -> dict:
    """GET /api/workspace/stats — workspace database statistics."""
    db = get_workspace_db(ROOT)
    return db.stats()


def _workspace_sync_payload(body: dict) -> dict:
    """POST /api/workspace/sync — sync file inventory for a directory."""
    directory = Path(body.get("directory", ROOT))
    if not directory.is_dir():
        raise ValueError(f"Directory not found: {directory}")
    extensions = body.get("extensions")
    ext_set = set(extensions) if extensions else None
    db = get_workspace_db(ROOT)
    report = db.sync_directory(directory, extensions=ext_set)
    return {
        "ok": True,
        "directory": str(directory),
        "added": len(report.added),
        "removed": len(report.removed),
        "modified": len(report.modified),
        "unchanged": report.unchanged,
        "total_changes": report.total_changes,
    }


def _workspace_db_from_body(body: dict):
    root_value = body.get("workspace_root")
    if not root_value:
        raise ValueError("workspace_root required")
    root = Path(str(root_value)).expanduser().resolve()
    if not root.is_dir():
        raise ValueError(f"Workspace directory not found: {root}")
    return root, get_workspace_db(root)


def _preview_blob_from_url(value: object) -> tuple[bytes | None, str | None]:
    if not isinstance(value, str) or not value:
        return None, None
    if value.startswith("data:") and "," in value:
        header, encoded = value.split(",", 1)
        mime = header[5:].split(";", 1)[0] or "image/jpeg"
        return base64.b64decode(encoded), mime
    parsed = urlparse(value)
    if not parsed.path.startswith("/api/preview-image/"):
        return None, None
    candidate = (PREVIEW_CACHE_DIR / Path(parsed.path).name).resolve()
    if not str(candidate).startswith(str(PREVIEW_CACHE_DIR.resolve())) or not candidate.is_file():
        return None, None
    return candidate.read_bytes(), mimetypes.guess_type(candidate.name)[0] or "image/jpeg"


def _preview_data_url(blob: bytes | None, mime: str | None) -> str | None:
    if not blob:
        return None
    return f"data:{mime or 'image/jpeg'};base64,{base64.b64encode(blob).decode('ascii')}"


def _history_entries_payload(db, session_id: str) -> list[dict[str, object]]:
    return [
        {
            "id": record.id,
            "sequence_no": record.sequence_no,
            "description": record.description,
            "action_type": record.action_type,
            "before_state": json.loads(record.before_state_json) if record.before_state_json else None,
            "after_state": json.loads(record.after_state_json) if record.after_state_json else None,
            "created_at": record.created_at,
        }
        for record in db.load_actions(session_id)
    ]


def _history_cursor_index(entries: list[dict[str, object]], sequence_no: int) -> int:
    for index, entry in enumerate(entries):
        if int(entry.get("sequence_no", -1)) == sequence_no:
            return index
    return -1


def _workspace_open_payload(body: dict) -> dict:
    root, db = _workspace_db_from_body(body)
    paths = [str(Path(value).expanduser().resolve()) for value in body.get("paths", [])]
    report = db.sync_directory(root)
    modified = set(report.modified)
    added = set(report.added)
    files: list[dict[str, object]] = []
    for source_path in paths:
        sessions = db.list_sessions(source_path=source_path)
        session = sessions[0] if sessions else None
        if source_path in modified:
            status = "modified"
        elif session is not None:
            status = "restored"
        else:
            status = "fresh" if source_path in added else "fresh"
        payload: dict[str, object] = {"path": source_path, "status": status}
        if session is not None and status == "restored":
            history_entries = _history_entries_payload(db, session.session_id)
            payload.update(
                {
                    "persistent_session_id": session.session_id,
                    "state": json.loads(session.session_data_json),
                    "history_cursor": _history_cursor_index(history_entries, session.history_cursor),
                    "history": history_entries,
                    "calibrated_image": _preview_data_url(
                        session.calibrated_preview_blob, session.calibrated_preview_mime
                    ),
                }
            )
        files.append(payload)
    return {
        "ok": True,
        "workspace_root": str(root),
        "database_path": str(root / "photo-calibrator.db"),
        "persistent": True,
        "files": files,
    }


def _workspace_clear_payload() -> dict:
    """POST /api/workspace/clear — clear all workspace database entries."""
    db = get_workspace_db(ROOT)
    result = db.clear_all()
    return {"ok": True, **result}


# ---------------------------------------------------------------------------
# Export-path: calibrate from local file path
# ---------------------------------------------------------------------------


def _export_path_payload(body: dict) -> dict:
    """POST /api/export-path — calibrate and export from local file path."""
    start = time.perf_counter()
    input_path = body["input_path"]
    output_path = _resolve_output_path(body["output_path"], body.get("format", "jpeg"))
    fmt = body.get("format", "jpeg")
    policy = _export_policy(body)
    max_side = int(body.get("analysis_max_side", DEFAULT_ANALYSIS_MAX_SIDE))

    entry = _prepare_file_analysis(
        input_path,
        max_side=max_side,
        reader_plugin=_plugin_reader_id(body),
        raw_options=_raw_decode_options(body),
    )
    source_buffer = _load_file_source_buffer(
        input_path,
        reader_plugin=_plugin_reader_id(body),
        raw_options=_raw_decode_options(body),
    )
    result = _apply_calibration(entry, source_buffer.data, body)

    if fmt == "sidecar":
        from photo_calibrator.io.sidecar import write_sidecar_json

        params = _calibration_params_from_body(body)
        write_sidecar_json(
            output_path,
            {
                "mode": result["mode"],
                "a_shift": result["shift"].get("a"),
                "b_shift": result["shift"].get("b"),
                "strength": params.strength,
                "calibrator_plugin": _plugin_calibrator_id(body),
            },
            input_metadata=_source_input_metadata(source_buffer),
            session_metadata=_session_sidecar_metadata(entry),
            ai_evaluations=deepcopy(_session_metadata(entry).get("ai_evaluations")),
            export_settings=_export_settings_payload(
                fmt=fmt,
                output_path=output_path,
                source_buffer=source_buffer,
                quality=int(body.get("quality", 92)),
                **policy,
            ),
        )
    else:
        export_image = _apply_geometry_corrections(
            result["image"],
            _crop_rect_from_body(body),
            _image_transform_from_body(body),
            _perspective_correction_from_body(body),
        )
        buf = _export_buffer_from_result(source_buffer, export_image, body)
        writer_metadata = _write_image_with_plugins(
            buf,
            output_path,
            fmt=fmt,
            quality=int(body.get("quality", 92)),
            writer_plugin=_plugin_writer_id(body),
            **policy,
        )
    if fmt == "sidecar":
        writer_metadata = None

    elapsed_ms = (time.perf_counter() - start) * 1000.0
    return {
        "ok": True,
        "path": str(output_path),
        "format": fmt,
        "size": output_path.stat().st_size,
        "elapsed_ms": elapsed_ms,
        "writer": writer_metadata,
        "export_settings": _export_settings_payload(
            fmt=fmt,
            output_path=output_path,
            source_buffer=source_buffer,
            quality=int(body.get("quality", 92)),
            **policy,
        ),
    }


def _resolve_output_path(output_path: str | Path, fmt: str) -> Path:
    path = Path(output_path).resolve()
    suffix_map = {
        "jpeg": ".jpg",
        "jpg": ".jpg",
        "png": ".png",
        "tiff16": ".tif",
        "tif16": ".tif",
        "exr": ".exr",
        "hdr": ".hdr",
        "sidecar": ".json",
        "cube": ".cube",
    }
    desired = suffix_map.get(fmt.lower())
    if desired and path.suffix.lower() != desired:
        return path.with_suffix(desired)
    return path


def _load_uploaded_source_buffer(
    data_url: str,
    file_name: str = "",
    reader_plugin: str | None = None,
    raw_options: dict[str, object] | None = None,
):
    raw, _ = _data_url_bytes(data_url)
    suffix = Path(file_name).suffix or ".png"
    if reader_plugin:
        with tempfile.NamedTemporaryFile(suffix=suffix) as tmp:
            tmp.write(raw)
            tmp.flush()
            return _read_image_with_plugins(tmp.name, reader_plugin=reader_plugin)
    if is_raw_extension(file_name):
        return decode_raw_image(raw, file_name, **(raw_options or {"output_bps": 16}))

    with tempfile.NamedTemporaryFile(suffix=suffix) as tmp:
        tmp.write(raw)
        tmp.flush()
        return _read_image_with_plugins(tmp.name)


def _load_file_source_buffer(
    file_path: str | Path,
    reader_plugin: str | None = None,
    raw_options: dict[str, object] | None = None,
):
    path = Path(file_path)
    if reader_plugin:
        return _read_image_with_plugins(path, reader_plugin=reader_plugin)
    if is_raw_extension(path.name):
        return decode_raw_image(path.read_bytes(), path.name, **(raw_options or {"output_bps": 16}))
    return _read_image_with_plugins(path)


def _image_buffer_to_export_rgb(image_buffer) -> np.ndarray:
    rgb = image_buffer.data
    if rgb.ndim != 3 or rgb.shape[2] != 3:
        raise ValueError("Export image must be an HxWx3 RGB array")
    return rgb


def _perspective_payload_from_corners(
    corners: list | tuple,
    width: int,
    height: int,
    *,
    enabled: bool,
) -> dict | None:
    if not enabled or len(corners) != 4:
        return None
    normalized: list[list[float]] = []
    for point in corners:
        if isinstance(point, dict):
            x = float(point.get("x", 0.0))
            y = float(point.get("y", 0.0))
        elif isinstance(point, (list, tuple)) and len(point) >= 2:
            x = float(point[0])
            y = float(point[1])
        else:
            return None
        normalized.append([
            float(np.clip(x / max(width - 1, 1), 0.0, 1.0)),
            float(np.clip(y / max(height - 1, 1), 0.0, 1.0)),
        ])
    return {
        "enabled": True,
        "corners": normalized,
        "source_width": int(width),
        "source_height": int(height),
    }


def _film_scan_payload(body: dict) -> dict:
    detector_plugin = _plugin_film_scan_detector_id(body)
    entry = AnalysisSessionResolver(
        body,
        default_max_side=FILM_SCAN_MAX_SIDE,
        min_max_side=FILM_SCAN_MAX_SIDE,
        max_max_side=FILM_SCAN_MAX_SIDE,
        resolution_mode="minimum",
        reader_plugin=_plugin_reader_id(body),
        raw_options=_raw_decode_options(body),
        missing_session_message="session_id is missing or expired",
        missing_input_message="film scan requires session_id, path, or image_data",
    ).resolve()

    prepared = entry.prepared
    plugin_result = None
    if detector_plugin:
        plugin_result = _plugin_service().run_film_scan(prepared.image, detector_id=detector_plugin)
        width = max(1, prepared.analysis_width)
        height = max(1, prepared.analysis_height)
        crop_rect = plugin_result.crop_rect or {}
        crop_left = float(np.clip(float(crop_rect.get("left", 0.0)), 0.0, 1.0))
        crop_top = float(np.clip(float(crop_rect.get("top", 0.0)), 0.0, 1.0))
        crop_width = float(np.clip(float(crop_rect.get("width", 0.0)), 0.0, 1.0 - crop_left))
        crop_height = float(np.clip(float(crop_rect.get("height", 0.0)), 0.0, 1.0 - crop_top))
        perspective_correction = _perspective_payload_from_corners(
            plugin_result.corners,
            width,
            height,
            enabled=plugin_result.is_perspective,
        )
        return {
            "session_id": entry.cache_key,
            "crop_rect": {
                "left": crop_left,
                "top": crop_top,
                "width": crop_width,
                "height": crop_height,
            },
            "perspective_correction": perspective_correction,
            "film_scan": {
                "angle_deg": plugin_result.angle_deg,
                "confidence": plugin_result.confidence,
                "border_type": plugin_result.border_type,
                "is_perspective": plugin_result.is_perspective,
                "corners": plugin_result.corners,
                "crop_x": int(round(crop_left * width)),
                "crop_y": int(round(crop_top * height)),
                "crop_w": int(round(crop_width * width)),
                "crop_h": int(round(crop_height * height)),
                "film_format": plugin_result.film_format,
                "evaluation_score": plugin_result.metadata.get("evaluation_score"),
                "diagnosis": plugin_result.metadata.get("diagnosis", []),
            },
            "processing": {
                "analysis_width": prepared.analysis_width,
                "analysis_height": prepared.analysis_height,
                "preview_source": prepared.preview_source,
                "film_scan_source": "plugin",
                "film_scan_plugin_id": plugin_result.plugin_id,
                "film_scan_plugin_name": plugin_result.detector_name,
            },
        }

    detect_image = prepared.image
    detect_scale_x = 1.0
    detect_scale_y = 1.0
    longest_side = max(prepared.image.shape[:2])
    if longest_side > FILM_SCAN_MAX_SIDE:
        detect_image = _resize_to_max_side(prepared.image, FILM_SCAN_MAX_SIDE)
        detect_scale_x = prepared.image.shape[1] / max(detect_image.shape[1], 1)
        detect_scale_y = prepared.image.shape[0] / max(detect_image.shape[0], 1)

    result = detect_film_frame(detect_image)
    if detect_scale_x != 1.0 or detect_scale_y != 1.0:
        scaled_corners = [
            (int(round(x * detect_scale_x)), int(round(y * detect_scale_y)))
            for x, y in result.corners
        ]
        scaled_debug = _scale_film_scan_debug(result.debug, detect_scale_x, detect_scale_y)
        result = type(result)(
            angle_deg=result.angle_deg,
            corners=scaled_corners,
            crop_x=int(round(result.crop_x * detect_scale_x)),
            crop_y=int(round(result.crop_y * detect_scale_y)),
            crop_w=int(round(result.crop_w * detect_scale_x)),
            crop_h=int(round(result.crop_h * detect_scale_y)),
            confidence=result.confidence,
            border_type=result.border_type,
            is_perspective=result.is_perspective,
            transform_matrix=result.transform_matrix,
            film_format=result.film_format,
            evaluation=result.evaluation,
            debug=scaled_debug,
        )
    width = max(1, prepared.analysis_width)
    height = max(1, prepared.analysis_height)
    crop_rect = {
        "left": float(result.crop_x) / width,
        "top": float(result.crop_y) / height,
        "width": float(result.crop_w) / width,
        "height": float(result.crop_h) / height,
    }
    crop_rect["left"] = float(np.clip(crop_rect["left"], 0.0, 1.0))
    crop_rect["top"] = float(np.clip(crop_rect["top"], 0.0, 1.0))
    crop_rect["width"] = float(np.clip(crop_rect["width"], 0.0, 1.0 - crop_rect["left"]))
    crop_rect["height"] = float(np.clip(crop_rect["height"], 0.0, 1.0 - crop_rect["top"]))
    perspective_correction = _perspective_payload_from_corners(
        result.corners,
        width,
        height,
        enabled=result.is_perspective,
    )

    return {
        "session_id": entry.cache_key,
        "crop_rect": crop_rect,
        "perspective_correction": perspective_correction,
        "film_scan": {
            "angle_deg": result.angle_deg,
            "confidence": result.confidence,
            "border_type": result.border_type,
            "is_perspective": result.is_perspective,
            "corners": result.corners,
            "crop_x": result.crop_x,
            "crop_y": result.crop_y,
            "crop_w": result.crop_w,
            "crop_h": result.crop_h,
            "film_format": result.film_format.name if result.film_format else None,
            "evaluation_score": result.evaluation.overall_score if result.evaluation else None,
            "diagnosis": result.evaluation.diagnosis if result.evaluation else [],
            "debug": _normalize_film_scan_debug(result.debug, width, height),
        },
        "processing": {
            "analysis_width": prepared.analysis_width,
            "analysis_height": prepared.analysis_height,
            "detect_width": int(detect_image.shape[1]),
            "detect_height": int(detect_image.shape[0]),
            "preview_source": prepared.preview_source,
            "film_scan_source": "core",
        },
    }


def _scale_film_scan_debug(
    debug: dict | None,
    scale_x: float,
    scale_y: float,
) -> dict | None:
    if not isinstance(debug, dict):
        return debug
    scaled = deepcopy(debug)

    def _scale_rect(rect: dict | None) -> None:
        if not isinstance(rect, dict):
            return
        rect["left"] = int(round(float(rect.get("left", 0)) * scale_x))
        rect["top"] = int(round(float(rect.get("top", 0)) * scale_y))
        rect["width"] = int(round(float(rect.get("width", 0)) * scale_x))
        rect["height"] = int(round(float(rect.get("height", 0)) * scale_y))

    for key in ("selected_crop", "detected_crop", "hough_crop"):
        _scale_rect(scaled.get(key))

    safe_inset = scaled.get("safe_inset")
    if isinstance(safe_inset, dict):
        safe_inset["x"] = int(round(float(safe_inset.get("x", 0)) * scale_x))
        safe_inset["y"] = int(round(float(safe_inset.get("y", 0)) * scale_y))

    edges = scaled.get("edges")
    if isinstance(edges, dict):
        for edge_name, edge in edges.items():
            if not isinstance(edge, dict):
                continue
            axis_scale = scale_x if edge_name in {"left", "right"} else scale_y
            band_scale = scale_y if edge_name in {"left", "right"} else scale_x
            for key in ("anchor", "weighted_trim"):
                if edge.get(key) is not None:
                    edge[key] = int(round(float(edge[key]) * axis_scale))
            for key in ("merged_candidates",):
                values = edge.get(key)
                if isinstance(values, list):
                    edge[key] = [int(round(float(value) * axis_scale)) for value in values]
            for key in ("global_candidates", "band_samples"):
                values = edge.get(key)
                if not isinstance(values, list):
                    continue
                for item in values:
                    if not isinstance(item, dict):
                        continue
                    if item.get("trim") is not None:
                        item["trim"] = int(round(float(item["trim"]) * axis_scale))
                    if item.get("band_start") is not None:
                        item["band_start"] = int(round(float(item["band_start"]) * band_scale))
                    if item.get("band_end") is not None:
                        item["band_end"] = int(round(float(item["band_end"]) * band_scale))
    if scaled.get("image_width") is not None:
        scaled["image_width"] = int(round(float(scaled["image_width"]) * scale_x))
    if scaled.get("image_height") is not None:
        scaled["image_height"] = int(round(float(scaled["image_height"]) * scale_y))
    if scaled.get("detect_width") is not None:
        scaled["detect_width"] = int(round(float(scaled["detect_width"]) * scale_x))
    if scaled.get("detect_height") is not None:
        scaled["detect_height"] = int(round(float(scaled["detect_height"]) * scale_y))
    return scaled


def _normalize_film_scan_debug(
    debug: dict | None,
    width: int,
    height: int,
) -> dict | None:
    if not isinstance(debug, dict) or width <= 0 or height <= 0:
        return None
    normalized = deepcopy(debug)

    def _normalize_rect(rect: dict | None) -> None:
        if not isinstance(rect, dict):
            return
        rect["left"] = float(rect.get("left", 0.0)) / width
        rect["top"] = float(rect.get("top", 0.0)) / height
        rect["width"] = float(rect.get("width", 0.0)) / width
        rect["height"] = float(rect.get("height", 0.0)) / height

    for key in ("selected_crop", "detected_crop", "hough_crop"):
        _normalize_rect(normalized.get(key))

    safe_inset = normalized.get("safe_inset")
    if isinstance(safe_inset, dict):
        safe_inset["x"] = float(safe_inset.get("x", 0.0)) / width
        safe_inset["y"] = float(safe_inset.get("y", 0.0)) / height

    edges = normalized.get("edges")
    if isinstance(edges, dict):
        for edge_name, edge in edges.items():
            if not isinstance(edge, dict):
                continue
            axis_length = width if edge_name in {"left", "right"} else height
            band_length = height if edge_name in {"left", "right"} else width
            for key in ("anchor", "weighted_trim"):
                if edge.get(key) is not None:
                    edge[key] = float(edge[key]) / axis_length
            values = edge.get("merged_candidates")
            if isinstance(values, list):
                edge["merged_candidates"] = [float(value) / axis_length for value in values]
            for key in ("global_candidates", "band_samples"):
                items = edge.get(key)
                if not isinstance(items, list):
                    continue
                for item in items:
                    if not isinstance(item, dict):
                        continue
                    if item.get("trim") is not None:
                        item["trim"] = float(item["trim"]) / axis_length
                    if item.get("band_start") is not None:
                        item["band_start"] = float(item["band_start"]) / band_length
                    if item.get("band_end") is not None:
                        item["band_end"] = float(item["band_end"]) / band_length
    normalized["image_width"] = width
    normalized["image_height"] = height
    return normalized


def _plugins_payload(query: dict) -> dict:
    hook = query.get("hook", [None])[0]
    service = _plugin_service()
    plugins = service.list_hooks_for(hook) if hook else service.list_plugins()
    return {
        "plugins": [asdict(plugin) for plugin in plugins],
        "hook": hook,
    }


def _ai_evaluators_payload(_query: dict) -> dict:
    return {
        "evaluators": _ai_evaluation_service().list_evaluators(),
    }


def _require_privacy_confirmation(body: dict, provider, privacy_confirmed: bool) -> None:
    """Raise ValueError if the provider could access the network and privacy isn't confirmed."""
    if privacy_confirmed:
        return
    # Mock providers never touch the network
    if provider is not None and isinstance(provider, MockProvider):
        return
    provider_name = str(body.get("provider", "")).strip().lower()
    if provider_name in ("mock", ""):
        return
    raise ValueError(
        "privacy_confirmed must be true when using a network provider. "
        "Set privacy_confirmed: true in the request body to acknowledge "
        "that image data and analysis may be sent to an external service."
    )


def _retry_evaluation(
    call_fn,
    retry_count: int,
    delay_ms: int,
    request_log: dict,
) -> object:
    """Call an evaluation function with retry on recoverable errors.

    Uses exponential backoff: delay * 2^attempt between retries.
    Does not retry ValueError (privacy gate) or KeyboardInterrupt.
    """
    last_error: Exception | None = None
    max_attempts = retry_count + 1  # total attempts = initial + retries
    for attempt in range(max_attempts):
        try:
            if attempt > 0:
                import time as _time
                wait = delay_ms * (2 ** (attempt - 1)) / 1000.0
                _time.sleep(wait)
                request_log["retry_attempt"] = attempt
            return call_fn()
        except (ValueError, KeyboardInterrupt):
            raise
        except Exception as exc:
            last_error = exc
            request_log[f"retry_{attempt}_error"] = str(exc)
    raise RuntimeError(
        f"Evaluation failed after {max_attempts} attempt(s): {last_error}"
    )



def _ai_evaluate_payload(body: dict) -> dict:
    if body.get("async"):
        return _start_ai_evaluation_job(body)
    return _ai_evaluate_payload_sync(body, record_session=bool(body.get("_record_session", True)))


def _ai_evaluate_payload_sync(body: dict, *, record_session: bool) -> dict:
    evaluator_name = str(body.get("evaluator_name", "__default__"))
    timeout_ms = max(0, int(body.get("timeout_ms", 0) or 0))
    timeout_seconds = timeout_ms / 1000.0 if timeout_ms > 0 else None
    allow_failure = bool(body.get("allow_failure", False))
    retry_count = max(0, int(body.get("retry_count", 0) or 0))
    retry_delay_ms = max(100, int(body.get("retry_delay_ms", 500) or 500))
    privacy_confirmed = bool(body.get("privacy_confirmed", False))
    mode = CalibrationMode(body.get("mode", CalibrationMode.GLOBAL.value))
    params = CalibrationParams(
        mode=mode,
        strength=float(body.get("strength", 0.8)),
        highlight_pct=float(body.get("highlight_pct", 55.0)),
        sat_pct=float(body.get("sat_pct", 25.0)),
    )
    context = str(body.get("context", ""))

    session_id = body.get("session_id")
    if session_id:
        entry = _get_analysis(session_id)
        if entry is None:
            raise ValueError("session_id is missing or expired")
    elif body.get("image_data"):
        entry = _prepare_uploaded_analysis(
            body["image_data"],
            file_name=str(body.get("file_name", "")),
            max_side=int(body.get("analysis_max_side", DEFAULT_ANALYSIS_MAX_SIDE)),
            raw_options=_raw_decode_options(body),
        )
    else:
        raise ValueError("AI evaluation requires session_id or image_data")

    provider = _provider_from_body(body)
    # Privacy gate: require explicit confirmation when using a network provider
    _require_privacy_confirmation(body, provider, privacy_confirmed)

    start = time.perf_counter()
    request_log = {
        "evaluator_name": evaluator_name,
        "timeout_ms": timeout_ms or None,
        "retry_count": retry_count,
        "retry_delay_ms": retry_delay_ms,
        "privacy_confirmed": privacy_confirmed,
        "used_session": bool(session_id),
        "context_length": len(context),
        "provider": _provider_summary(provider) if provider is not None else None,
        "status": "started",
    }
    try:
        result = calibrate_image_from_analysis(
            entry.prepared.image,
            params,
            entry.input_report,
            entry.zones,
            color_space=entry.prepared.color_space,
            data_range=entry.prepared.data_range,
        )
        eval_input = EvalInput(
            original=EvalImageRef(
                key=f"{entry.cache_key}:original",
                width=entry.prepared.analysis_width,
                height=entry.prepared.analysis_height,
                color_space=entry.prepared.color_space,
                source="original",
            ),
            calibrated=EvalImageRef(
                key=f"{entry.cache_key}:calibrated",
                width=entry.prepared.analysis_width,
                height=entry.prepared.analysis_height,
                color_space=entry.prepared.color_space,
                source="calibrated",
            ),
            analysis={
                "input": _report_payload(entry.input_report),
                "output": _report_payload(result.post_report),
                "zones": entry.zones,
            },
            calibration_params={
                "mode": params.mode.value,
                "strength": params.strength,
                "highlight_pct": params.highlight_pct,
                "sat_pct": params.sat_pct,
            },
            context=context,
        )
        def _call_provider() -> object:
            if provider is not None:
                return _ai_evaluation_service().evaluate_with_provider(
                    provider,
                    eval_input,
                    [entry.prepared.image, result.image],
                    timeout_seconds=timeout_seconds,
                )
            return _ai_evaluation_service().evaluate(
                evaluator_name,
                eval_input,
                [entry.prepared.image, result.image],
                timeout_seconds=timeout_seconds,
            )
        evaluation = _retry_evaluation(_call_provider, retry_count, retry_delay_ms, request_log)
    except Exception as exc:
        elapsed_ms = (time.perf_counter() - start) * 1000.0
        request_log.update(
            {
                "status": "error",
                "elapsed_ms": elapsed_ms,
                "error": str(exc),
            }
        )
        if record_session:
            _record_ai_request(entry, request_log)
        if not allow_failure:
            raise
        return {
            "ok": False,
            "session_id": entry.cache_key,
            "evaluator_name": evaluator_name,
            "error": str(exc),
            "request": request_log,
        }
    elapsed_ms = (time.perf_counter() - start) * 1000.0
    payload = {
        "ok": True,
        "session_id": entry.cache_key,
        "evaluator_name": evaluator_name,
        "evaluation": asdict(evaluation),
        "elapsed_ms": elapsed_ms,
        "request": {
            **request_log,
            "status": "ok",
            "elapsed_ms": elapsed_ms,
            "provider": _provider_summary(provider) if provider is not None else None,
        },
    }
    if record_session:
        _record_ai_evaluation(entry, evaluator_name, payload["evaluation"])
        _record_ai_request(entry, payload["request"])
    return payload


def _plugin_analyze_payload(body: dict) -> dict:
    session_id = body.get("session_id")
    if session_id:
        entry = _get_analysis(session_id)
        if entry is None:
            raise ValueError("session_id is missing or expired")
    elif body.get("image_data"):
        entry = _prepare_uploaded_analysis(
            body["image_data"],
            file_name=str(body.get("file_name", "")),
            max_side=int(body.get("analysis_max_side", DEFAULT_ANALYSIS_MAX_SIDE)),
            raw_options=_raw_decode_options(body),
        )
    else:
        raise ValueError("Plugin analysis requires session_id or image_data")

    analyzer_ids = body.get("analyzer_ids")
    if analyzer_ids is not None and not isinstance(analyzer_ids, list):
        raise ValueError("analyzer_ids must be a list of plugin ids")

    results = _plugin_service().run_analyzers(
        entry.prepared.image,
        analyzer_ids=analyzer_ids,
        analysis={
            "input": _report_payload(entry.input_report),
            "zones": entry.zones,
        },
        session_id=entry.cache_key,
    )
    return {
        "session_id": entry.cache_key,
        "results": [asdict(result) for result in results],
    }


# ---------------------------------------------------------------------------
# Async job tracking
# ---------------------------------------------------------------------------

_BATCH_STATUS: dict[str, dict] = {}
_BATCH_STATUS_LOCK = Lock()
_JOB_CANCEL_EVENTS: dict[str, Event] = {}


def _new_job_id(prefix: str) -> str:
    return f"{prefix}:{uuid4().hex[:12]}"


def _batch_or_job_id_from_query(query: dict) -> str:
    return query.get("job_id", query.get("batch_id", [""]))[0]


def _batch_or_job_id_from_body(body: dict) -> str:
    return str(body.get("job_id") or body.get("batch_id") or "")


def _job_status_snapshot(job_id: str) -> dict | None:
    with _BATCH_STATUS_LOCK:
        status = _BATCH_STATUS.get(job_id)
        if status is None:
            return None
        return deepcopy(_json_safe(status))


def _job_create(kind: str, *, total_items: int, workers: int = 1, metadata: dict | None = None) -> dict:
    job_id = _new_job_id(kind)
    now = time.time()
    status = {
        "job_id": job_id,
        "batch_id": job_id,
        "kind": kind,
        "state": "queued",
        "workers": int(workers),
        "total_items": int(total_items),
        "completed_items": 0,
        "failed_items": 0,
        "cancel_requested": False,
        "cancelled": False,
        "done": False,
        "created_at": now,
        "updated_at": now,
        "started_at": None,
        "finished_at": None,
        "results": [],
        "error": None,
        "metadata": deepcopy(metadata or {}),
    }
    with _BATCH_STATUS_LOCK:
        _BATCH_STATUS[job_id] = status
        _JOB_CANCEL_EVENTS[job_id] = Event()
    return deepcopy(status)


def _job_cancel_event(job_id: str) -> Event | None:
    with _BATCH_STATUS_LOCK:
        return _JOB_CANCEL_EVENTS.get(job_id)


def _job_mark_running(job_id: str) -> None:
    with _BATCH_STATUS_LOCK:
        status = _BATCH_STATUS.get(job_id)
        if status is None:
            return
        status["state"] = "running"
        status["started_at"] = status["started_at"] or time.time()
        status["updated_at"] = time.time()


def _job_append_result(job_id: str, result: dict, *, failed: bool = False) -> None:
    with _BATCH_STATUS_LOCK:
        status = _BATCH_STATUS.get(job_id)
        if status is None:
            return
        status["results"].append(deepcopy(_json_safe(result)))
        status["completed_items"] += 1
        if failed:
            status["failed_items"] += 1
        status["updated_at"] = time.time()


def _job_request_cancel(job_id: str) -> bool:
    with _BATCH_STATUS_LOCK:
        status = _BATCH_STATUS.get(job_id)
        event = _JOB_CANCEL_EVENTS.get(job_id)
        if status is None or event is None:
            return False
        status["cancel_requested"] = True
        if status["state"] == "queued":
            status["state"] = "cancelling"
        status["updated_at"] = time.time()
        event.set()
        return True


def _job_finish(job_id: str, *, state: str, error: str | None = None) -> None:
    with _BATCH_STATUS_LOCK:
        status = _BATCH_STATUS.get(job_id)
        if status is None:
            return
        status["state"] = state
        status["cancelled"] = state == "cancelled"
        status["done"] = True
        status["error"] = error
        status["finished_at"] = time.time()
        status["updated_at"] = status["finished_at"]


def _run_async_batch_job(
    job_id: str,
    items: list,
    *,
    workers: int,
    run_one,
    cancel_result,
) -> None:
    cancel_event = _job_cancel_event(job_id)
    if cancel_event is None:
        return
    _job_mark_running(job_id)
    pending: dict = {}
    next_index = 0
    completed = 0
    try:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            while next_index < len(items) and len(pending) < workers and not cancel_event.is_set():
                future = pool.submit(run_one, next_index, items[next_index], cancel_event)
                pending[future] = next_index
                next_index += 1

            while pending:
                for future in as_completed(list(pending.keys())):
                    index = pending.pop(future)
                    try:
                        result = future.result()
                        failed = bool(result.get("error"))
                    except Exception as exc:
                        result = cancel_result(index, items[index], str(exc))
                        failed = True
                    _job_append_result(job_id, result, failed=failed)
                    completed += 1
                    if cancel_event.is_set():
                        break
                    while next_index < len(items) and len(pending) < workers and not cancel_event.is_set():
                        future2 = pool.submit(run_one, next_index, items[next_index], cancel_event)
                        pending[future2] = next_index
                        next_index += 1
                if cancel_event.is_set():
                    break

        if cancel_event.is_set():
            for index in range(next_index, len(items)):
                _job_append_result(job_id, cancel_result(index, items[index], "cancelled"))
                completed += 1
            _job_finish(job_id, state="cancelled")
            return
        _job_finish(job_id, state="completed")
    except Exception as exc:
        _job_finish(job_id, state="failed", error=str(exc))


def _start_paths_batch_job(body: dict) -> dict:
    paths = [str(path) for path in body.get("paths", [])]
    if not paths:
        raise ValueError("paths must contain at least one image path")
    max_side = int(body.get("analysis_max_side", DEFAULT_ANALYSIS_MAX_SIDE))
    workers = max(1, min(int(body.get("workers", BATCH_WORKERS)), BATCH_WORKERS, len(paths)))
    job = _job_create("calibrate-paths", total_items=len(paths), workers=workers)

    def run_one(index: int, path: str, cancel_event: Event) -> dict:
        if cancel_event.is_set():
            return {"path": path, "cancelled": True}
        start = time.perf_counter()
        entry = _prepare_file_analysis(
            path,
            max_side=max_side,
            reader_plugin=_plugin_reader_id(body),
        )
        if cancel_event.is_set():
            return {"path": path, "cancelled": True}
        return _calibrate_entry_payload(entry, body | {"path": path}, start)

    def cancel_result(index: int, path: str, error: str) -> dict:
        return {"path": path, "cancelled": True, "error": error}

    _JOB_EXECUTOR.submit(
        _run_async_batch_job,
        job["job_id"],
        paths,
        workers=workers,
        run_one=run_one,
        cancel_result=cancel_result,
    )
    return _job_status_snapshot(job["job_id"]) or {"error": "unknown job_id"}


def _start_upload_batch_job(body: dict) -> dict:
    items = list(body.get("items", []))
    if not items:
        raise ValueError("items must contain at least one uploaded image")
    max_side = int(body.get("analysis_max_side", DEFAULT_ANALYSIS_MAX_SIDE))
    workers = max(1, min(int(body.get("workers", BATCH_WORKERS)), BATCH_WORKERS, len(items)))
    job = _job_create("calibrate-batch", total_items=len(items), workers=workers)

    def run_one(index: int, item: dict, cancel_event: Event) -> dict:
        file_name = str(item.get("file_name", f"upload-{index}"))
        if cancel_event.is_set():
            return {"file_name": file_name, "cancelled": True}
        start = time.perf_counter()
        entry = _prepare_uploaded_analysis(
            item["image_data"],
            file_name=file_name,
            max_side=max_side,
            reader_plugin=_plugin_reader_id(body | item),
        )
        if cancel_event.is_set():
            return {"file_name": file_name, "cancelled": True}
        request_body = body | item
        request_body.pop("items", None)
        return _calibrate_entry_payload(entry, request_body, start)

    def cancel_result(index: int, item: dict, error: str) -> dict:
        return {
            "file_name": str(item.get("file_name", f"upload-{index}")),
            "cancelled": True,
            "error": error,
        }

    _JOB_EXECUTOR.submit(
        _run_async_batch_job,
        job["job_id"],
        items,
        workers=workers,
        run_one=run_one,
        cancel_result=cancel_result,
    )
    return _job_status_snapshot(job["job_id"]) or {"error": "unknown job_id"}


def _start_ai_evaluation_job(body: dict) -> dict:
    job = _job_create("ai-evaluate", total_items=1, workers=1)

    def runner() -> None:
        cancel_event = _job_cancel_event(job["job_id"])
        if cancel_event is None:
            return
        _job_mark_running(job["job_id"])
        try:
            if cancel_event.is_set():
                _job_append_result(job["job_id"], {"cancelled": True})
                _job_finish(job["job_id"], state="cancelled")
                return
            payload = _ai_evaluate_payload_sync(body, record_session=False)
            if cancel_event.is_set():
                _job_append_result(job["job_id"], {"cancelled": True})
                _job_finish(job["job_id"], state="cancelled")
                return
            entry = _get_analysis(payload["session_id"])
            if entry is not None:
                _record_ai_evaluation(entry, payload["evaluator_name"], payload["evaluation"])
                _record_ai_request(entry, payload["request"])
            _job_append_result(job["job_id"], payload, failed=not payload.get("ok", True))
            _job_finish(job["job_id"], state="completed" if payload.get("ok", True) else "failed", error=payload.get("error"))
        except Exception as exc:
            if cancel_event.is_set():
                _job_append_result(job["job_id"], {"cancelled": True, "error": str(exc)})
                _job_finish(job["job_id"], state="cancelled")
            else:
                _job_finish(job["job_id"], state="failed", error=str(exc))

    _JOB_EXECUTOR.submit(runner)
    return _job_status_snapshot(job["job_id"]) or {"error": "unknown job_id"}


def _batch_status_payload(query: dict) -> dict:
    batch_id = _batch_or_job_id_from_query(query)
    status = _job_status_snapshot(batch_id)
    if status is None:
        return {"error": "unknown batch_id"}
    return status


def _batch_cancel_payload(body: dict) -> dict:
    batch_id = _batch_or_job_id_from_body(body)
    cancelled = _job_request_cancel(batch_id)
    return {"ok": True, "batch_id": batch_id, "job_id": batch_id, "cancel_requested": cancelled}


# ---------------------------------------------------------------------------
# Named handler functions for route dispatch (module-level)
# ---------------------------------------------------------------------------


def _handle_analyze(body: dict) -> dict:
    report = analyze_image_array(_decode_data_url(body["image_data"]))
    return {"input": _report_payload(report)}


def _get_capabilities_route(query: dict) -> dict:
    if "backend" in query:
        accelerator = _set_accelerator_payload(query["backend"][0])
    else:
        accelerator = _accelerator_payload()
    return {
        "accelerator": accelerator,
        "interfaces": {
            "http": True,
            "fastapi": True,
            "ipc_stdio": True,
        },
        "persistence": {
            "preview_cache_dir": str(PREVIEW_CACHE_DIR),
            "session_store_dir": str(SESSION_STORE_DIR),
            "preview_cache_exists": PREVIEW_CACHE_DIR.exists(),
            "session_store_exists": SESSION_STORE_DIR.exists(),
        },
    }


def _get_benchmark_route(query: dict) -> dict:
    if "backend" in query:
        _set_accelerator_payload(query["backend"][0])
    return {"benchmark": _accelerator_benchmark_payload(
        image_side=int(query.get("image_side", ["256"])[0]),
        lut_size=int(query.get("lut_size", ["17"])[0]),
        iterations=int(query.get("iterations", ["3"])[0]),
    )}


# ---------------------------------------------------------------------------
# Route dispatch tables


def _history_save_payload(body: dict) -> dict:
    session_id = str(body.get("session_id", ""))
    description = str(body.get("description", "calibration"))
    action_type = str(body.get("action_type", "calibration"))
    params = body.get("params")
    if not session_id:
        return {"ok": False, "error": "session_id required"}
    db = get_workspace_db(ROOT)
    row_id = db.save_action(session_id, description, action_type, params)
    return {"ok": True, "id": row_id}


def _history_commit_payload(body: dict) -> dict:
    root, db = _workspace_db_from_body(body)
    source_path = str(Path(str(body.get("source_path", ""))).expanduser().resolve())
    session_id = str(body.get("persistent_session_id") or body.get("session_id") or "")
    if not source_path or not session_id:
        raise ValueError("source_path and persistent_session_id required")
    before_state = body.get("before_state")
    after_state = body.get("after_state")
    if not isinstance(before_state, dict) or not isinstance(after_state, dict):
        raise ValueError("before_state and after_state must be objects")
    preview_blob, preview_mime = _preview_blob_from_url(body.get("calibrated_image"))
    sequence, cursor = db.commit_action(
        session_id=session_id,
        source_path=source_path,
        description=str(body.get("description", "编辑")),
        action_type=str(body.get("action_type", "calibration")),
        before_state=before_state,
        after_state=after_state,
        document=body.get("document") if isinstance(body.get("document"), dict) else None,
        preview_blob=preview_blob,
        preview_mime=preview_mime,
    )
    history_entries = _history_entries_payload(db, session_id)
    return {
        "ok": True,
        "workspace_root": str(root),
        "persistent_session_id": session_id,
        "sequence_no": sequence,
        "history_cursor": _history_cursor_index(history_entries, cursor),
        "history": history_entries,
    }


def _history_move_payload(body: dict, direction: int) -> dict:
    _root, db = _workspace_db_from_body(body)
    session_id = str(body.get("persistent_session_id") or body.get("session_id") or "")
    if not session_id:
        raise ValueError("persistent_session_id required")
    moved = db.move_history_cursor(session_id, direction)
    if moved is None:
        return {"ok": False, "persistent_session_id": session_id, "history": _history_entries_payload(db, session_id)}
    cursor, state, preview_blob, preview_mime = moved
    session = db.load_session(session_id)
    history_entries = _history_entries_payload(db, session_id)
    return {
        "ok": True,
        "persistent_session_id": session_id,
        "history_cursor": _history_cursor_index(history_entries, cursor),
        "state": state,
        "calibrated_image": _preview_data_url(preview_blob, preview_mime),
        "history": history_entries,
    }


def _history_load_payload(body: dict) -> dict:
    session_id = str(body.get("session_id", ""))
    if not session_id:
        return {"ok": False, "error": "session_id required", "entries": []}
    root_value = body.get("workspace_root")
    db = get_workspace_db(Path(str(root_value))) if root_value else get_workspace_db(ROOT)
    session = db.load_session(session_id)
    history_entries = _history_entries_payload(db, session_id)
    return {
        "ok": True,
        "entries": history_entries,
        "history_cursor": _history_cursor_index(history_entries, session.history_cursor) if session else -1,
    }


def _record_action_history(session_id: str, payload: dict) -> None:
    mode = str(payload.get("mode", "global"))
    shift = payload.get("shift", {})
    description = f"mode: {mode}"
    if isinstance(shift, dict):
        a = shift.get("a")
        b = shift.get("b")
        if a is not None and b is not None:
            description = f"mode: {mode}  a:{a:.1f} b:{b:.1f}"
    try:
        db = get_workspace_db(ROOT)
        db.save_action(session_id, description, "calibration", {"mode": mode})
    except Exception:
        pass


# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# User config endpoints
# ---------------------------------------------------------------------------

def _config_get_payload(_query: dict) -> dict:
    return load_config()


def _config_put_payload(body: dict) -> dict:
    config = load_config()
    if "ai" in body:
        config["ai"].update(body["ai"])
    if "preferences" in body:
        config["preferences"] = body["preferences"]
    if "viewer_state" in body:
        config["viewer_state"] = body["viewer_state"]
    if "inspector_tab" in body:
        config["inspector_tab"] = body["inspector_tab"]
    _save_config_to_file(config)
    return {"ok": True}


# ---------------------------------------------------------------------------

_POST_ROUTES: dict[str, "Callable[[dict], dict]"] = {
    "/api/analyze": _handle_analyze,
    "/api/ai-evaluate": _ai_evaluate_payload,
    "/api/calibrate": _calibrate_payload,
    "/api/calibrate-session": _calibrate_session_payload,
    "/api/preview": _preview_payload,
    "/api/preview-batch": _preview_batch_payload,
    "/api/calibrate-batch": _calibrate_batch_payload,
    "/api/calibrate-path": _calibrate_path_payload,
    "/api/calibrate-paths": _calibrate_paths_payload,
    "/api/film-scan": _film_scan_payload,
    "/api/export": _export_payload,
    "/api/export-path": _export_path_payload,
    "/api/cache/clear": lambda _body: _cache_clear_payload(),
    "/api/cache/cleanup": _preview_cache_cleanup_payload,
    "/api/plugin-analyze": _plugin_analyze_payload,
    "/api/sidecar/save": _sidecar_save_payload,
    "/api/session/save": _session_save_payload,
    "/api/session/cleanup": _session_cleanup_payload,
    "/api/session/delete": _session_delete_payload,
    "/api/document": _document_payload,
    "/api/document/render": _document_render_payload,
    "/api/batch/cancel": _batch_cancel_payload,
    "/api/workspace/sync": _workspace_sync_payload,
    "/api/workspace/open": _workspace_open_payload,
    "/api/workspace/clear": lambda _body: _workspace_clear_payload(),
    "/api/history/save": _history_save_payload,
    "/api/history/commit": _history_commit_payload,
    "/api/history/undo": lambda body: _history_move_payload(body, -1),
    "/api/history/redo": lambda body: _history_move_payload(body, 1),
    "/api/config": _config_put_payload,
}

_GET_ROUTES: dict[str, "Callable[[dict], dict]"] = {
    "/api/ai-evaluators": _ai_evaluators_payload,
    "/api/health": lambda _query: {"ok": True},
    "/api/capabilities": _get_capabilities_route,
    "/api/plugins": _plugins_payload,
    "/api/accelerator-benchmark": _get_benchmark_route,
    "/api/cache/stats": lambda _query: _cache_stats_payload(),
    "/api/sidecar/load": lambda query: _sidecar_load_payload({"path": query["path"][0]}),
    "/api/session/load": lambda query: _session_load_payload({"path": query["path"][0], "new_session_id": query.get("new_session_id", [None])[0]}),
    "/api/session/list": _session_list_payload,
    "/api/batch/status": _batch_status_payload,
    "/api/workspace/stats": lambda _query: _workspace_stats_payload(),
    "/api/history/load": lambda query: _history_load_payload({
        "session_id": query.get("session_id", [""])[0],
        "workspace_root": query.get("workspace_root", [None])[0],
    }),
    "/api/config": _config_get_payload,
}


def dispatch_backend_request(method: str, path: str, payload: dict | None = None) -> dict:
    normalized_method = method.upper()
    body = payload or {}
    if normalized_method == "POST":
        handler = _POST_ROUTES.get(path)
        if handler is None:
            raise KeyError(f"Unknown POST route: {path}")
        return handler(body)
    if normalized_method == "GET":
        handler = _GET_ROUTES.get(path)
        if handler is None:
            raise KeyError(f"Unknown GET route: {path}")
        query = {
            key: value if isinstance(value, list) else [value]
            for key, value in body.items()
        }
        return handler(query)
    raise ValueError(f"Unsupported method: {method}")


class Handler(BaseHTTPRequestHandler):
    server_version = "PhotoCalibratorUI/0.1"

    def log_message(self, fmt: str, *args) -> None:
        return

    def _send_json(self, payload: dict, status: int = 200) -> None:
        raw = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(raw)

    def _send_file(self, path: Path) -> None:
        if not path.exists() or not path.is_file():
            self.send_error(404)
            return
        content = path.read_bytes()
        mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(content)

    def _send_cors(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "86400")
        self.end_headers()

    def do_OPTIONS(self) -> None:
        self._send_cors()

    def do_POST(self) -> None:
        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception as exc:
            self._send_json({"error": str(exc)}, status=400)
            return
        handler = _POST_ROUTES.get(self.path)
        if handler is None:
            self.send_error(404)
            return
        try:
            self._send_json(handler(body))
        except Exception as exc:
            self._send_json({"error": str(exc)}, status=400)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/preview-image/"):
            name = parsed.path.split("/api/preview-image/", 1)[1]
            candidate = (PREVIEW_CACHE_DIR / name).resolve()
            if not str(candidate).startswith(str(PREVIEW_CACHE_DIR.resolve())):
                self.send_error(403)
                return
            if not candidate.exists() or not candidate.is_file():
                self.send_error(404)
                return
            self._send_file(candidate)
            return
        if parsed.path in _GET_ROUTES:
            query = parse_qs(parsed.query)
            try:
                self._send_json(dispatch_backend_request("GET", parsed.path, query))
                return
            except KeyError:
                self.send_error(404)
                return
        rel = "index.html" if parsed.path in {"/", ""} else parsed.path.lstrip("/")
        candidate = (WEB_ROOT / rel).resolve()
        if not str(candidate).startswith(str(WEB_ROOT.resolve())):
            self.send_error(403)
            return
        if not candidate.exists() or not candidate.is_file():
            candidate = (WEB_ROOT / "index.html").resolve()
        self._send_file(candidate)


def run(host: str = "127.0.0.1", port: int = 8765, accelerator: str = "auto") -> None:
    global _BASE_URL
    _BASE_URL = f"http://{host}:{port}"
    deferred_auto = accelerator == "auto" and bool(getattr(ACCELERATOR, "deferred_auto", False))
    if not deferred_auto:
        _set_accelerator_payload(accelerator)
    _startup_workspace_sync()
    # Clean up stale preview cache files older than 24h
    if PREVIEW_CACHE_DIR.exists():
        cutoff = time.time() - 86400
        for f in PREVIEW_CACHE_DIR.iterdir():
            try:
                if f.is_file() and f.stat().st_mtime < cutoff:
                    f.unlink()
            except OSError:
                pass
    httpd = ThreadingHTTPServer((host, port), Handler)
    print(f"Photo Calibrator UI: http://{host}:{port} ({_accelerator_payload()['active_backend']})")
    if deferred_auto:
        def initialize_accelerator() -> None:
            time.sleep(1.0)
            payload = _set_accelerator_payload("auto")
            print(f"Accelerator ready: {payload['active_backend']}")

        Thread(target=initialize_accelerator, name="accelerator-init", daemon=True).start()
    httpd.serve_forever()


def _startup_workspace_sync() -> None:
    """Sync file inventory on startup to invalidate stale cache entries."""
    try:
        db = get_workspace_db(ROOT)
        stats = db.stats()
        print(
            f"Workspace DB: {stats['preview_count']} previews, "
            f"{stats['session_count']} sessions, "
            f"{stats['inventory_count']} tracked files"
        )
    except Exception as exc:
        print(f"Workspace DB init warning: {exc}")


def main() -> None:
    global WEB_ROOT
    parser = argparse.ArgumentParser(description="Run the lightweight Photo Calibrator web UI")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument(
        "--accelerator",
        default="auto",
        choices=["auto", "cpu-opencv", "opencl", "opencl-umat", "torch", "torch-cuda", "torch-mps", "metal", "metal-mps"],
    )
    parser.add_argument("--web-root", default=None, help="Static file root directory (default: frontend/dist/ if built, else web/)")
    args = parser.parse_args()
    if args.web_root:
        WEB_ROOT = (ROOT / args.web_root).resolve()
        if not WEB_ROOT.is_dir():
            sys.exit(f"web-root directory not found: {WEB_ROOT}")
    run(args.host, args.port, args.accelerator)


if __name__ == "__main__":
    main()
