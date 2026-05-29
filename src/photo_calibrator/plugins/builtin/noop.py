"""Builtin stub plugins.

These are no-op implementations that demonstrate the plugin API and
serve as fallbacks when no external plugins are loaded.
"""

from __future__ import annotations

from typing import Any

from photo_calibrator.plugins import hooks
from photo_calibrator.plugins.api import register_builtin


@register_builtin("analyzer")
class NoopAnalyzer:
    """Builtin analyzer that returns empty metrics — a safe fallback."""

    @property
    def analyzer_name(self) -> str:
        return "noop"

    def analyze(self, image: Any, **kwargs: Any) -> dict[str, Any]:
        return {"name": "noop", "metrics": {}}


@register_builtin("ai_evaluator")
class NoopAIEvaluator:
    """Builtin no-op AI evaluator — returns neutral scores.

    This ensures the AI evaluation pipeline always has a fallback
    that doesn't require network access.
    """

    @property
    def evaluator_name(self) -> str:
        return "noop"

    @property
    def requires_network(self) -> bool:
        return False

    def evaluate(
        self,
        original: Any,
        calibrated: Any,
        analysis: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        return {
            "score": 0.5,
            "reasoning": "No AI evaluator configured — using builtin no-op.",
            "suggestions": [],
            "metadata": {"evaluator": "noop"},
        }
