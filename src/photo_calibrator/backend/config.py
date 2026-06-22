from __future__ import annotations

import json
import os
import sys
from pathlib import Path


def _config_path() -> Path:
    override = os.environ.get("PHOTO_CALIBRATOR_CONFIG_PATH")
    if override:
        return Path(override).expanduser()
    if sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
    return base / "Photo Calibrator" / "config.json"


def _defaults() -> dict:
    return {
        "ai": {},
        "preferences": {},
        "viewer_state": {},
        "inspector_tab": "adjust",
    }


def load_config() -> dict:
    path = _config_path()
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return _defaults()
    config = _defaults()
    if isinstance(raw, dict):
        config.update(raw)
    if not isinstance(config.get("ai"), dict):
        config["ai"] = {}
    return config


def save_config(config: dict) -> None:
    path = _config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)
