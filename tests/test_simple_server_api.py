from __future__ import annotations

import base64
import json
import sys
import threading
import types
from concurrent.futures import ThreadPoolExecutor
from http.server import ThreadingHTTPServer
from urllib.request import Request, urlopen

import cv2
import numpy as np
import pytest

from photo_calibrator.backend.simple_server import Handler
from photo_calibrator.backend.simple_server import (
    _accelerator_payload,
    _accelerator_benchmark_payload,
    _set_accelerator_payload,
    _calibrate_batch_payload,
    _calibrate_payload,
    _calibrate_path_payload,
    _calibrate_paths_payload,
    _calibrate_session_payload,
    _decode_data_url,
    _prepare_file_for_analysis,
    _prepare_uploaded_image,
)


BACKEND_NAMES = {"cpu-opencv", "opencl-umat", "torch-cuda", "torch-mps", "hybrid-opencl-cuda", "hybrid-opencl-mps"}


def sample_data_url() -> str:
    img = np.zeros((48, 48, 3), dtype=np.uint8)
    img[:, :] = (120, 130, 160)
    img[8:40, 8:40] = (178, 132, 104)
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

    assert payload["calibrated_image"].startswith("data:image/jpeg;base64,")
    assert payload["original_preview"].startswith("data:image/jpeg;base64,")
    assert payload["input"]["lab"]["strength"] >= payload["output"]["lab"]["strength"]
    assert "global" in payload["input"]["zones"]
    assert payload["charts"]["rgb_histogram"]["bins"] == 256
    assert "ccc" in payload["charts"]
    assert "d_sigma" in payload["charts"]["ccc"]
    assert "pci" in payload["charts"]
    assert "neutral_mask" in payload["charts"]
    assert "lab_vectors" in payload["charts"]
    assert payload["input"]["skin"] is not None
    assert any(v["name"] == "肤色" for v in payload["charts"]["lab_vectors"])
    assert "processing" in payload
    assert "opencv_threads" in payload["processing"]
    assert "session_id" in payload
    assert payload["processing"]["accelerator_backend"] in BACKEND_NAMES


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
    assert payload["original_preview"].startswith("data:image/jpeg;base64,")
    assert payload["calibrated_image"].startswith("data:image/jpeg;base64,")


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
    assert all(result["calibrated_image"].startswith("data:image/jpeg;base64,") for result in payload["results"])
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
    assert payload["results"][0]["calibrated_image"].startswith("data:image/jpeg;base64,")


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

    assert prepared.preview_source == "tiff-reduced-decode"
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

    assert first.preview_source == "tiff-reduced-decode"
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
    assert payload["original_preview"].startswith("data:image/jpeg;base64,")


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
    assert all(result["calibrated_image"].startswith("data:image/jpeg;base64,") for result in payload["results"])


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


def test_cache_clear_empties_cache() -> None:
    from photo_calibrator.backend import simple_server

    simple_server._calibrate_payload({
        "image_data": sample_data_url(),
        "file_name": "clear-test.png",
    })
    assert len(simple_server._ANALYSIS_CACHE) >= 1

    result = simple_server._cache_clear_payload()
    assert result["ok"] is True
    assert result["cleared"] >= 1
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


def test_batch_status_unknown_batch_id() -> None:
    from photo_calibrator.backend.simple_server import _batch_status_payload

    result = _batch_status_payload({"batch_id": ["nonexistent"]})
    assert "error" in result


def test_batch_cancel_unknown_batch_id() -> None:
    from photo_calibrator.backend.simple_server import _batch_cancel_payload

    result = _batch_cancel_payload({"batch_id": "nonexistent"})
    assert result["ok"] is True


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
