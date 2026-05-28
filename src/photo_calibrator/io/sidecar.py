"""Calibration sidecar JSON — save/load calibration parameters."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SIDECAR_VERSION = "0.2.0"


def write_sidecar_json(
    path: str | Path,
    calibration_params: dict[str, Any],
    algorithm_version: str = SIDECAR_VERSION,
    input_metadata: dict[str, Any] | None = None,
) -> None:
    """Write calibration sidecar JSON file."""
    path = Path(path)
    doc: dict[str, Any] = {
        "sidecar_version": SIDECAR_VERSION,
        "algorithm_version": algorithm_version,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "calibration": calibration_params,
    }
    if input_metadata:
        doc["input_metadata"] = input_metadata

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, indent=2, ensure_ascii=False), encoding="utf-8")


def read_sidecar_json(path: str | Path) -> dict[str, Any]:
    """Read calibration sidecar JSON file."""
    return json.loads(Path(path).read_text(encoding="utf-8"))


def compute_source_fingerprint(path: str | Path) -> str:
    """SHA-256 fingerprint of source file for linking sidecars."""
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()[:32]
