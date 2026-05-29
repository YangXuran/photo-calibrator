"""Prompt templates for AI calibration evaluation.

Each template is a function that takes an ``EvalInput`` and returns a
list of messages suitable for sending to a multimodal LLM (OpenAI,
Claude, etc.).  Templates are provider-agnostic — the evaluator plugin
is responsible for adapting messages to its specific API format.
"""

from __future__ import annotations

from .evaluators import EvalInput

# ── System prompt ───────────────────────────────────────────────────

_SYSTEM_PROMPT = """\
You are an expert photo colorist and calibration evaluator. Your job is to
assess whether a photo calibration (color correction) improved the image
compared to the original.

Rate the following dimensions:
- **skin_tone** (0-1): Are face/skin tones natural? 0=unhealthy/alien, 1=perfectly natural
- **white_balance** (0-1): Is the overall white balance neutral? 0=strong cast, 1=neutral
- **highlight_preservation** (0-1): Are highlights/whites free of clipping or color casts? 0=clipped, 1=clean
- **shadow_detail** (0-1): Do shadows retain detail and natural color? 0=crushed, 1=detailed
- **overall_naturalness** (0-1): Does the image look natural overall? 0=artificial, 1=natural

Also provide:
- A brief reasoning paragraph (2-3 sentences)
- 1-3 specific suggestions for improvement (if scores < 0.8)
- Any warnings about over-correction or artifacts

CRITICAL: Do NOT suggest edits to the image — only evaluate and advise.
Return your response as valid JSON matching this schema:
{
  "overall_score": 0.75,
  "scores": [
    {"dimension": "skin_tone", "score": 0.8, "comment": "Slightly warm but acceptable"},
    {"dimension": "white_balance", "score": 0.7, "comment": "Mild yellow-green cast remains"},
    {"dimension": "highlight_preservation", "score": 0.85, "comment": "Highlights are clean"},
    {"dimension": "shadow_detail", "score": 0.75, "comment": "Some shadow blocking in bottom-left"},
    {"dimension": "overall_naturalness", "score": 0.78, "comment": "Close to natural, minor WB tweak needed"}
  ],
  "reasoning": "The calibration...",
  "suggestions": ["Reduce b* by 0.5 in midtones to address yellow cast"],
  "warnings": []
}
"""

# ── Template builders ───────────────────────────────────────────────


def calibration_eval(input: EvalInput) -> list[dict]:
    """Build messages for a standard calibration evaluation.

    The caller is responsible for attaching the actual image data to the
    user message (since the format depends on the provider's API).
    """
    context = input.context or "photo"
    params = ""
    if input.calibration_params:
        mode = input.calibration_params.get("mode", "unknown")
        strength = input.calibration_params.get("strength", 0.8)
        params = f"\nCalibration applied: mode={mode}, strength={strength}"

    user = (
        f"Evaluate this {context} calibration.{params}\n\n"
        f"Compare the original image (first) with the calibrated version (second). "
        f"Is the calibrated version an improvement?"
    )

    return [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": user},
    ]


def quick_eval(input: EvalInput) -> list[dict]:
    """Lighter prompt for quick pass/fail check (fewer tokens)."""
    user = (
        "Rate this calibration 0-1 on overall naturalness. "
        "Is the calibrated image (second) better than the original (first)? "
        "Return JSON: {\"overall_score\": 0.X, \"reasoning\": \"...\"}"
    )
    return [
        {"role": "system", "content": "You rate photo calibrations. Return JSON only."},
        {"role": "user", "content": user},
    ]
