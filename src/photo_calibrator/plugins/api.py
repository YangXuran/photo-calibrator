"""Plugin manifest validation and registration API.

Plugins are discovered via ``plugin.json`` manifest files in
``photo_calibrator/plugins/``.  The manifest declares which hooks the
plugin implements and any permissions it requires.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .hooks import HOOK_REGISTRY

MANIFEST_FILE = "plugin.json"

# ── Data model ──────────────────────────────────────────────────────


@dataclass(frozen=True)
class PluginManifest:
    """Validated plugin manifest."""

    id: str
    name: str
    version: str
    api_version: str
    hooks: list[str]
    permissions: list[str] = field(default_factory=list)
    description: str = ""
    author: str = ""
    entry_point: str = "plugin.py"


@dataclass(frozen=True)
class ManifestError:
    """Validation error for a manifest field."""

    field: str
    message: str


@dataclass
class RegisteredPlugin:
    """A loaded and validated plugin ready for use."""

    manifest: PluginManifest
    instance: Any
    path: Path


# ── Manifest validation ─────────────────────────────────────────────


def validate_manifest(raw: dict[str, Any]) -> tuple[PluginManifest | None, list[ManifestError]]:
    """Validate a raw plugin.json dict.

    Returns (manifest, errors).  manifest is None if validation failed.
    """
    errors: list[ManifestError] = []

    # Required string fields
    for field in ["id", "name", "version", "api_version"]:
        val = raw.get(field)
        if not isinstance(val, str) or not val.strip():
            errors.append(ManifestError(field, f"'{field}' is required and must be a non-empty string"))
            continue

    # id must be lowercase with dots/underscores/hyphens
    pid = raw.get("id", "")
    if pid and not _is_valid_plugin_id(pid):
        errors.append(ManifestError("id", f"'{pid}' is not a valid plugin id (use lowercase, dots, underscores, hyphens)"))

    # hooks must be a non-empty list of known hook names
    hooks = raw.get("hooks", [])
    if not isinstance(hooks, list) or len(hooks) == 0:
        errors.append(ManifestError("hooks", "'hooks' must be a non-empty list"))
    else:
        for h in hooks:
            if h not in HOOK_REGISTRY:
                errors.append(ManifestError("hooks", f"unknown hook type: '{h}'"))

    # permissions must be a list of strings (can be empty)
    perms = raw.get("permissions", [])
    if not isinstance(perms, list):
        errors.append(ManifestError("permissions", "'permissions' must be a list"))

    # entry_point must be a relative .py file
    ep = raw.get("entry_point", "plugin.py")
    if not isinstance(ep, str) or not ep.endswith(".py"):
        errors.append(ManifestError("entry_point", f"'{ep}' must be a .py filename"))

    if errors:
        return None, errors

    return PluginManifest(
        id=pid,
        name=raw["name"],
        version=raw["version"],
        api_version=raw["api_version"],
        hooks=hooks,
        permissions=perms,
        description=raw.get("description", ""),
        author=raw.get("author", ""),
        entry_point=ep,
    ), []


def _is_valid_plugin_id(pid: str) -> bool:
    """Check plugin id format: lowercase, dots, underscores, hyphens only."""
    return all(c.islower() or c in "._-" for c in pid) and len(pid) <= 128


# ── Builtin registration helpers ────────────────────────────────────


_BUILTIN_PLUGINS: dict[str, type] = {}


def register_builtin(hook_type: str):
    """Decorator to register a builtin plugin class.

    Usage::

        @register_builtin("analyzer")
        class MyAnalyzer:
            ...
    """
    if hook_type not in HOOK_REGISTRY:
        raise ValueError(f"Unknown hook type: {hook_type}")

    def decorator(cls):
        _BUILTIN_PLUGINS[cls.__name__] = cls
        return cls
    return decorator


def get_builtin_plugins() -> dict[str, type]:
    """Return all registered builtin plugin classes."""
    return dict(_BUILTIN_PLUGINS)
