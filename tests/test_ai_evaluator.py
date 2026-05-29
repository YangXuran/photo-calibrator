"""Tests for the AI evaluator schema and prompt templates."""

from __future__ import annotations

from photo_calibrator.ai import EvalImageRef, EvalInput, EvalOutput, EvalScore
from photo_calibrator.ai.prompts import calibration_eval, quick_eval


# ── Schema tests ────────────────────────────────────────────────────


def test_eval_image_ref_creation() -> None:
    """EvalImageRef should accept the expected fields."""
    ref = EvalImageRef(key="abc123", width=800, height=600, source="original")
    assert ref.key == "abc123"
    assert ref.width == 800
    assert ref.source == "original"


def test_eval_input_construction() -> None:
    """EvalInput should accept original + calibrated refs and optional fields."""
    original = EvalImageRef(key="orig")
    calibrated = EvalImageRef(key="calib")
    input = EvalInput(
        original=original,
        calibrated=calibrated,
        calibration_params={"mode": "global", "strength": 0.8},
        context="portrait",
    )
    assert input.original.key == "orig"
    assert input.calibrated.key == "calib"
    assert input.calibration_params == {"mode": "global", "strength": 0.8}


def test_eval_output_with_scores() -> None:
    """EvalOutput should hold scores, reasoning, and suggestions."""
    output = EvalOutput(
        overall_score=0.75,
        scores=[
            EvalScore(dimension="skin_tone", score=0.8, comment="warm but natural"),
            EvalScore(dimension="white_balance", score=0.6, comment="slight blue cast"),
        ],
        reasoning="Good overall, minor WB issue.",
        suggestions=["Reduce b* by 0.3"],
        warnings=["Low confidence — no reference image provided"],
    )
    assert output.overall_score == 0.75
    assert len(output.scores) == 2
    assert output.is_confident


def test_eval_output_is_confident_detects_low_confidence() -> None:
    """is_confident should be False when reasoning is empty/short."""
    output = EvalOutput(overall_score=0.0, reasoning="")
    assert not output.is_confident


def test_eval_score_accepts_1to5_scale() -> None:
    """EvalScore should support both 0-1 and 1-5 scales."""
    score = EvalScore(dimension="sharpness", score=4.0, scale="1-5", comment="Very sharp")
    assert score.scale == "1-5"
    assert score.score == 4.0


# ── Prompt template tests ───────────────────────────────────────────


def test_calibration_eval_prompt_contains_keywords() -> None:
    """The calibration eval prompt should include expected dimensions."""
    ref = EvalImageRef(key="test")
    input = EvalInput(original=ref, calibrated=ref, context="landscape")

    msgs = calibration_eval(input)
    assert len(msgs) == 2  # system + user

    system = msgs[0]["content"]
    assert "skin_tone" in system
    assert "white_balance" in system
    assert "overall_naturalness" in system

    user = msgs[1]["content"]
    assert "landscape" in user


def test_quick_eval_prompt_is_shorter() -> None:
    """Quick eval should produce a shorter prompt than full eval."""
    ref = EvalImageRef(key="test")
    input = EvalInput(original=ref, calibrated=ref)

    full = calibration_eval(input)
    quick = quick_eval(input)

    full_len = sum(len(m["content"]) for m in full)
    quick_len = sum(len(m["content"]) for m in quick)
    assert quick_len < full_len


def test_prompt_includes_calibration_params() -> None:
    """If calibration_params are provided, they appear in the prompt."""
    ref = EvalImageRef(key="test")
    input = EvalInput(
        original=ref,
        calibrated=ref,
        calibration_params={"mode": "skin-protect", "strength": 0.5},
    )
    msgs = calibration_eval(input)
    user = msgs[1]["content"]
    assert "skin-protect" in user
    assert "0.5" in user
