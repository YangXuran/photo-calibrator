"""AI evaluator: provider-agnostic input/output schema.

Defines the data contract between the application and any AI evaluator
plugin.  Evaluators receive structured input and return structured output
without directly mutating images or pipeline state.

All fields are JSON-serializable so they can pass through HTTP/IPC.
"""

from __future__ import annotations

from dataclasses import dataclass, field


# ── Input schema ────────────────────────────────────────────────────


@dataclass(frozen=True)
class EvalImageRef:
    """Reference to an image for AI evaluation.

    The actual pixel data is NOT passed here — only metadata and a
    reference key that the evaluator can resolve through the backend.
    """

    key: str
    """Unique key for this image (e.g. cache key or session_id).

    The evaluator resolves the actual image data through the backend API,
    keeping the AI layer decoupled from pixel buffers.
    """

    width: int = 0
    height: int = 0
    color_space: str = "sRGB"
    source: str = ""
    """Label: 'original', 'calibrated', 'reference', etc."""


@dataclass(frozen=True)
class EvalInput:
    """Structured input for an AI calibration evaluation.

    The evaluator plugin receives this and returns an ``EvalOutput``.
    """

    original: EvalImageRef
    calibrated: EvalImageRef
    reference: EvalImageRef | None = None
    """Optional reference image (e.g. ground truth or target)."""

    analysis: dict | None = None
    """Optional dict of pre-computed metrics (from builtin analyzer)."""

    calibration_params: dict | None = None
    """Optional dict of calibration parameters used (mode, strength, etc.)."""

    context: str = ""
    """Optional free-form context string (e.g. 'wedding photo', 'landscape')."""


# ── Output schema ───────────────────────────────────────────────────


@dataclass(frozen=True)
class EvalScore:
    """A single scored dimension."""

    dimension: str
    """e.g. 'skin_tone', 'white_balance', 'overall_naturalness'."""

    score: float
    """0.0–1.0 or 1–5 depending on scale."""

    scale: str = "0-1"
    """'0-1' or '1-5'."""

    comment: str = ""


@dataclass(frozen=True)
class EvalOutput:
    """Structured output from an AI calibration evaluation.

    This is what the evaluator plugin returns.  The backend/pipeline
    displays it in the UI but does NOT auto-apply any changes.
    """

    overall_score: float
    """0.0–1.0 composite score."""

    scores: list[EvalScore] = field(default_factory=list)
    """Per-dimension scores."""

    reasoning: str = ""
    """Natural language explanation of the evaluation."""

    suggestions: list[str] = field(default_factory=list)
    """Actionable suggestions, e.g. 'skin tone slightly warm — reduce a* by 1.5'."""

    warnings: list[str] = field(default_factory=list)
    """Risks or caveats about the evaluation."""

    metadata: dict = field(default_factory=dict)
    """Provider-specific metadata (model name, tokens used, latency, etc.)."""

    @property
    def is_confident(self) -> bool:
        """Whether the evaluator had enough information for a reliable assessment."""
        return self.overall_score >= 0.0 and len(self.reasoning) > 10
