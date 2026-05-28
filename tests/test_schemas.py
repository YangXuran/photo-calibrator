"""Unit tests for backend schemas."""

from __future__ import annotations

import numpy as np
import pytest

from photo_calibrator.backend.schemas import (
    AnalysisEntry,
    BatchRequest,
    BatchStatus,
    CacheStats,
    CalibrateRequest,
    ExportRequest,
    PathsRequest,
    PreparedImage,
    SidecarSaveRequest,
)


def test_prepared_image_construction() -> None:
    img = np.zeros((100, 200, 3), dtype=np.uint8)
    pi = PreparedImage(
        image=img,
        original_width=400,
        original_height=200,
        analysis_width=200,
        analysis_height=100,
        downsample_ratio=0.5,
        source_dtype="uint8",
        preview_source="raw-embedded-jpeg",
    )
    assert pi.original_width == 400
    assert pi.original_height == 200
    assert pi.analysis_width == 200
    assert pi.analysis_height == 100
    assert pi.downsample_ratio == 0.5
    assert pi.source_dtype == "uint8"
    assert pi.preview_source == "raw-embedded-jpeg"
    assert np.array_equal(pi.image, img)


def test_analysis_entry_construction() -> None:
    img = np.zeros((64, 64, 3), dtype=np.uint8)
    prepared = PreparedImage(
        image=img,
        original_width=64,
        original_height=64,
        analysis_width=64,
        analysis_height=64,
        downsample_ratio=1.0,
        source_dtype="uint8",
        preview_source="opencv-decode",
    )
    entry = AnalysisEntry(
        prepared=prepared,
        input_report={"fake": True},
        zones={"global": {"a_mean": 0.0, "b_mean": 0.0}},
        static_charts={},
        cache_key="test-key",
        created_at=12345.0,
    )
    assert entry.cache_key == "test-key"
    assert entry.created_at == 12345.0
    assert entry.input_report == {"fake": True}


def test_calibrate_request_defaults() -> None:
    req = CalibrateRequest()
    assert req.mode == "global"
    assert req.strength == 0.8
    assert req.analysis_max_side == 1800
    assert req.include_original is True
    assert req.image_data is None


def test_export_request_defaults() -> None:
    req = ExportRequest()
    assert req.format == "jpeg"
    assert req.quality == 92
    assert req.mode == "global"
    assert req.strength == 0.8


def test_batch_request_items_default() -> None:
    req = BatchRequest()
    assert req.items == []
    assert req.workers == 2


def test_paths_request_paths_default() -> None:
    req = PathsRequest()
    assert req.paths == []
    assert req.workers == 2


def test_sidecar_save_request() -> None:
    req = SidecarSaveRequest(
        path="/tmp/test.calib.json",
        calibration={"mode": "global", "a_shift": -1.0, "b_shift": 2.0},
        algorithm_version="0.3.0",
    )
    assert req.path == "/tmp/test.calib.json"
    assert req.calibration["mode"] == "global"
    assert req.algorithm_version == "0.3.0"


def test_cache_stats_defaults() -> None:
    stats = CacheStats()
    assert stats.items == 0
    assert stats.limit == 16
    assert stats.ttl_seconds == 3600
    assert stats.oldest_age_seconds == 0.0


def test_batch_status() -> None:
    status = BatchStatus(batch_id="abc123", total=10, completed=5, cancelled=False)
    assert status.batch_id == "abc123"
    assert status.total == 10
    assert status.completed == 5
    assert status.cancelled is False
