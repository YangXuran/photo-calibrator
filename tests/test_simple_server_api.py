from __future__ import annotations

import base64
import json
import os
import sys
import threading
import tempfile
import time
import types
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from http.server import ThreadingHTTPServer
from urllib.request import Request, urlopen

import cv2
import numpy as np
import pytest

from photo_calibrator.backend.simple_server import Handler
from photo_calibrator.backend.simple_server import (
    _ai_evaluate_payload,
    _ai_evaluators_payload,
    _accelerator_payload,
    _accelerator_benchmark_payload,
    _document_payload,
    _document_render_payload,
    _set_accelerator_payload,
    _calibrate_batch_payload,
    _calibrate_payload,
    _calibrate_path_payload,
    _calibrate_paths_payload,
    _calibrate_session_payload,
    _decode_data_url,
    _export_payload,
    _film_scan_payload,
    _plugins_payload,
    _plugin_analyze_payload,
    _preview_payload,
    _prepare_file_for_analysis,
    _prepare_uploaded_image,
    _session_load_payload,
    _session_save_payload,
    _workspace_open_payload,
    _history_commit_payload,
    _history_move_payload,
)


BACKEND_NAMES = {"cpu-opencv", "opencl-umat", "torch-cuda", "torch-mps", "hybrid-opencl-cuda", "hybrid-opencl-mps"}


def assert_preview_url(value: str) -> None:
    assert value.startswith("http://127.0.0.1:")
    assert "/api/preview-image/" in value


def sample_data_url() -> str:
    img = np.zeros((48, 48, 3), dtype=np.uint8)
    img[:, :] = (120, 130, 160)
    img[8:40, 8:40] = (178, 132, 104)
    ok, encoded = cv2.imencode(".png", cv2.cvtColor(img, cv2.COLOR_RGB2BGR))
    assert ok
    payload = base64.b64encode(encoded.tobytes()).decode("ascii")
    return f"data:image/png;base64,{payload}"


def sample_data_url_size(width: int, height: int) -> str:
    img = np.zeros((height, width, 3), dtype=np.uint8)
    img[:, :] = (120, 130, 160)
    img[max(1, height // 4) : max(2, (height * 3) // 4), max(1, width // 4) : max(2, (width * 3) // 4)] = (178, 132, 104)
    ok, encoded = cv2.imencode(".png", cv2.cvtColor(img, cv2.COLOR_RGB2BGR))
    assert ok
    payload = base64.b64encode(encoded.tobytes()).decode("ascii")
    return f"data:image/png;base64,{payload}"


def sample_tiff_data_url() -> str:
    img = np.zeros((48, 48, 3), dtype=np.uint16)
    img[:, :] = (24000, 28000, 36000)
    ok, encoded = cv2.imencode(".tiff", img)
    assert ok
    payload = base64.b64encode(encoded.tobytes()).decode("ascii")
    return f"data:image/tiff;base64,{payload}"


def sample_film_data_url() -> str:
    img = np.full((240, 360, 3), 245, dtype=np.uint8)
    cv2.rectangle(img, (40, 30), (320, 210), (15, 15, 15), thickness=10)
    cv2.rectangle(img, (55, 45), (305, 195), (150, 120, 90), thickness=-1)
    ok, encoded = cv2.imencode(".png", cv2.cvtColor(img, cv2.COLOR_RGB2BGR))
    assert ok
    payload = base64.b64encode(encoded.tobytes()).decode("ascii")
    return f"data:image/png;base64,{payload}"


def large_tiff_data_url() -> str:
    img = np.zeros((320, 640, 3), dtype=np.uint16)
    img[:, :] = (24000, 28000, 36000)
    ok, encoded = cv2.imencode(".tiff", img)
    assert ok
    payload = base64.b64encode(encoded.tobytes()).decode("ascii")
    return f"data:image/tiff;base64,{payload}"


def multipage_tiff_data_url() -> str:
    full = np.zeros((640, 960, 3), dtype=np.uint8)
    full[:, :] = (80, 90, 120)
    preview = np.zeros((180, 270, 3), dtype=np.uint8)
    preview[:, :] = (82, 92, 122)
    ok, encoded = cv2.imencodemulti(".tiff", [full, preview])
    assert ok
    payload = base64.b64encode(encoded.tobytes()).decode("ascii")
    return f"data:image/tiff;base64,{payload}"


def test_decode_data_url_roundtrip_shape() -> None:
    decoded = _decode_data_url(sample_data_url())
    assert decoded.shape == (48, 48, 3)
    assert decoded.dtype == np.uint8


def test_calibrate_payload_returns_metrics_and_preview_image() -> None:
    payload = _calibrate_payload(
        {
            "image_data": sample_data_url(),
            "mode": "global",
            "strength": 0.8,
        }
    )

    assert_preview_url(payload["calibrated_image"])
    assert_preview_url(payload["original_preview"])
    assert payload["input"]["lab"]["strength"] >= payload["output"]["lab"]["strength"]
    assert "global" in payload["input"]["zones"]
    assert payload["charts"]["rgb_histogram"]["bins"] == 256
    assert "ccc" in payload["charts"]
    assert "d_sigma" in payload["charts"]["ccc"]
    assert "pci" in payload["charts"]
    assert "neutral_mask" in payload["charts"]
    assert "lab_vectors" in payload["charts"]
    assert payload["input"]["skin"] is not None
    assert any(v["name"] == "Skin" for v in payload["charts"]["lab_vectors"])
    assert "processing" in payload
    assert "opencv_threads" in payload["processing"]
    assert "session_id" in payload
    assert payload["document"]["operations"][-1]["name"] == "calibration"
    assert payload["processing"]["accelerator_backend"] in BACKEND_NAMES


def test_calibrate_payload_supports_plugin_calibrator() -> None:
    payload = _calibrate_payload(
        {
            "image_data": sample_data_url(),
            "file_name": "plugin-calibrate.png",
            "mode": "global",
            "strength": 0.8,
            "calibrator_plugin": "builtin.noopcalibrator",
        }
    )

    assert payload["processing"]["calibration_source"] == "plugin"
    assert payload["processing"]["calibration_plugin_id"] == "builtin.noopcalibrator"
    assert payload["shift"]["a"] is None
    assert payload["shift"]["b"] is None


def test_preview_payload_returns_session_and_preview_image() -> None:
    payload = _preview_payload(
        {
            "image_data": sample_tiff_data_url(),
            "file_name": "thumb.tif",
            "analysis_max_side": 240,
        }
    )

    assert payload["session_id"]
    assert_preview_url(payload["original_preview"])
    assert payload["processing"]["analysis_width"] <= 240
    assert payload["processing"]["preview_source"]


def test_calibrate_session_reuses_cached_input_analysis() -> None:
    payload = _calibrate_payload(
        {
            "image_data": sample_data_url(),
            "file_name": "sample.png",
            "mode": "global",
            "strength": 0.5,
        }
    )

    session_payload = _calibrate_session_payload(
        {
            "session_id": payload["session_id"],
            "mode": "rgb-curves",
            "strength": 0.9,
            "include_original": False,
        }
    )

    assert session_payload["session_id"] == payload["session_id"]
    assert session_payload["input"] == payload["input"]
    assert session_payload["mode"] == "rgb-curves"
    assert session_payload["original_preview"] is None
    assert session_payload["processing"]["memory_cache_items"] >= 1


def test_plugins_payload_lists_builtin_plugins() -> None:
    payload = _plugins_payload({})
    ids = {item["id"] for item in payload["plugins"]}
    assert "builtin.noopanalyzer" in ids
    assert "builtin.noopaievaluator" in ids


def test_plugins_payload_filters_by_hook() -> None:
    payload = _plugins_payload({"hook": ["ai_evaluator"]})
    assert payload["hook"] == "ai_evaluator"
    assert len(payload["plugins"]) >= 1
    assert all("ai_evaluator" in item["hooks"] for item in payload["plugins"])


def test_ai_evaluators_payload_lists_plugin_and_native() -> None:
    payload = _ai_evaluators_payload({})
    ids = {item["id"] for item in payload["evaluators"]}
    assert "builtin.noopaievaluator" in ids
    assert "__default__" in ids


def test_ai_evaluate_payload_supports_default_provider() -> None:
    payload = _ai_evaluate_payload(
        {
            "image_data": sample_data_url(),
            "file_name": "eval.png",
            "context": "portrait",
            "mode": "global",
            "strength": 0.8,
        }
    )

    assert payload["session_id"]
    assert payload["evaluator_name"] == "__default__"
    assert payload["ok"] is True
    assert payload["evaluation"]["overall_score"] >= 0.0
    assert payload["evaluation"]["metadata"]["source"] == "native"
    assert payload["request"]["status"] == "ok"


def test_ai_evaluate_payload_supports_plugin_evaluator() -> None:
    payload = _ai_evaluate_payload(
        {
            "image_data": sample_data_url(),
            "file_name": "eval-plugin.png",
            "evaluator_name": "builtin.noopaievaluator",
            "context": "keep film look",
            "mode": "film",
            "strength": 0.65,
        }
    )

    assert payload["evaluation"]["metadata"]["source"] == "plugin"
    assert payload["evaluation"]["metadata"]["context"] == "keep film look"
    assert payload["evaluation"]["metadata"]["has_calibration_params"] is True


def test_ai_evaluate_payload_supports_provider_config_mock() -> None:
    payload = _ai_evaluate_payload(
        {
            "image_data": sample_data_url(),
            "file_name": "eval-provider.png",
            "provider": {
                "type": "mock",
                "score": 0.91,
                "reasoning": "configured mock",
            },
            "timeout_ms": 250,
        }
    )

    assert payload["ok"] is True
    assert payload["evaluation"]["overall_score"] == pytest.approx(0.91)
    assert payload["request"]["provider"]["type"] == "mock"
    assert payload["request"]["timeout_ms"] == 250


def test_ai_evaluate_payload_soft_failure_logs_request_and_skips_session_eval(monkeypatch) -> None:
    from photo_calibrator.backend import simple_server

    class FailingAIService:
        def evaluate(self, *args, **kwargs):
            raise RuntimeError("boom")

    monkeypatch.setattr(simple_server, "_AI_EVALUATION_SERVICE", FailingAIService())
    payload = simple_server._ai_evaluate_payload(
        {
            "image_data": sample_data_url(),
            "file_name": "eval-fail.png",
            "allow_failure": True,
        }
    )

    assert payload["ok"] is False
    assert "boom" in payload["error"]
    assert payload["request"]["status"] == "error"
    entry = simple_server._get_analysis(payload["session_id"])
    assert entry is not None
    session_meta = simple_server._session_metadata(entry)
    assert "__default__" not in session_meta.get("ai_evaluations", {})
    assert session_meta["ai_requests"][-1]["status"] == "error"


def test_ai_evaluate_payload_passes_color_space_context(monkeypatch) -> None:
    from photo_calibrator.backend import simple_server
    from photo_calibrator.backend.schemas import AnalysisEntry, PreparedImage

    captured: dict[str, object] = {}
    preview = np.full((16, 16, 3), 0.5, dtype=np.float32)
    prepared = PreparedImage(
        image=preview,
        original_width=16,
        original_height=16,
        analysis_width=16,
        analysis_height=16,
        downsample_ratio=1.0,
        source_dtype="float32",
        preview_source="io-imageio",
        color_space="Linear",
        data_range=(0.0, 1.5),
    )
    entry = AnalysisEntry(
        prepared=prepared,
        input_report=simple_server.analyze_image_array(preview),
        zones=simple_server.auto_detect_cast(preview),
        static_charts=simple_server._static_chart_payload(simple_server.analyze_image_array(preview), np.full((16, 16, 3), 128, dtype=np.uint8)),
        cache_key="linear-eval:test",
        created_at=0.0,
    )

    def fake_calibrate_image_from_analysis(image, params, pre_report, zones, **kwargs):
        captured.update(kwargs)
        return simple_server.calibrate_image(
            image,
            params,
            color_space=str(kwargs.get("color_space", "sRGB")),
            data_range=kwargs.get("data_range"),
        )

    monkeypatch.setattr(simple_server, "_prepare_uploaded_analysis", lambda *args, **kwargs: entry)
    monkeypatch.setattr(simple_server, "calibrate_image_from_analysis", fake_calibrate_image_from_analysis)

    payload = simple_server._ai_evaluate_payload(
        {
            "image_data": sample_data_url(),
            "file_name": "linear-eval.exr",
            "context": "linear preview",
            "mode": "global",
            "strength": 0.8,
        }
    )

    assert payload["evaluation"]["overall_score"] >= 0.0
    assert captured["color_space"] == "Linear"
    assert captured["data_range"] == (0.0, 1.5)


# ---------------------------------------------------------------------------
# AI evaluation hardening: privacy_confirmed gate
# ---------------------------------------------------------------------------

def test_privacy_gate_rejects_network_provider_without_confirmation() -> None:
    """privacy_confirmed=false + OpenAICompatible provider -> ValueError."""
    from photo_calibrator.ai.providers import OpenAICompatibleProvider, ProviderConfig
    from photo_calibrator.backend.simple_server import _require_privacy_confirmation

    provider = OpenAICompatibleProvider(
        ProviderConfig(base_url="https://api.example.com/v1", model="gpt-fake", api_key="sk-test")
    )
    with pytest.raises(ValueError, match="privacy_confirmed"):
        _require_privacy_confirmation(
            {"provider": {"type": "openai_compatible", "base_url": "https://api.example.com/v1", "model": "gpt-fake"}},
            provider,
            privacy_confirmed=False,
        )


def test_privacy_gate_allows_network_provider_with_confirmation() -> None:
    """privacy_confirmed=true with any provider passes silently."""
    from photo_calibrator.ai.providers import OpenAICompatibleProvider, ProviderConfig
    from photo_calibrator.backend.simple_server import _require_privacy_confirmation

    provider = OpenAICompatibleProvider(
        ProviderConfig(base_url="https://api.example.com/v1", model="gpt-fake", api_key="sk-test")
    )
    _require_privacy_confirmation(
        {"provider": {"type": "openai_compatible", "base_url": "https://api.example.com/v1", "model": "gpt-fake"}},
        provider,
        privacy_confirmed=True,
    )


def test_privacy_gate_allows_mock_provider_without_confirmation() -> None:
    """MockProvider passes the privacy gate even with privacy_confirmed=False."""
    from photo_calibrator.ai.providers import MockProvider
    from photo_calibrator.backend.simple_server import _require_privacy_confirmation

    provider = MockProvider()
    _require_privacy_confirmation(
        {"provider": {"type": "mock"}},
        provider,
        privacy_confirmed=False,
    )


def test_privacy_gate_allows_none_provider() -> None:
    """provider=None always passes the privacy gate."""
    from photo_calibrator.backend.simple_server import _require_privacy_confirmation

    _require_privacy_confirmation({}, None, privacy_confirmed=False)


# ---------------------------------------------------------------------------
# AI evaluation hardening: retry / backoff
# ---------------------------------------------------------------------------

def test_retry_evaluation_succeeds_first_try() -> None:
    from photo_calibrator.backend.simple_server import _retry_evaluation

    def succeed():
        return {"ok": True}

    result = _retry_evaluation(succeed, retry_count=2, delay_ms=10, request_log={})
    assert result == {"ok": True}


def test_retry_evaluation_retries_until_success() -> None:
    from photo_calibrator.backend.simple_server import _retry_evaluation

    attempts = []

    def fail_twice_then_succeed():
        attempts.append(1)
        if len(attempts) < 3:
            raise RuntimeError(f"attempt {len(attempts)}")
        return {"recovered": True}

    request_log: dict = {}
    result = _retry_evaluation(fail_twice_then_succeed, retry_count=3, delay_ms=1, request_log=request_log)
    assert result == {"recovered": True}
    assert len(attempts) == 3
    assert "retry_attempt" in request_log


def test_retry_evaluation_exhausted_raises() -> None:
    from photo_calibrator.backend.simple_server import _retry_evaluation

    def always_fail():
        raise RuntimeError("unrecoverable")

    request_log: dict = {}
    with pytest.raises(RuntimeError, match="Evaluation failed after 3 attempt"):
        _retry_evaluation(always_fail, retry_count=2, delay_ms=1, request_log=request_log)
    assert "retry_0_error" in request_log


def test_retry_evaluation_does_not_retry_value_error() -> None:
    from photo_calibrator.backend.simple_server import _retry_evaluation

    def raise_value_error():
        raise ValueError("privacy gate or validation")

    with pytest.raises(ValueError, match="privacy gate"):
        _retry_evaluation(raise_value_error, retry_count=5, delay_ms=1, request_log={})

def test_plugin_analyze_payload_supports_uploaded_image() -> None:
    payload = _plugin_analyze_payload(
        {
            "image_data": sample_data_url(),
            "file_name": "plugin-analyze.png",
            "analyzer_ids": ["builtin.noopanalyzer"],
        }
    )

    assert payload["session_id"]
    assert len(payload["results"]) == 1
    assert payload["results"][0]["plugin_id"] == "builtin.noopanalyzer"


def test_plugin_analyze_payload_reuses_session() -> None:
    calibration = _calibrate_payload(
        {
            "image_data": sample_data_url(),
            "file_name": "plugin-analyze-session.png",
        }
    )

    payload = _plugin_analyze_payload(
        {
            "session_id": calibration["session_id"],
            "analyzer_ids": ["builtin.noopanalyzer"],
        }
    )

    assert payload["session_id"] == calibration["session_id"]
    assert len(payload["results"]) == 1


def test_plugin_analyze_payload_rejects_non_list_ids() -> None:
    with pytest.raises(ValueError, match="analyzer_ids must be a list"):
        _plugin_analyze_payload(
            {
                "image_data": sample_data_url(),
                "analyzer_ids": "builtin.noopanalyzer",
            }
        )


def test_parallel_duplicate_uploads_share_single_decode(monkeypatch) -> None:
    from photo_calibrator.backend import simple_server

    simple_server._ANALYSIS_CACHE.clear()
    simple_server._ANALYSIS_KEY_LOCKS.clear()
    calls = 0
    original_decode = simple_server._decode_preview_bgr

    def counting_decode(raw, file_name, max_side):
        nonlocal calls
        calls += 1
        return original_decode(raw, file_name, max_side)

    monkeypatch.setattr(simple_server, "_decode_preview_bgr", counting_decode)
    data_url = sample_data_url()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(
            pool.map(
                lambda _: simple_server._prepare_uploaded_analysis(data_url, "sample.png", 80),
                range(2),
            )
        )

    assert calls == 1
    assert results[0].cache_key == results[1].cache_key


def test_calibrate_payload_accepts_tiff_data_url() -> None:
    payload = _calibrate_payload(
        {
            "image_data": sample_tiff_data_url(),
            "mode": "global",
            "strength": 0.8,
        }
    )

    assert payload["input"]["width"] == 48
    assert_preview_url(payload["original_preview"])
    assert_preview_url(payload["calibrated_image"])


def test_film_scan_payload_returns_normalized_crop_rect() -> None:
    payload = _film_scan_payload(
        {
            "image_data": sample_film_data_url(),
            "file_name": "film.png",
            "analysis_max_side": 360,
        }
    )

    assert payload["session_id"]
    assert payload["film_scan"]["confidence"] > 0.5
    assert payload["film_scan"]["crop_w"] > 0
    assert payload["film_scan"]["crop_h"] > 0
    assert 0.0 <= payload["crop_rect"]["left"] <= 1.0
    assert 0.0 <= payload["crop_rect"]["top"] <= 1.0
    assert 0.1 <= payload["crop_rect"]["width"] <= 1.0
    assert 0.1 <= payload["crop_rect"]["height"] <= 1.0
    debug = payload["film_scan"]["debug"]
    assert debug["safe_inset"]["x"] > 0
    assert debug["safe_inset"]["y"] > 0
    assert debug["selected_crop"]["left"] > debug["detected_crop"]["left"]


def test_film_scan_payload_reuses_existing_session() -> None:
    calibration = _calibrate_payload(
        {
            "image_data": sample_film_data_url(),
            "file_name": "film-session.png",
            "analysis_max_side": 360,
        }
    )

    payload = _film_scan_payload({"session_id": calibration["session_id"]})

    assert payload["session_id"] == calibration["session_id"]
    assert payload["processing"]["analysis_width"] == calibration["processing"]["analysis_width"]


def test_calibrate_and_export_apply_crop_rect() -> None:
    calibration = _calibrate_payload(
        {
            "image_data": sample_data_url(),
            "file_name": "crop-source.png",
            "mode": "global",
            "strength": 0.8,
            "crop_rect": {"left": 0.25, "top": 0.25, "width": 0.5, "height": 0.5},
        }
    )

    assert calibration["output"]["width"] == 24
    assert calibration["output"]["height"] == 24
    assert calibration["processing"]["crop_applied"] is True

    with tempfile.TemporaryDirectory() as tmp:
        output_path = Path(tmp) / "cropped.png"
        payload = _export_payload(
            {
                "image_data": sample_data_url(),
                "file_name": "crop-source.png",
                "output_path": str(output_path),
                "format": "png",
                "mode": "global",
                "strength": 0.8,
                "crop_rect": {"left": 0.25, "top": 0.25, "width": 0.5, "height": 0.5},
            }
        )
        exported = cv2.imread(payload["path"], cv2.IMREAD_UNCHANGED)

    assert exported is not None
    assert exported.shape[:2] == (24, 24)


def test_calibrate_and_export_apply_image_transform() -> None:
    calibration = _calibrate_payload(
        {
            "image_data": sample_data_url_size(width=64, height=32),
            "file_name": "rotate-source.png",
            "mode": "global",
            "strength": 0.8,
            "image_transform": {"rotation": 90, "flipH": True, "flipV": False},
        }
    )

    assert calibration["output"]["width"] == 32
    assert calibration["output"]["height"] == 64
    assert calibration["processing"]["image_transform_applied"] is True

    with tempfile.TemporaryDirectory() as tmp:
        output_path = Path(tmp) / "rotated.png"
        payload = _export_payload(
            {
                "image_data": sample_data_url_size(width=64, height=32),
                "file_name": "rotate-source.png",
                "output_path": str(output_path),
                "format": "png",
                "mode": "global",
                "strength": 0.8,
                "image_transform": {"rotation": 90, "flipH": True, "flipV": False},
            }
        )
        exported = cv2.imread(payload["path"], cv2.IMREAD_UNCHANGED)

    assert exported is not None
    assert exported.shape[:2] == (64, 32)


def test_crop_region_rotates_with_image_in_preview_and_export() -> None:
    body = {
        "image_data": sample_data_url_size(width=80, height=40),
        "file_name": "crop-then-rotate.png",
        "mode": "global",
        "strength": 0.8,
        "crop_rect": {"left": 0.25, "top": 0.25, "width": 0.5, "height": 0.25},
        "image_transform": {"rotation": 90, "flipH": False, "flipV": False},
    }

    calibration = _calibrate_payload(body)

    assert calibration["output"]["width"] == 10
    assert calibration["output"]["height"] == 40
    assert calibration["processing"]["crop_applied"] is True
    assert calibration["processing"]["image_transform_applied"] is True

    with tempfile.TemporaryDirectory() as tmp:
        output_path = Path(tmp) / "crop-then-rotate.png"
        payload = _export_payload({**body, "output_path": str(output_path), "format": "png"})
        exported = cv2.imread(payload["path"], cv2.IMREAD_UNCHANGED)

    assert exported is not None
    assert exported.shape[:2] == (40, 10)


def test_calibrate_payload_supports_plugin_reader(monkeypatch) -> None:
    from photo_calibrator.backend import simple_server
    from photo_calibrator.services import PluginService

    with tempfile.TemporaryDirectory() as tmp:
        plugin_dir = Path(tmp) / "reader_plugin"
        plugin_dir.mkdir()
        manifest = {
            "id": "test.reader",
            "name": "Reader",
            "version": "0.1.0",
            "api_version": "0.1",
            "hooks": ["image_reader"],
        }
        (plugin_dir / "plugin.json").write_text(json.dumps(manifest))
        (plugin_dir / "plugin.py").write_text("""
import numpy as np
from photo_calibrator.core.image_model import ImageBuffer

class TestReader:
    @property
    def supported_extensions(self):
        return [".foo"]

    def read(self, path, **kwargs):
        image = np.full((24, 32, 3), 0.4, dtype=np.float32)
        return ImageBuffer(
            data=image,
            color_space="Linear",
            metadata={"reader": "plugin:test.reader"},
        )
""")
        svc = PluginService(search_paths=[Path(tmp)])
        svc.discover()
        monkeypatch.setattr(simple_server, "_PLUGIN_SERVICE", svc)

        payload = simple_server._calibrate_payload(
            {
                "image_data": "data:application/octet-stream;base64," + base64.b64encode(b"plugin-reader").decode("ascii"),
                "file_name": "sample.foo",
                "reader_plugin": "test.reader",
                "mode": "global",
                "strength": 0.8,
            }
        )

    assert payload["processing"]["preview_source"] == "io-plugin:test.reader"
    assert payload["processing"]["color_space"] == "Linear"


def test_film_scan_payload_supports_plugin_detector(monkeypatch) -> None:
    from photo_calibrator.backend import simple_server
    from photo_calibrator.services import PluginService

    with tempfile.TemporaryDirectory() as tmp:
        plugin_dir = Path(tmp) / "film_plugin"
        plugin_dir.mkdir()
        manifest = {
            "id": "test.film",
            "name": "Film Detector",
            "version": "0.1.0",
            "api_version": "0.1",
            "hooks": ["film_scan_detector"],
        }
        (plugin_dir / "plugin.json").write_text(json.dumps(manifest))
        (plugin_dir / "plugin.py").write_text("""
class TestFilmDetector:
    @property
    def detector_name(self):
        return "test-film"

    def detect(self, image, **kwargs):
        return {
            "corners": [(0, 0), (10, 0), (10, 10), (0, 10)],
            "angle_deg": 1.25,
            "crop_rect": {"left": 0.1, "top": 0.2, "width": 0.7, "height": 0.6},
            "confidence": 0.95,
            "border_type": "black",
            "film_format": "35mm",
            "is_perspective": False,
            "diagnosis": ["plugin"],
        }
""")
        svc = PluginService(search_paths=[Path(tmp)])
        svc.discover()
        monkeypatch.setattr(simple_server, "_PLUGIN_SERVICE", svc)

        payload = simple_server._film_scan_payload(
            {
                "image_data": sample_film_data_url(),
                "file_name": "film.png",
                "film_scan_detector_plugin": "test.film",
            }
        )

    assert payload["processing"]["film_scan_source"] == "plugin"
    assert payload["processing"]["film_scan_plugin_id"] == "test.film"
    assert payload["film_scan"]["confidence"] == pytest.approx(0.95)
    assert payload["crop_rect"]["left"] == pytest.approx(0.1)


def test_calibrate_batch_payload_processes_uploaded_images_in_parallel() -> None:
    payload = _calibrate_batch_payload(
        {
            "items": [
                {"image_data": sample_data_url(), "file_name": "a.png"},
                {"image_data": sample_tiff_data_url(), "file_name": "b.tif"},
            ],
            "mode": "global",
            "strength": 0.8,
            "analysis_max_side": 80,
            "workers": 2,
        }
    )

    assert payload["workers"] == 2
    assert len(payload["results"]) == 2
    assert all("/api/preview-image/" in result["calibrated_image"] for result in payload["results"])
    assert payload["results"][0]["processing"]["cache_key"].endswith(":a.png:80")
    assert payload["results"][1]["processing"]["cache_key"].endswith(":b.tif:80")


def test_calibrate_batch_duplicate_uploads_share_session_cache() -> None:
    data_url = sample_data_url()
    payload = _calibrate_batch_payload(
        {
            "items": [
                {"image_data": data_url, "file_name": "same.png"},
                {"image_data": data_url, "file_name": "same.png"},
            ],
            "analysis_max_side": 80,
            "workers": 2,
        }
    )

    assert payload["results"][0]["session_id"] == payload["results"][1]["session_id"]
    assert payload["results"][0]["input"] == payload["results"][1]["input"]


def test_calibrate_batch_http_route_processes_uploaded_images() -> None:
    try:
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    except PermissionError:
        pytest.skip("Socket creation is not permitted in this sandbox")
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        body = json.dumps(
            {
                "items": [{"image_data": sample_data_url(), "file_name": "route.png"}],
                "analysis_max_side": 80,
            }
        ).encode("utf-8")
        request = Request(
            f"http://127.0.0.1:{server.server_port}/api/calibrate-batch",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        payload = json.loads(urlopen(request, timeout=5).read().decode("utf-8"))
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)

    assert payload["workers"] == 1
    assert_preview_url(payload["results"][0]["calibrated_image"])


def test_calibrate_payload_downsamples_large_input_for_analysis() -> None:
    payload = _calibrate_payload(
        {
            "image_data": large_tiff_data_url(),
            "mode": "global",
            "strength": 0.8,
            "analysis_max_side": 160,
        }
    )

    assert payload["processing"]["original_width"] == 640
    assert payload["processing"]["original_height"] == 320
    assert payload["processing"]["analysis_width"] == 160
    assert payload["processing"]["analysis_height"] == 80
    assert payload["processing"]["downsample_ratio"] < 1.0


def test_prepare_uploaded_image_prefers_embedded_tiff_preview_page() -> None:
    prepared = _prepare_uploaded_image(
        multipage_tiff_data_url(),
        file_name="sample.tif",
        max_side=512,
    )

    assert prepared.preview_source == "tiff-preview-page"
    assert prepared.original_width == 270
    assert prepared.original_height == 180
    assert prepared.analysis_width == 270


def test_prepare_file_for_analysis_uses_reduced_decode_for_large_tiff(tmp_path) -> None:
    path = tmp_path / "large.tif"
    img = np.zeros((320, 640, 3), dtype=np.uint8)
    img[:, :] = (80, 90, 120)
    assert cv2.imwrite(str(path), img)

    prepared = _prepare_file_for_analysis(path, max_side=160)

    assert prepared.preview_source.startswith("io-")
    assert prepared.analysis_width <= 160
    assert prepared.downsample_ratio < 1.0


def test_prepare_file_for_analysis_reuses_local_preview_cache(tmp_path, monkeypatch) -> None:
    cache_dir = tmp_path / "preview-cache"
    monkeypatch.setattr("photo_calibrator.backend.simple_server.PREVIEW_CACHE_DIR", cache_dir)
    path = tmp_path / "large.tif"
    img = np.zeros((320, 640, 3), dtype=np.uint8)
    img[:, :] = (80, 90, 120)
    assert cv2.imwrite(str(path), img)

    first = _prepare_file_for_analysis(path, max_side=160)
    second = _prepare_file_for_analysis(path, max_side=160)

    assert first.preview_source.startswith("io-")
    assert second.preview_source == "preview-cache"
    assert second.original_width == 640
    assert second.original_height == 320
    assert second.analysis_width <= 160
    assert any(cache_dir.glob("*.jpg"))


def test_calibrate_path_payload_accepts_local_tiff_path(tmp_path) -> None:
    path = tmp_path / "sample.tif"
    img = np.zeros((80, 120, 3), dtype=np.uint8)
    img[:, :] = (100, 120, 150)
    assert cv2.imwrite(str(path), img)

    payload = _calibrate_path_payload({"path": str(path), "analysis_max_side": 80})

    assert payload["processing"]["analysis_width"] == 80
    assert_preview_url(payload["original_preview"])


def test_calibrate_paths_payload_processes_multiple_files(tmp_path) -> None:
    paths = []
    for index, color in enumerate([(100, 120, 150), (150, 120, 100)]):
        path = tmp_path / f"sample-{index}.tif"
        img = np.zeros((80, 120, 3), dtype=np.uint8)
        img[:, :] = color
        assert cv2.imwrite(str(path), img)
        paths.append(str(path))

    payload = _calibrate_paths_payload({"paths": paths, "analysis_max_side": 80, "workers": 2})

    assert payload["workers"] == 2
    assert len(payload["results"]) == 2
    assert all("/api/preview-image/" in result["calibrated_image"] for result in payload["results"])


def test_parallel_duplicate_paths_share_single_analysis_build(tmp_path, monkeypatch) -> None:
    from photo_calibrator.backend import simple_server

    simple_server._ANALYSIS_CACHE.clear()
    simple_server._ANALYSIS_KEY_LOCKS.clear()
    path = tmp_path / "sample.tif"
    img = np.zeros((80, 120, 3), dtype=np.uint8)
    img[:, :] = (90, 120, 160)
    assert cv2.imwrite(str(path), img)

    calls = 0
    original_prepare = simple_server._prepare_file_for_analysis

    def counting_prepare(file_path, max_side=simple_server.DEFAULT_ANALYSIS_MAX_SIDE):
        nonlocal calls
        calls += 1
        return original_prepare(file_path, max_side)

    monkeypatch.setattr(simple_server, "_prepare_file_for_analysis", counting_prepare)

    payload = _calibrate_paths_payload({"paths": [str(path), str(path)], "analysis_max_side": 80, "workers": 2})

    assert calls == 1
    assert len(payload["results"]) == 2
    assert payload["results"][0]["session_id"] == payload["results"][1]["session_id"]


def test_accelerator_payload_reports_backend_capability() -> None:
    payload = _accelerator_payload()

    assert payload["active_backend"] in BACKEND_NAMES
    assert isinstance(payload["opencv_threads"], int)
    assert "opencl_available" in payload
    assert "available_backends" in payload
    assert "fallback_reason" in payload
    assert "gpu_ops" in payload
    assert "3d-lut" in payload["accelerated_ops"] or "3d-lut" in payload["cpu_fallback_ops"]


def test_capabilities_route_reports_interfaces_and_persistence() -> None:
    from photo_calibrator.backend.simple_server import _get_capabilities_route

    payload = _get_capabilities_route({})
    assert payload["interfaces"]["http"] is True
    assert payload["interfaces"]["fastapi"] is True
    assert payload["interfaces"]["ipc_stdio"] is True
    assert "preview_cache_dir" in payload["persistence"]
    assert "session_store_dir" in payload["persistence"]


def test_accelerator_benchmark_payload_runs_all_key_ops() -> None:
    payload = _accelerator_benchmark_payload(image_side=64, lut_size=7, iterations=1)
    names = {item["name"] for item in payload["operations"]}

    assert names == {"resize", "rgb-lab", "lab-rgb", "curve-lut", "matrix", "3d-lut"}
    assert payload["accelerator"]["active_backend"] in BACKEND_NAMES
    assert payload["image_side"] == 64
    assert all(item["device"] in {"cpu", "gpu"} for item in payload["operations"])


def test_set_accelerator_payload_reconfigures_with_cpu_fallback() -> None:
    original = _accelerator_payload()["requested_backend"]
    try:
        payload = _set_accelerator_payload("cpu-opencv")
        assert payload["requested_backend"] == "cpu-opencv"
        assert payload["active_backend"] == "cpu-opencv"
        assert payload["opencl_enabled"] is False

        payload = _set_accelerator_payload("torch")
        assert payload["requested_backend"] == "torch"
        assert payload["active_backend"] in {"cpu-opencv", "torch-cuda", "torch-mps"}
        if payload["active_backend"] == "cpu-opencv":
            assert "Torch GPU backend is unavailable" in payload["fallback_reason"]
    finally:
        _set_accelerator_payload(original)


def test_raw_decoder_prefers_embedded_jpeg_thumbnail(monkeypatch) -> None:
    thumb_rgb = np.zeros((12, 16, 3), dtype=np.uint8)
    thumb_rgb[:, :] = (90, 100, 120)
    ok, encoded = cv2.imencode(".jpg", cv2.cvtColor(thumb_rgb, cv2.COLOR_RGB2BGR))
    assert ok

    calls = {"extract_thumb": 0, "postprocess": 0}

    class ThumbFormat:
        JPEG = 1
        BITMAP = 2

    class FakeThumb:
        format = ThumbFormat.JPEG
        data = encoded.tobytes()

    class FakeRaw:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def extract_thumb(self):
            calls["extract_thumb"] += 1
            return FakeThumb()

        def postprocess(self, **_kwargs):
            calls["postprocess"] += 1
            return thumb_rgb

    fake_rawpy = types.SimpleNamespace(
        ThumbFormat=ThumbFormat,
        imread=lambda _path: FakeRaw(),
    )
    monkeypatch.setitem(sys.modules, "rawpy", fake_rawpy)

    raw_payload = "data:application/octet-stream;base64," + base64.b64encode(b"fake-raw").decode("ascii")
    prepared = _prepare_uploaded_image(raw_payload, file_name="sample.dng", max_side=256)

    assert prepared.preview_source == "raw-embedded-jpeg"
    assert prepared.original_width == 16
    assert prepared.original_height == 12
    assert calls == {"extract_thumb": 1, "postprocess": 0}


def test_prepare_uploaded_image_passes_raw_preview_options(monkeypatch) -> None:
    from photo_calibrator.backend import simple_server

    simple_server._ANALYSIS_CACHE.clear()
    simple_server._ANALYSIS_KEY_LOCKS.clear()
    captured: dict[str, object] = {}

    def fake_decode_raw_preview(raw, file_name, **kwargs):
        captured.update(kwargs)
        bgr = np.zeros((12, 16, 3), dtype=np.uint8)
        return bgr, "raw-half-postprocess"

    monkeypatch.setattr(simple_server, "decode_raw_image", lambda *args, **kwargs: None)
    monkeypatch.setattr("photo_calibrator.io.raw.decode_raw_preview", fake_decode_raw_preview)

    raw_payload = "data:application/octet-stream;base64," + base64.b64encode(b"fake-raw").decode("ascii")
    prepared = _prepare_uploaded_image(
        raw_payload,
        file_name="sample-options.dng",
        max_side=256,
        raw_options={
            "white_balance": "manual",
            "user_wb": (2.0, 1.0, 1.0, 1.5),
            "no_auto_bright": False,
            "output_bps": 16,
        },
    )
    assert prepared.preview_source == "raw-half-postprocess"
    assert captured["white_balance"] == "manual"
    assert captured["user_wb"] == (2.0, 1.0, 1.0, 1.5)
    assert captured["no_auto_bright"] is False


# ---------------------------------------------------------------------------
# Export endpoint tests
# ---------------------------------------------------------------------------


def test_export_payload_writes_jpeg_to_disk(tmp_path) -> None:
    from photo_calibrator.backend.simple_server import _export_payload

    out = tmp_path / "exported.jpg"
    payload = _export_payload(
        {
            "image_data": sample_data_url(),
            "mode": "global",
            "strength": 0.8,
            "output_path": str(out),
            "format": "jpeg",
            "quality": 90,
        }
    )
    assert payload["ok"] is True
    assert out.exists()
    assert out.stat().st_size > 0
    assert payload["export_settings"]["format"] == "jpeg"
    assert payload["export_settings"]["output_path"] == str(out)


def test_export_payload_respects_export_policy_flags(tmp_path) -> None:
    from photo_calibrator.backend.simple_server import _export_payload

    out = tmp_path / "policy.jpg"
    payload = _export_payload(
        {
            "image_data": sample_data_url(),
            "output_path": str(out),
            "format": "jpeg",
            "embed_icc": False,
            "preserve_metadata": False,
            "export_transform": "display",
        }
    )
    assert payload["ok"] is True
    assert payload["export_settings"]["embed_icc"] is False
    assert payload["export_settings"]["preserve_metadata"] is False
    assert payload["export_settings"]["export_transform"] == "display"
    assert payload["export_settings"]["icc_embedded"] is False


def test_export_payload_echoes_ocio_policy_fields(tmp_path) -> None:
    from photo_calibrator.backend.simple_server import _export_payload

    out = tmp_path / "ocio.jpg"
    payload = _export_payload(
        {
            "image_data": sample_data_url(),
            "output_path": str(out),
            "format": "jpeg",
            "ocio_config_path": "/tmp/fake-config.ocio",
            "ocio_display_space": "Display - sRGB",
            "ocio_scene_linear_space": "ACEScg",
        }
    )
    assert payload["ok"] is True
    assert payload["export_settings"]["ocio_config_path"] == "/tmp/fake-config.ocio"
    assert payload["export_settings"]["ocio_display_space"] == "Display - sRGB"
    assert payload["export_settings"]["ocio_scene_linear_space"] == "ACEScg"


def test_export_payload_replays_to_full_resolution(tmp_path) -> None:
    from photo_calibrator.backend.simple_server import _export_payload

    out = tmp_path / "exported-large.jpg"
    payload = _export_payload(
        {
            "image_data": large_tiff_data_url(),
            "file_name": "large.tif",
            "mode": "global",
            "strength": 0.8,
            "analysis_max_side": 160,
            "output_path": str(out),
            "format": "jpeg",
            "quality": 90,
        }
    )

    assert payload["ok"] is True
    exported = cv2.imread(str(out), cv2.IMREAD_COLOR)
    assert exported is not None
    assert exported.shape[1] == 640
    assert exported.shape[0] == 320


def test_export_payload_writes_sidecar_json(tmp_path) -> None:
    from photo_calibrator.backend.simple_server import _export_payload

    out = tmp_path / "test.calib.json"
    payload = _export_payload(
        {
            "image_data": sample_data_url(),
            "mode": "global",
            "strength": 0.8,
            "output_path": str(out),
            "format": "sidecar",
        }
    )
    assert payload["ok"] is True
    assert out.exists()
    import json
    data = json.loads(out.read_text())
    assert data["calibration"]["mode"] == "global"
    assert data["input_metadata"]["metadata"]["reader"] in {"imageio", "opencv"}
    assert data["export_settings"]["format"] == "sidecar"


def test_export_payload_writes_cube_lut(tmp_path) -> None:
    from photo_calibrator.backend.simple_server import _export_payload

    out = tmp_path / "test.cube"
    payload = _export_payload(
        {
            "image_data": sample_data_url(),
            "output_path": str(out),
            "format": "cube",
        }
    )
    assert payload["ok"] is True
    assert out.exists()
    assert "LUT_3D_SIZE" in out.read_text()


def test_export_payload_writes_exr_to_disk(tmp_path) -> None:
    from photo_calibrator.backend.simple_server import _export_payload
    from photo_calibrator.io.readers import read_image

    out = tmp_path / "exported.exr"
    payload = _export_payload(
        {
            "image_data": sample_data_url(),
            "mode": "global",
            "strength": 0.8,
            "output_path": str(out),
            "format": "exr",
        }
    )
    assert payload["ok"] is True
    assert out.exists()
    reloaded = read_image(out)
    assert reloaded.dtype == np.float32
    assert reloaded.width == 48
    assert reloaded.height == 48
    assert payload["export_settings"]["color_space"] == "sRGB"


def test_export_payload_supports_plugin_writer(monkeypatch, tmp_path) -> None:
    from photo_calibrator.backend import simple_server
    from photo_calibrator.services import PluginService

    with tempfile.TemporaryDirectory() as tmp:
        plugin_dir = Path(tmp) / "writer_plugin"
        plugin_dir.mkdir()
        manifest = {
            "id": "test.writer",
            "name": "Writer",
            "version": "0.1.0",
            "api_version": "0.1",
            "hooks": ["image_writer"],
        }
        (plugin_dir / "plugin.json").write_text(json.dumps(manifest))
        (plugin_dir / "plugin.py").write_text("""
from pathlib import Path

class TestWriter:
    @property
    def format_name(self):
        return "jpeg"

    def write(self, image, path, **kwargs):
        Path(path).write_bytes(b"plugin-writer")
        return {"quality": kwargs.get("quality")}
""")
        svc = PluginService(search_paths=[Path(tmp)])
        svc.discover()
        monkeypatch.setattr(simple_server, "_PLUGIN_SERVICE", svc)

        out = tmp_path / "plugin-export.jpg"
        payload = simple_server._export_payload(
            {
                "image_data": sample_data_url(),
                "output_path": str(out),
                "format": "jpeg",
                "writer_plugin": "test.writer",
                "quality": 88,
            }
        )

    assert payload["ok"] is True
    assert payload["writer"]["writer_plugin_id"] == "test.writer"
    assert payload["writer"]["quality"] == 88
    assert out.read_bytes() == b"plugin-writer"


# ---------------------------------------------------------------------------
# Session TTL / Cache API / Sidecar API tests (Agent D)
# ---------------------------------------------------------------------------


def test_session_expires_after_zero_ttl(monkeypatch) -> None:
    """When TTL=0, a session should expire immediately."""
    from photo_calibrator.backend import simple_server

    simple_server._ANALYSIS_CACHE.clear()
    monkeypatch.setattr(simple_server, "SESSION_TTL_SECONDS", 0)

    payload = simple_server._calibrate_payload({
        "image_data": sample_data_url(),
        "file_name": "ttl-test.png",
    })
    session_id = payload["session_id"]

    with pytest.raises(ValueError, match="expired"):
        simple_server._calibrate_session_payload({
            "session_id": session_id,
            "mode": "global",
        })


def test_cache_stats_reports_items() -> None:
    from photo_calibrator.backend import simple_server

    simple_server._ANALYSIS_CACHE.clear()

    simple_server._calibrate_payload({
        "image_data": sample_data_url(),
        "file_name": "stats-a.png",
    })
    simple_server._calibrate_payload({
        "image_data": sample_tiff_data_url(),
        "file_name": "stats-b.tif",
    })

    stats = simple_server._cache_stats_payload()
    assert stats["items"] >= 1
    assert stats["limit"] == simple_server.MEMORY_CACHE_LIMIT
    assert "ttl_seconds" in stats
    assert "oldest_age_seconds" in stats
    assert "preview_cache_files" in stats


def test_cache_clear_empties_cache() -> None:
    from photo_calibrator.backend import simple_server

    simple_server._calibrate_payload({
        "image_data": sample_data_url(),
        "file_name": "clear-test.png",
    })
    assert len(simple_server._ANALYSIS_CACHE) >= 1

    simple_server.PREVIEW_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    (simple_server.PREVIEW_CACHE_DIR / "stale.jpg").write_bytes(b"x")
    result = simple_server._cache_clear_payload()
    assert result["ok"] is True
    assert result["cleared"] >= 1
    assert result["preview_cache_deleted"] >= 1
    assert len(simple_server._ANALYSIS_CACHE) == 0


def test_sidecar_save_and_load_api(tmp_path) -> None:
    from photo_calibrator.backend.simple_server import _sidecar_save_payload, _sidecar_load_payload

    sidecar_path = tmp_path / "test.calib.json"

    result = _sidecar_save_payload({
        "path": str(sidecar_path),
        "calibration": {"mode": "midtones-only", "a_shift": -1.2, "b_shift": 3.4, "strength": 0.7},
        "algorithm_version": "0.3.0",
    })
    assert result["ok"] is True
    assert result["path"] == str(sidecar_path)
    assert sidecar_path.exists()

    loaded = _sidecar_load_payload({"path": str(sidecar_path)})
    assert loaded["calibration"]["mode"] == "midtones-only"
    assert loaded["calibration"]["a_shift"] == -1.2
    assert loaded["algorithm_version"] == "0.3.0"


def test_sidecar_save_supports_export_settings(tmp_path) -> None:
    from photo_calibrator.backend.simple_server import _sidecar_load_payload, _sidecar_save_payload

    sidecar_path = tmp_path / "with-export.calib.json"
    result = _sidecar_save_payload({
        "path": str(sidecar_path),
        "calibration": {"mode": "global", "strength": 0.8},
        "export_settings": {"format": "jpeg", "icc_embedded": True},
    })
    assert result["ok"] is True
    loaded = _sidecar_load_payload({"path": str(sidecar_path)})
    assert loaded["export_settings"]["format"] == "jpeg"
    assert loaded["export_settings"]["icc_embedded"] is True


def test_sidecar_save_uses_session_ai_evaluations_and_calibration(tmp_path) -> None:
    from photo_calibrator.backend.simple_server import _ai_evaluate_payload, _sidecar_load_payload, _sidecar_save_payload

    calibration = _calibrate_payload(
        {
            "image_data": sample_data_url(),
            "file_name": "session-sidecar.png",
            "mode": "global",
            "strength": 0.8,
        }
    )
    _ai_evaluate_payload(
        {
            "session_id": calibration["session_id"],
            "evaluator_name": "__default__",
            "context": "neutral balance",
            "mode": "global",
            "strength": 0.8,
        }
    )
    sidecar_path = tmp_path / "session.calib.json"
    result = _sidecar_save_payload({
        "path": str(sidecar_path),
        "session_id": calibration["session_id"],
    })
    assert result["ok"] is True
    loaded = _sidecar_load_payload({"path": str(sidecar_path)})
    assert loaded["session_metadata"]["session_id"] == calibration["session_id"]
    assert loaded["ai_evaluations"]["__default__"]["metadata"]["source"] == "native"
    assert loaded["calibration"]["mode"] == "global"
    assert loaded["session_metadata"]["ai_requests"][-1]["status"] == "ok"


def test_session_save_and_load_roundtrip(tmp_path) -> None:
    calibration = _calibrate_payload(
        {
            "image_data": sample_data_url(),
            "file_name": "persist-session.png",
            "mode": "global",
            "strength": 0.8,
        }
    )
    _ai_evaluate_payload(
        {
            "session_id": calibration["session_id"],
            "context": "roundtrip",
            "mode": "global",
            "strength": 0.8,
        }
    )
    path = tmp_path / "session.json"
    saved = _session_save_payload({"session_id": calibration["session_id"], "path": str(path)})
    assert saved["ok"] is True
    assert path.exists()

    from photo_calibrator.backend import simple_server

    simple_server._ANALYSIS_CACHE.clear()
    loaded = _session_load_payload({"path": str(path)})
    assert loaded["ok"] is True
    assert loaded["session_id"] == calibration["session_id"]

    from photo_calibrator.backend import simple_server

    restored_entry = simple_server._get_analysis(loaded["session_id"])
    assert restored_entry is not None
    assert restored_entry.session_metadata["document"]["operations"][-1]["name"] == "calibration"

    session_payload = _calibrate_session_payload(
        {
            "session_id": loaded["session_id"],
            "mode": "global",
            "strength": 0.6,
        }
    )
    assert session_payload["session_id"] == calibration["session_id"]
    assert session_payload["input"] == calibration["input"]
    assert session_payload["document"]["operations"]


def test_session_save_defaults_to_managed_store(tmp_path, monkeypatch) -> None:
    from photo_calibrator.backend import simple_server

    monkeypatch.setattr(simple_server, "SESSION_STORE_DIR", tmp_path / "sessions")
    calibration = _calibrate_payload(
        {
            "image_data": sample_data_url(),
            "file_name": "managed-session.png",
        }
    )
    saved = simple_server._session_save_payload({"session_id": calibration["session_id"]})
    assert saved["ok"] is True
    assert Path(saved["path"]).exists()
    assert Path(saved["path"]).parent == simple_server.SESSION_STORE_DIR


def test_session_list_and_delete_managed_sessions(tmp_path, monkeypatch) -> None:
    from photo_calibrator.backend import simple_server

    monkeypatch.setattr(simple_server, "SESSION_STORE_DIR", tmp_path / "sessions")
    calibration = _calibrate_payload(
        {
            "image_data": sample_data_url(),
            "file_name": "session-list.png",
        }
    )
    saved = simple_server._session_save_payload({"session_id": calibration["session_id"]})
    listed = simple_server._session_list_payload({})
    assert any(item["session_id"] == calibration["session_id"] for item in listed["sessions"])

    deleted = simple_server._session_delete_payload({"session_id": calibration["session_id"]})
    assert deleted["ok"] is True
    assert deleted["deleted"] is True
    assert not Path(saved["path"]).exists()


def test_preview_cache_cleanup_deletes_old_files(tmp_path, monkeypatch) -> None:
    from photo_calibrator.backend import simple_server

    cache_dir = tmp_path / "preview-cache"
    monkeypatch.setattr(simple_server, "PREVIEW_CACHE_DIR", cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)
    old_file = cache_dir / "old.jpg"
    new_file = cache_dir / "new.jpg"
    old_file.write_bytes(b"old")
    new_file.write_bytes(b"new")
    old_time = time.time() - 120
    os.utime(old_file, (old_time, old_time))

    result = simple_server._preview_cache_cleanup_payload({"max_age_seconds": 60})
    assert result["ok"] is True
    assert result["deleted"] == 1
    assert result["kept"] == 1
    assert not old_file.exists()
    assert new_file.exists()


def test_session_cleanup_deletes_old_managed_sessions(tmp_path, monkeypatch) -> None:
    from photo_calibrator.backend import simple_server

    session_dir = tmp_path / "sessions"
    monkeypatch.setattr(simple_server, "SESSION_STORE_DIR", session_dir)
    session_dir.mkdir(parents=True, exist_ok=True)
    old_file = session_dir / "old.json"
    new_file = session_dir / "new.json"
    old_file.write_text("{}")
    new_file.write_text("{}")
    old_time = time.time() - 120
    os.utime(old_file, (old_time, old_time))

    result = simple_server._session_cleanup_payload({"max_age_seconds": 60})
    assert result["ok"] is True
    assert result["deleted"] == 1
    assert result["kept"] == 1
    assert not old_file.exists()
    assert new_file.exists()


def test_session_load_can_assign_new_session_id(tmp_path) -> None:
    calibration = _calibrate_payload(
        {
            "image_data": sample_data_url(),
            "file_name": "persist-session-new-id.png",
        }
    )
    path = tmp_path / "session-new-id.json"
    _session_save_payload({"session_id": calibration["session_id"], "path": str(path)})
    loaded = _session_load_payload({"path": str(path), "new_session_id": "restored:test"})
    assert loaded["session_id"] == "restored:test"


def test_plugin_calibration_document_marks_nonreplayable() -> None:
    payload = _calibrate_payload(
        {
            "image_data": sample_data_url(),
            "file_name": "plugin-doc.png",
            "calibrator_plugin": "builtin.noopcalibrator",
        }
    )
    op = payload["document"]["operations"][-1]
    assert op["name"] == "plugin-calibration"
    assert op["replayable"] is False


def test_document_payload_returns_session_operations() -> None:
    calibration = _calibrate_payload(
        {
            "image_data": sample_data_url(),
            "file_name": "doc-session.png",
            "mode": "rgb-curves",
            "strength": 0.4,
        }
    )
    payload = _document_payload({"session_id": calibration["session_id"]})
    assert payload["ok"] is True
    assert payload["document"]["operations"][-1]["name"] == "calibration"
    assert payload["document"]["operations"][-1]["params"]["mode"] == "rgb-curves"


def test_document_render_payload_replays_current_document() -> None:
    calibration = _calibrate_payload(
        {
            "image_data": sample_data_url(),
            "file_name": "doc-render.png",
            "mode": "global",
            "strength": 0.8,
        }
    )
    payload = _document_render_payload({"session_id": calibration["session_id"]})
    assert payload["ok"] is True
    assert_preview_url(payload["calibrated_image"])
    assert payload["processing"]["document_replayable_ops"] >= 1


# ---------------------------------------------------------------------------
# Export-path and batch status tests (Agent D)
# ---------------------------------------------------------------------------


def test_export_path_writes_calibrated_file(tmp_path) -> None:
    import cv2
    from photo_calibrator.backend.simple_server import _export_path_payload

    src = tmp_path / "src.tif"
    dst = tmp_path / "out.jpg"
    img = np.zeros((60, 80, 3), dtype=np.uint8)
    img[:, :] = (100, 120, 150)
    cv2.imwrite(str(src), img)

    result = _export_path_payload({
        "input_path": str(src),
        "output_path": str(dst),
        "mode": "global",
        "format": "jpeg",
        "analysis_max_side": 80,
    })
    assert result["ok"] is True
    assert result["path"] == str(dst)
    assert dst.exists()
    assert dst.stat().st_size > 0
    assert result["elapsed_ms"] > 0
    assert result["export_settings"]["format"] == "jpeg"


def test_export_path_writes_hdr_file(tmp_path) -> None:
    import cv2
    from photo_calibrator.backend.simple_server import _export_path_payload
    from photo_calibrator.io.readers import read_image

    src = tmp_path / "src-hdr.tif"
    dst = tmp_path / "out.hdr"
    img = np.zeros((60, 80, 3), dtype=np.uint8)
    img[:, :] = (100, 120, 150)
    cv2.imwrite(str(src), img)

    result = _export_path_payload({
        "input_path": str(src),
        "output_path": str(dst),
        "mode": "global",
        "format": "hdr",
        "analysis_max_side": 80,
    })
    assert result["ok"] is True
    assert dst.exists()
    reloaded = read_image(dst)
    assert reloaded.dtype == np.float32


def test_export_path_replays_to_full_resolution(tmp_path) -> None:
    import cv2
    from photo_calibrator.backend.simple_server import _export_path_payload

    src = tmp_path / "src-large.tif"
    dst = tmp_path / "out-large.jpg"
    img = np.zeros((320, 640, 3), dtype=np.uint8)
    img[:, :] = (100, 120, 150)
    cv2.imwrite(str(src), img)

    result = _export_path_payload({
        "input_path": str(src),
        "output_path": str(dst),
        "mode": "global",
        "format": "jpeg",
        "analysis_max_side": 160,
    })
    assert result["ok"] is True
    exported = cv2.imread(str(dst), cv2.IMREAD_COLOR)
    assert exported is not None
    assert exported.shape[1] == 640
    assert exported.shape[0] == 320


def test_export_payload_uses_full_raw_decode_for_raw_files(monkeypatch, tmp_path) -> None:
    from photo_calibrator.backend import simple_server
    from photo_calibrator.backend.schemas import AnalysisEntry, PreparedImage

    calls = {"full": 0}

    def fake_decode_raw_image(raw_bytes, file_name, **kwargs):
        calls["full"] += 1
        data = np.zeros((96, 144, 3), dtype=np.uint16)
        data[:, :] = 32768
        from photo_calibrator.core.image_model import ImageBuffer
        return ImageBuffer(data=data, color_space="Linear", metadata={"reader": "rawpy", "exif_bytes": b"raw"})

    preview = np.zeros((24, 36, 3), dtype=np.uint8)
    preview[:, :] = (120, 130, 140)
    prepared = PreparedImage(
        image=preview,
        original_width=144,
        original_height=96,
        analysis_width=36,
        analysis_height=24,
        downsample_ratio=0.25,
        source_dtype="uint16",
        preview_source="raw-embedded-jpeg",
    )
    entry = AnalysisEntry(
        prepared=prepared,
        input_report=simple_server.analyze_image_array(preview),
        zones=simple_server.auto_detect_cast(preview),
        static_charts=simple_server._static_chart_payload(simple_server.analyze_image_array(preview), preview),
        cache_key="raw:test",
        created_at=0.0,
    )

    monkeypatch.setattr(simple_server, "decode_raw_image", fake_decode_raw_image)
    monkeypatch.setattr(simple_server, "_prepare_uploaded_analysis", lambda *args, **kwargs: entry)
    out = tmp_path / "raw-export.jpg"
    payload = simple_server._export_payload(
        {
            "image_data": "data:application/octet-stream;base64," + base64.b64encode(b"fake-raw").decode("ascii"),
            "file_name": "sample.dng",
            "output_path": str(out),
            "format": "jpeg",
            "mode": "global",
            "strength": 0.8,
            "raw_white_balance": "auto",
            "raw_output_bps": 8,
            "raw_no_auto_bright": False,
        }
    )
    assert payload["ok"] is True
    assert calls["full"] == 1
    assert payload["export_settings"]["color_space"] == "Linear"
    exported = cv2.imread(str(out), cv2.IMREAD_COLOR)
    assert exported is not None
    assert exported.shape[:2] == (96, 144)


def test_export_payload_propagates_raw_decode_options(monkeypatch, tmp_path) -> None:
    from photo_calibrator.backend import simple_server
    from photo_calibrator.backend.schemas import AnalysisEntry, PreparedImage

    captured: dict[str, object] = {}

    def fake_decode_raw_image(raw_bytes, file_name, **kwargs):
        captured.update(kwargs)
        data = np.zeros((96, 144, 3), dtype=np.uint16)
        data[:, :] = 32768
        from photo_calibrator.core.image_model import ImageBuffer

        return ImageBuffer(data=data, color_space="Linear", metadata={"reader": "rawpy"})

    preview = np.zeros((24, 36, 3), dtype=np.uint8)
    preview[:, :] = (120, 130, 140)
    entry = AnalysisEntry(
        prepared=PreparedImage(
            image=preview,
            original_width=144,
            original_height=96,
            analysis_width=36,
            analysis_height=24,
            downsample_ratio=0.25,
            source_dtype="uint16",
            preview_source="raw-half-postprocess",
        ),
        input_report=simple_server.analyze_image_array(preview),
        zones=simple_server.auto_detect_cast(preview),
        static_charts=simple_server._static_chart_payload(simple_server.analyze_image_array(preview), preview),
        cache_key="raw:options",
        created_at=0.0,
    )

    monkeypatch.setattr(simple_server, "decode_raw_image", fake_decode_raw_image)
    monkeypatch.setattr(simple_server, "_prepare_uploaded_analysis", lambda *args, **kwargs: entry)
    out = tmp_path / "raw-options.jpg"
    simple_server._export_payload(
        {
            "image_data": "data:application/octet-stream;base64," + base64.b64encode(b"fake-raw").decode("ascii"),
            "file_name": "sample.dng",
            "output_path": str(out),
            "format": "jpeg",
            "raw_white_balance": "manual",
            "raw_user_wb": [2.0, 1.0, 1.0, 1.5],
            "raw_output_bps": 8,
            "raw_no_auto_bright": False,
        }
    )
    assert captured["white_balance"] == "manual"
    assert captured["user_wb"] == (2.0, 1.0, 1.0, 1.5)
    assert captured["output_bps"] == 8
    assert captured["no_auto_bright"] is False


def test_apply_core_calibration_passes_color_space_context() -> None:
    from photo_calibrator.backend import simple_server
    from photo_calibrator.backend.schemas import AnalysisEntry, PreparedImage
    from photo_calibrator.core.calibration import CalibrationMode, CalibrationParams

    captured: dict[str, object] = {}
    preview = np.full((12, 18, 3), 0.45, dtype=np.float32)
    prepared = PreparedImage(
        image=preview,
        original_width=18,
        original_height=12,
        analysis_width=18,
        analysis_height=12,
        downsample_ratio=1.0,
        source_dtype="float32",
        preview_source="io-oiio",
        color_space="Linear",
        data_range=(0.0, 1.2),
    )
    entry = AnalysisEntry(
        prepared=prepared,
        input_report=simple_server.analyze_image_array(preview),
        zones=simple_server.auto_detect_cast(preview),
        static_charts=simple_server._static_chart_payload(simple_server.analyze_image_array(preview), np.full((12, 18, 3), 128, dtype=np.uint8)),
        cache_key="linear-calibration:test",
        created_at=0.0,
    )

    original = simple_server.calibrate_image_from_analysis

    def wrapped(image, params, pre_report, zones, **kwargs):
        captured.update(kwargs)
        return original(image, params, pre_report, zones, **kwargs)

    simple_server.calibrate_image_from_analysis = wrapped
    try:
        payload = simple_server._apply_core_calibration(
            entry,
            preview,
            CalibrationParams(mode=CalibrationMode.GLOBAL, strength=0.8),
        )
    finally:
        simple_server.calibrate_image_from_analysis = original

    assert payload["metadata"]["working_color_space"] == "Linear"
    assert captured["color_space"] == "Linear"
    assert captured["data_range"] == (0.0, 1.2)


def test_batch_status_unknown_batch_id() -> None:
    from photo_calibrator.backend.simple_server import _batch_status_payload

    result = _batch_status_payload({"batch_id": ["nonexistent"]})
    assert "error" in result


def test_batch_cancel_unknown_batch_id() -> None:
    from photo_calibrator.backend.simple_server import _batch_cancel_payload

    result = _batch_cancel_payload({"batch_id": "nonexistent"})
    assert result["ok"] is True


def test_calibrate_batch_async_job_can_be_cancelled(monkeypatch) -> None:
    from photo_calibrator.backend import simple_server

    original = simple_server._calibrate_entry_payload

    def slow_calibrate(entry, body, start):
        time.sleep(0.05)
        return original(entry, body, start)

    monkeypatch.setattr(simple_server, "_calibrate_entry_payload", slow_calibrate)
    job = simple_server._calibrate_batch_payload(
        {
            "async": True,
            "items": [
                {"image_data": sample_data_url(), "file_name": "a.png"},
                {"image_data": sample_data_url(), "file_name": "b.png"},
                {"image_data": sample_data_url(), "file_name": "c.png"},
            ],
            "workers": 1,
            "mode": "global",
            "strength": 0.8,
        }
    )
    assert job["state"] in {"queued", "running"}
    cancel = simple_server._batch_cancel_payload({"batch_id": job["batch_id"]})
    assert cancel["cancel_requested"] is True

    final = None
    for _ in range(50):
        status = simple_server._batch_status_payload({"batch_id": [job["batch_id"]]})
        if status["done"]:
            final = status
            break
        time.sleep(0.01)
    assert final is not None
    assert final["state"] == "cancelled"
    assert final["cancelled"] is True
    assert any(item.get("cancelled") for item in final["results"])


def test_ai_evaluate_async_job_can_be_cancelled(monkeypatch) -> None:
    from photo_calibrator.backend import simple_server

    class SlowAIService:
        def evaluate(self, *args, **kwargs):
            time.sleep(0.05)
            from photo_calibrator.services.contracts import EvaluationResult

            return EvaluationResult(overall_score=0.5)

        def evaluate_with_provider(self, *args, **kwargs):
            return self.evaluate(*args, **kwargs)

    monkeypatch.setattr(simple_server, "_AI_EVALUATION_SERVICE", SlowAIService())
    job = simple_server._ai_evaluate_payload(
        {
            "async": True,
            "image_data": sample_data_url(),
            "file_name": "async-ai.png",
            "context": "portrait",
        }
    )
    simple_server._batch_cancel_payload({"job_id": job["job_id"]})

    final = None
    for _ in range(50):
        status = simple_server._batch_status_payload({"job_id": [job["job_id"]]})
        if status["done"]:
            final = status
            break
        time.sleep(0.01)
    assert final is not None
    assert final["state"] == "cancelled"
    assert final["cancelled"] is True
    if final["results"]:
        assert final["results"][-1].get("cancelled") is True


# ---------------------------------------------------------------------------
# Server error path coverage tests
# ---------------------------------------------------------------------------


def test_export_bad_format_raises() -> None:
    from photo_calibrator.backend.simple_server import _export_payload

    with pytest.raises(ValueError, match="Unsupported export format"):
        _export_payload({
            "image_data": sample_data_url(),
            "output_path": "/tmp/test.xyz",
            "format": "badformat",
        })


def test_calibrate_session_expired_or_missing() -> None:
    from photo_calibrator.backend.simple_server import _calibrate_session_payload

    with pytest.raises(ValueError, match="expired"):
        _calibrate_session_payload({"session_id": "__dead__"})


def test_analyze_missing_data_url_key() -> None:
    from photo_calibrator.backend.simple_server import _handle_analyze

    with pytest.raises(KeyError):
        _handle_analyze({})


# ── _calibration_params_from_body tests ───────────────────────────────

def test_params_from_body_extracts_curve_fields() -> None:
    from photo_calibrator.backend.simple_server import _calibration_params_from_body
    from photo_calibrator.core.calibration import CalibrationMode

    body = {
        "mode": "rgb-curves",
        "strength": 0.5,
        "r_curve": [[0, 0], [128, 140], [255, 255]],
        "g_curve": [[0, 0], [64, 64], [128, 128], [192, 192], [255, 255]],
        "b_curve": [[0, 0], [128, 116], [255, 255]],
    }
    params = _calibration_params_from_body(body)
    assert params.mode == CalibrationMode.RGB_CURVES
    assert params.r_curve == [[0.0, 0.0], [128.0, 140.0], [255.0, 255.0]]
    assert params.g_curve == [[0.0, 0.0], [64.0, 64.0], [128.0, 128.0], [192.0, 192.0], [255.0, 255.0]]
    assert params.b_curve == [[0.0, 0.0], [128.0, 116.0], [255.0, 255.0]]
    assert params.strength == 0.5


def test_params_from_body_empty_curves_are_none() -> None:
    from photo_calibrator.backend.simple_server import _calibration_params_from_body

    params = _calibration_params_from_body({"mode": "global"})
    assert params.r_curve is None
    assert params.g_curve is None
    assert params.b_curve is None


def test_params_from_body_extracts_all_fields() -> None:
    from photo_calibrator.backend.simple_server import _calibration_params_from_body
    from photo_calibrator.core.calibration import CalibrationMode

    body = {
        "mode": "matrix",
        "a_shift": 2.5,
        "b_shift": -1.5,
        "strength": 0.9,
        "curve_low_pct": 2.0,
        "curve_high_pct": 98.0,
        "gamma": [1.1, 1.0, 0.9],
        "matrix": [[1.0, 1, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
        "lut_size": 33,
    }
    params = _calibration_params_from_body(body)
    assert params.a_shift == 2.5
    assert params.b_shift == -1.5
    assert params.gamma == (1.1, 1.0, 0.9)
    assert params.lut_size == 33
    assert params.curve_low_pct == 2.0
    assert params.curve_high_pct == 98.0


def test_params_from_body_invalid_curve_returns_none() -> None:
    from photo_calibrator.backend.simple_server import _calibration_params_from_body

    params = _calibration_params_from_body({"mode": "rgb-curves", "r_curve": "bad"})
    assert params.r_curve is None

    params2 = _calibration_params_from_body({"mode": "rgb-curves", "r_curve": [[1, 2, 3]]})
    assert params2.r_curve is None


def test_workspace_open_restores_committed_state_and_invalidates_modified_file(tmp_path: Path) -> None:
    image_path = tmp_path / "photo.png"
    image = np.full((32, 32, 3), (160, 130, 100), dtype=np.uint8)
    assert cv2.imwrite(str(image_path), cv2.cvtColor(image, cv2.COLOR_RGB2BGR))

    first_open = _workspace_open_payload({"workspace_root": str(tmp_path), "paths": [str(image_path)]})
    assert first_open["files"][0]["status"] == "fresh"

    calibration = _calibrate_payload({"path": str(image_path), "mode": "global", "strength": 0.7})
    before_state = {"mode": "global", "strength": 0.8, "accelerator": "auto", "curves": {"l": [[0, 0], [255, 255]], "r": [[0, 0], [255, 255]], "g": [[0, 0], [255, 255]], "b": [[0, 0], [255, 255]]}}
    after_state = {**before_state, "strength": 0.7, "runtimeSessionId": calibration["session_id"]}
    committed = _history_commit_payload({
        "workspace_root": str(tmp_path),
        "source_path": str(image_path),
        "persistent_session_id": "workspace-photo",
        "description": "strength",
        "action_type": "strength",
        "before_state": before_state,
        "after_state": after_state,
        "calibrated_image": calibration["calibrated_image"],
    })
    assert committed["history_cursor"] == 0

    restored = _workspace_open_payload({"workspace_root": str(tmp_path), "paths": [str(image_path)]})["files"][0]
    assert restored["status"] == "restored"
    assert restored["state"]["strength"] == 0.7
    assert restored["calibrated_image"].startswith("data:image/jpeg;base64,")

    undone = _history_move_payload({"workspace_root": str(tmp_path), "persistent_session_id": "workspace-photo"}, -1)
    assert undone["state"]["strength"] == 0.8

    time.sleep(0.01)
    image_path.write_bytes(image_path.read_bytes() + b"changed")
    modified = _workspace_open_payload({"workspace_root": str(tmp_path), "paths": [str(image_path)]})["files"][0]
    assert modified["status"] == "modified"
    assert "state" not in modified
