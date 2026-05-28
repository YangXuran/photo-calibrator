"""API request/response data models for the Photo Calibrator backend.

Extracted from simple_server.py to keep concerns separated and make
schemas reusable by pipeline, plugins, and future FastAPI migration.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np


# ---------------------------------------------------------------------------
# Core image processing models (extracted from simple_server.py)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PreparedImage:
    """Analysis-resolution image ready for calibration."""

    image: np.ndarray
    original_width: int
    original_height: int
    analysis_width: int
    analysis_height: int
    downsample_ratio: float
    source_dtype: str
    preview_source: str


@dataclass(frozen=True)
class AnalysisEntry:
    """Cached analysis result for a single image."""

    prepared: PreparedImage
    input_report: object
    zones: dict
    static_charts: dict
    cache_key: str
    created_at: float


# ---------------------------------------------------------------------------
# API request models
# ---------------------------------------------------------------------------


@dataclass
class CalibrateRequest:
    """POST /api/calibrate, /api/calibrate-session, /api/calibrate-path"""

    image_data: str | None = None
    file_name: str = ""
    mode: str = "global"
    strength: float = 0.8
    highlight_pct: float = 55.0
    sat_pct: float = 25.0
    analysis_max_side: int = 1800
    session_id: str | None = None
    include_original: bool = True
    path: str | None = None


@dataclass
class ExportRequest:
    """POST /api/export"""

    image_data: str = ""
    file_name: str = ""
    mode: str = "global"
    strength: float = 0.8
    output_path: str = ""
    format: str = "jpeg"
    quality: int = 92


@dataclass
class BatchRequest:
    """POST /api/calibrate-batch"""

    items: list[dict] = field(default_factory=list)
    mode: str = "global"
    strength: float = 0.8
    analysis_max_side: int = 1800
    workers: int = 2


@dataclass
class PathsRequest:
    """POST /api/calibrate-paths"""

    paths: list[str] = field(default_factory=list)
    mode: str = "global"
    strength: float = 0.8
    analysis_max_side: int = 1800
    workers: int = 2


@dataclass
class SidecarSaveRequest:
    """POST /api/sidecar/save"""

    path: str = ""
    calibration: dict = field(default_factory=dict)
    algorithm_version: str = "0.2.0"
    input_metadata: dict | None = None


@dataclass
class SidecarLoadRequest:
    """GET /api/sidecar/load"""

    path: str = ""


@dataclass
class CacheStats:
    """GET /api/cache/stats response"""

    items: int = 0
    limit: int = 16
    ttl_seconds: int = 3600
    oldest_age_seconds: float = 0.0


@dataclass
class BatchStatus:
    """GET /api/batch/status response"""

    batch_id: str = ""
    total: int = 0
    completed: int = 0
    cancelled: bool = False
