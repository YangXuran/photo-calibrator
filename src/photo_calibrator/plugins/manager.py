"""Plugin manager: discovery, loading, and lifecycle.

Discovers plugins by scanning directories for ``plugin.json`` manifests,
validates them, imports the entry point module, and registers instances.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from typing import Any

from .api import (
    MANIFEST_FILE,
    RegisteredPlugin,
    get_builtin_plugins,
    validate_manifest,
)
from .hooks import HOOK_REGISTRY


class PluginManager:
    """Discovers, validates, and loads plugins."""

    def __init__(self, search_paths: list[Path] | None = None):
        self._search_paths = search_paths or []
        self._plugins: dict[str, RegisteredPlugin] = {}
        self._by_hook: dict[str, list[RegisteredPlugin]] = {h: [] for h in HOOK_REGISTRY}

    # ── Discovery ───────────────────────────────────────────────

    def discover(
        self,
        *extra_paths: Path,
        load_builtins: bool = True,
    ) -> list[str]:
        """Scan paths for plugin.json manifests and load plugins.

        Returns list of plugin IDs successfully loaded.
        """
        loaded: list[str] = []

        if load_builtins:
            loaded.extend(self._load_builtins())

        all_paths = list(self._search_paths) + list(extra_paths)
        for base in all_paths:
            for manifest_path in base.rglob(f"*/{MANIFEST_FILE}"):
                plugin_dir = manifest_path.parent
                pid = self._load_plugin(plugin_dir)
                if pid:
                    loaded.append(pid)

        return loaded

    def _load_builtins(self) -> list[str]:
        """Instantiate and register all builtin plugin classes."""
        # Ensure builtin modules are imported so decorators fire
        _import_builtins()

        loaded: list[str] = []
        for cls_name, cls in get_builtin_plugins().items():
            try:
                instance = cls()
                pid = f"builtin.{cls_name.lower()}"
                hook_types = _find_hooks(instance)
                self._register(
                    pid,
                    instance,
                    hook_types=hook_types,
                )
                loaded.append(pid)
            except Exception:
                continue
        return loaded

    def _load_plugin(self, plugin_dir: Path) -> str | None:
        """Load a single plugin from a directory containing plugin.json."""
        manifest_path = plugin_dir / MANIFEST_FILE
        try:
            raw = json.loads(manifest_path.read_text())
        except (json.JSONDecodeError, OSError):
            return None

        manifest, errors = validate_manifest(raw)
        if manifest is None:
            return None

        entry = plugin_dir / manifest.entry_point
        if not entry.exists():
            return None

        instance = self._import_and_instantiate(manifest.id, entry)
        if instance is None:
            return None

        # Verify the instance actually implements the declared hooks
        hook_types = _find_hooks(instance)
        declared = set(manifest.hooks)
        if not declared.issubset(hook_types):
            return None

        self._register(manifest.id, instance, hook_types=hook_types, manifest=manifest, path=plugin_dir)
        return manifest.id

    # ── Registration ────────────────────────────────────────────

    def _register(
        self,
        plugin_id: str,
        instance: Any,
        hook_types: set[str],
        manifest: Any = None,
        path: Path | None = None,
    ) -> None:
        """Register a plugin instance."""
        rp = RegisteredPlugin(
            manifest=manifest,
            instance=instance,
            path=path or Path(),
        )
        self._plugins[plugin_id] = rp
        for ht in hook_types:
            if ht in self._by_hook:
                self._by_hook[ht].append(rp)

    # ── Import helper ───────────────────────────────────────────

    def _import_and_instantiate(self, plugin_id: str, module_path: Path) -> Any | None:
        """Import a plugin module and return an instance of its main class."""
        # Ensure the project source is importable by external plugins
        _ensure_project_on_path()

        spec = importlib.util.spec_from_file_location(
            f"photo_calibrator.plugins.user.{plugin_id.replace('.', '_')}",
            str(module_path),
        )
        if spec is None or spec.loader is None:
            return None
        mod = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = mod
        try:
            spec.loader.exec_module(mod)
        except Exception:
            return None

        # Find the first class that matches a known hook
        for name in dir(mod):
            obj = getattr(mod, name)
            if not isinstance(obj, type):
                continue
            # Skip Protocol/ABC classes and imported types
            if obj.__module__ != mod.__name__:
                continue
            if getattr(obj, "_is_protocol", False):
                continue
            try:
                instance = obj()
            except Exception:
                continue
            if _find_hooks(instance):
                return instance
        return None

    # ── Query ──────────────────────────────────────────────────

    def get(self, plugin_id: str) -> RegisteredPlugin | None:
        """Get a plugin by ID."""
        return self._plugins.get(plugin_id)

    def list(self) -> list[str]:
        """List all registered plugin IDs."""
        return list(self._plugins.keys())

    def list_for_hook(self, hook_name: str) -> list[RegisteredPlugin]:
        """List plugins registered for a specific hook."""
        return self._by_hook.get(hook_name, [])


# ── Helpers ─────────────────────────────────────────────────────────


def _find_hooks(instance: Any) -> set[str]:
    """Check which hook protocols an object conforms to."""
    found: set[str] = set()
    for name, proto in HOOK_REGISTRY.items():
        if isinstance(instance, proto):
            found.add(name)
    return found


def _import_builtins() -> None:
    """Import builtin plugin modules so @register_builtin decorators fire."""
    try:
        from photo_calibrator.plugins.builtin import noop  # noqa: F401
    except ImportError:
        pass


def _ensure_project_on_path() -> None:
    """Ensure the project src directory is on sys.path for plugin imports."""
    import photo_calibrator

    src_dir = str(Path(photo_calibrator.__file__).parent.parent)
    if src_dir not in sys.path:
        sys.path.insert(0, src_dir)
