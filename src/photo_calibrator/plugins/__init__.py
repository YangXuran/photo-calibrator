"""Photo Calibrator plugin system.

Plugins extend the application with custom image readers, writers,
analyzers, calibrators, film scan detectors, and AI evaluators.

Quick start::

    from photo_calibrator.plugins.manager import PluginManager
    from pathlib import Path

    mgr = PluginManager()
    mgr.discover(Path("my_plugins/"))

    for analyzer in mgr.list_for_hook("analyzer"):
        result = analyzer.instance.analyze(image)

Architecture:
    hooks.py   — protocol definitions (what plugins must implement)
    api.py     — manifest validation, registration decorators
    manager.py — discovery, loading, lifecycle
    builtin/   — bundled stub plugins
"""

from photo_calibrator.plugins.manager import PluginManager

__all__ = ["PluginManager"]
