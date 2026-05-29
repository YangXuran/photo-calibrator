"""AI provider implementations: OpenAI-compatible + mock.

All major local LLM servers (Ollama, llama.cpp, vLLM) expose
``POST /v1/chat/completions``.  ``OpenAICompatibleProvider`` handles
them all with one implementation — just change ``base_url`` and ``model``.

Usage::

    from photo_calibrator.ai.providers import OpenAICompatibleProvider, ProviderConfig

    cfg = ProviderConfig(
        base_url="http://localhost:11434/v1",  # Ollama
        model="llama3.2-vision:11b",
    )
    provider = OpenAICompatibleProvider(cfg)
    result = provider.evaluate(eval_input, [original_img, calibrated_img])
"""

from __future__ import annotations

import json
import ssl
import urllib.request
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from .evaluators import EvalInput, EvalOutput, EvalScore
from .prompts import calibration_eval


# ── Provider config ─────────────────────────────────────────────────


@dataclass(frozen=True)
class ProviderConfig:
    """Configuration for an AI evaluation provider.

    ``base_url`` should end with ``/v1`` for OpenAI-compatible endpoints.
    The requests go to ``{base_url}/chat/completions``.
    """

    base_url: str
    """Endpoint base URL, e.g. ``http://localhost:11434/v1`` (Ollama)."""

    model: str
    """Model name as known by the server, e.g. ``llama3.2-vision:11b``."""

    api_key: str = ""
    """API key for cloud providers.  Local servers typically accept ''."""

    timeout: int = 60

    max_tokens: int = 1024

    temperature: float = 0.3
    """Low temperature for consistent JSON output."""


# ── Base protocol ───────────────────────────────────────────────────


class AIProvider(ABC):
    """Abstract interface for AI calibration evaluation."""

    @abstractmethod
    def evaluate(
        self,
        input: EvalInput,
        images: list[np.ndarray],
    ) -> EvalOutput:
        """Evaluate calibration quality.

        Args:
            input: Structured evaluation request.
            images: Image arrays in RGB uint8. First = original, second = calibrated.

        Returns:
            ``EvalOutput`` with scores, reasoning, and suggestions.
        """
        ...

    @property
    @abstractmethod
    def name(self) -> str:
        """Human-readable provider name."""
        ...


# ── OpenAI-compatible provider ──────────────────────────────────────


class OpenAICompatibleProvider(AIProvider):
    """Calls any ``/v1/chat/completions`` endpoint.

    Tested with: Ollama, llama.cpp server, vLLM, OpenAI, DeepSeek, Groq.
    Supports both vision models (image_url) and text-only models
    (base64 data URL in content).
    """

    def __init__(self, config: ProviderConfig):
        self._config = config

    @property
    def name(self) -> str:
        return f"openai-compatible ({self._config.model})"

    def evaluate(
        self,
        input: EvalInput,
        images: list[np.ndarray],
    ) -> EvalOutput:
        msgs = calibration_eval(input)

        # Inject images into the user message
        user_msg = msgs[1]
        content: list[dict[str, Any]] = [
            {"type": "text", "text": user_msg["content"]},
        ]
        for img in images:
            content.append(_encode_image_content(img))

        payload = {
            "model": self._config.model,
            "messages": [
                {"role": "system", "content": msgs[0]["content"]},
                {"role": "user", "content": content},
            ],
            "temperature": self._config.temperature,
            "max_tokens": self._config.max_tokens,
            "response_format": {"type": "json_object"},
        }

        resp_json = self._post(payload)
        return self._parse_response(resp_json)

    def _post(self, payload: dict) -> dict:
        """POST to /chat/completions, return parsed JSON body."""
        url = f"{self._config.base_url.rstrip('/')}/chat/completions"
        data = json.dumps(payload).encode("utf-8")

        req = urllib.request.Request(
            url,
            data=data,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self._config.api_key}",
            },
            method="POST",
        )

        ctx = ssl.create_default_context()
        try:
            with urllib.request.urlopen(req, timeout=self._config.timeout, context=ctx) as resp:
                body = resp.read().decode("utf-8")
            return json.loads(body)
        except (urllib.error.URLError, urllib.error.HTTPError, OSError) as exc:
            return _error_response(f"API request failed: {exc}")
        except json.JSONDecodeError as exc:
            return _error_response(f"Invalid JSON from server: {exc}")

    def _parse_response(self, resp: dict) -> EvalOutput:
        """Extract structured evaluation from API response."""
        error = resp.get("error")
        if error:
            msg = error if isinstance(error, str) else error.get("message", str(error))
            return EvalOutput(
                overall_score=0.0,
                reasoning=f"Provider error: {msg}",
                metadata={"error": msg},
            )

        choices = resp.get("choices", [])
        if not choices:
            return EvalOutput(
                overall_score=0.0,
                reasoning="Empty response from provider.",
            )

        raw_content = choices[0].get("message", {}).get("content", "")
        try:
            parsed = json.loads(raw_content)
        except json.JSONDecodeError:
            return EvalOutput(
                overall_score=0.0,
                reasoning=f"Could not parse JSON from: {raw_content[:200]}",
            )

        return _json_to_eval_output(parsed, resp)


def _json_to_eval_output(raw: dict, api_resp: dict | None = None) -> EvalOutput:
    """Convert a parsed JSON dict to EvalOutput, handling missing fields."""
    scores = []
    for s in raw.get("scores", []):
        scores.append(
            EvalScore(
                dimension=s.get("dimension", "unknown"),
                score=float(s.get("score", 0.5)),
                scale=s.get("scale", "0-1"),
                comment=s.get("comment", ""),
            )
        )

    metadata = {}
    if api_resp:
        usage = api_resp.get("usage", {})
        if usage:
            metadata["tokens"] = usage
        metadata["model"] = api_resp.get("model", "")

    return EvalOutput(
        overall_score=float(raw.get("overall_score", 0.5)),
        scores=scores,
        reasoning=raw.get("reasoning", ""),
        suggestions=raw.get("suggestions", []),
        warnings=raw.get("warnings", []),
        metadata=metadata,
    )


# ── Mock provider (no network needed) ──────────────────────────────


class MockProvider(AIProvider):
    """Returns a fixed evaluation — for testing and offline use.

    Does not require network access or any dependencies.
    """

    def __init__(self, score: float = 0.72, reasoning: str = ""):
        self._score = score
        self._reasoning = reasoning or (
            "Mock evaluation: calibration appears reasonable. "
            "Skin tones are within normal range, white balance is acceptable. "
            "Slight warmth in midtones could be reduced."
        )

    @property
    def name(self) -> str:
        return "mock"

    def evaluate(
        self,
        input: EvalInput,
        images: list[np.ndarray],
    ) -> EvalOutput:
        return EvalOutput(
            overall_score=self._score,
            scores=[
                EvalScore(dimension="skin_tone", score=0.78, comment="Acceptable"),
                EvalScore(dimension="white_balance", score=0.75, comment="Slight warmth"),
                EvalScore(dimension="highlight_preservation", score=0.80, comment="Clean"),
                EvalScore(dimension="shadow_detail", score=0.70, comment="Some blocking"),
                EvalScore(dimension="overall_naturalness", score=0.76, comment="Good"),
            ],
            reasoning=self._reasoning,
            suggestions=["Reduce b* by 0.3 in midtones"],
            metadata={"provider": "mock"},
        )


# ── Helpers ─────────────────────────────────────────────────────────


def _encode_image_content(img: np.ndarray) -> dict:
    """Encode a numpy RGB image as an OpenAI-compatible image_url block."""
    import base64
    import cv2

    _, buf = cv2.imencode(".jpg", cv2.cvtColor(img, cv2.COLOR_RGB2BGR))
    b64 = base64.b64encode(buf).decode("ascii")
    return {
        "type": "image_url",
        "image_url": {"url": f"data:image/jpeg;base64,{b64}"},
    }


def _error_response(message: str) -> dict:
    return {"error": message}
