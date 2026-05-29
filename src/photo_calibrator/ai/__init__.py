"""AI evaluation subsystem.

Provides a provider-agnostic interface for AI-powered calibration
quality assessment.  Plugins implement the ``AIEvaluatorHook`` protocol
from ``photo_calibrator.plugins.hooks``.

Architecture:
    evaluators.py — input/output data schemas (EvalInput, EvalOutput)
    prompts.py   — reusable prompt templates (provider-agnostic)
    providers.py — AIProvider implementations (OpenAI-compatible + mock)
"""

from photo_calibrator.ai.evaluators import EvalImageRef, EvalInput, EvalOutput, EvalScore
from photo_calibrator.ai.providers import (
    AIProvider,
    MockProvider,
    OpenAICompatibleProvider,
    ProviderConfig,
)

__all__ = [
    "EvalImageRef",
    "EvalInput",
    "EvalOutput",
    "EvalScore",
    "AIProvider",
    "MockProvider",
    "OpenAICompatibleProvider",
    "ProviderConfig",
]
