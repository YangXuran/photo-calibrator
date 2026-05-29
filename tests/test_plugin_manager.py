"""Tests for the plugin system: manifest validation, manager, builtins."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import pytest

from photo_calibrator.plugins import PluginManager
from photo_calibrator.plugins.api import (
    ManifestError,
    get_builtin_plugins,
    validate_manifest,
)
from photo_calibrator.plugins.hooks import AnalyzerHook, HOOK_REGISTRY


# ── Manifest validation ─────────────────────────────────────────────


def test_valid_manifest_passes() -> None:
    """A well-formed manifest should validate successfully."""
    raw = {
        "id": "example.analyzer",
        "name": "Example Analyzer",
        "version": "0.1.0",
        "api_version": "0.1",
        "hooks": ["analyzer"],
        "permissions": [],
    }
    manifest, errors = validate_manifest(raw)
    assert manifest is not None
    assert len(errors) == 0
    assert manifest.id == "example.analyzer"
    assert manifest.hooks == ["analyzer"]


def test_missing_required_fields_fails() -> None:
    """Missing 'id' or 'hooks' should produce errors."""
    _, errors = validate_manifest({"name": "Test"})
    assert len(errors) > 0
    field_names = {e.field for e in errors}
    assert "id" in field_names or "hooks" in field_names


def test_unknown_hook_type_fails() -> None:
    """A hook type not in HOOK_REGISTRY should be rejected."""
    raw = {
        "id": "bad.hook",
        "name": "Bad",
        "version": "0.1",
        "api_version": "0.1",
        "hooks": ["not_a_real_hook"],
    }
    manifest, errors = validate_manifest(raw)
    assert manifest is None
    assert any("unknown hook" in e.message for e in errors)


def test_invalid_plugin_id_format_fails() -> None:
    """Plugin id must be lowercase with dots/underscores/hyphens."""
    raw = {
        "id": "Bad Plugin ID!!!",
        "name": "Bad",
        "version": "0.1",
        "api_version": "0.1",
        "hooks": ["analyzer"],
    }
    manifest, errors = validate_manifest(raw)
    assert manifest is None
    assert any("id" == e.field for e in errors)


def test_entry_point_must_be_py_file() -> None:
    """entry_point must end with .py."""
    raw = {
        "id": "test.plugin",
        "name": "Test",
        "version": "0.1",
        "api_version": "0.1",
        "hooks": ["analyzer"],
        "entry_point": "not_a_python_file.txt",
    }
    _, errors = validate_manifest(raw)
    assert any("entry_point" == e.field for e in errors)


# ── Builtin plugins ─────────────────────────────────────────────────


def test_builtin_plugins_registered() -> None:
    """Builtin noop plugins should be auto-discovered via the manager."""
    mgr = PluginManager()
    mgr.discover(load_builtins=True)
    builtins = get_builtin_plugins()
    assert len(builtins) >= 2  # NoopAnalyzer + NoopAIEvaluator


def test_builtin_analyzer_conforms_to_protocol() -> None:
    """The builtin noop analyzer must implement AnalyzerHook."""
    mgr = PluginManager()
    mgr.discover(load_builtins=True)
    builtins = get_builtin_plugins()
    analyzer_cls = builtins.get("NoopAnalyzer")
    assert analyzer_cls is not None
    instance = analyzer_cls()
    assert isinstance(instance, AnalyzerHook)
    result = instance.analyze(None)
    assert "metrics" in result


def test_builtins_load_via_manager() -> None:
    """PluginManager.discover() should load builtins automatically."""
    mgr = PluginManager()
    mgr.discover(load_builtins=True)
    ids = mgr.list()
    assert any("noop" in pid for pid in ids)


# ── Plugin manager ──────────────────────────────────────────────────


def test_manager_empty_by_default() -> None:
    """A new manager has no plugins before discovery."""
    mgr = PluginManager()
    assert len(mgr.list()) == 0


def test_manager_list_for_hook() -> None:
    """list_for_hook should return plugins implementing a specific hook."""
    mgr = PluginManager()
    mgr.discover(load_builtins=True)
    analyzers = mgr.list_for_hook("analyzer")
    assert len(analyzers) >= 1


def test_load_external_plugin_from_temp_dir() -> None:
    """An external plugin directory with a valid manifest should be loadable."""

    with tempfile.TemporaryDirectory() as tmp:
        plugin_dir = Path(tmp) / "my_plugin"
        plugin_dir.mkdir()

        # Write manifest
        manifest = {
            "id": "test.external",
            "name": "External Test",
            "version": "0.1.0",
            "api_version": "0.1",
            "hooks": ["analyzer"],
        }
        (plugin_dir / "plugin.json").write_text(json.dumps(manifest))

        # Write plugin.py
        (plugin_dir / "plugin.py").write_text("""
from photo_calibrator.plugins.hooks import AnalyzerHook

class TestAnalyzer:
    @property
    def analyzer_name(self):
        return "test-external"

    def analyze(self, image, **kwargs):
        return {"name": "test-external", "metrics": {"custom": 42}}
""")

        mgr = PluginManager()
        loaded = mgr.discover(Path(tmp), load_builtins=False)
        assert "test.external" in loaded

        analyzers = mgr.list_for_hook("analyzer")
        external = [p for p in analyzers if p.instance.analyzer_name == "test-external"]
        assert len(external) == 1
        result = external[0].instance.analyze(None)
        assert result["metrics"]["custom"] == 42
