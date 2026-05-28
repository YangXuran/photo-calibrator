from __future__ import annotations

import json

from photo_calibrator.backend.accelerator_benchmark import main
from photo_calibrator.core.accelerator import accelerator_payload, set_accelerator_backend


def test_accelerator_benchmark_cli_writes_json(tmp_path) -> None:
    original = accelerator_payload()["requested_backend"]
    output = tmp_path / "accelerator.json"
    try:
        code = main(
            [
                "--backend",
                "cpu-opencv",
                "--image-side",
                "64",
                "--lut-size",
                "7",
                "--iterations",
                "1",
                "--output",
                str(output),
            ]
        )
    finally:
        set_accelerator_backend(original)

    assert code == 0
    payload = json.loads(output.read_text(encoding="utf-8"))
    assert payload["accelerator"]["active_backend"] == "cpu-opencv"
    assert {item["name"] for item in payload["operations"]} == {"resize", "rgb-lab", "lab-rgb", "curve-lut", "matrix", "3d-lut"}


def test_accelerator_benchmark_cli_fails_required_fallback(capsys) -> None:
    original = accelerator_payload()["requested_backend"]
    try:
        code = main(
            [
                "--backend",
                "cpu-opencv",
                "--image-side",
                "64",
                "--lut-size",
                "7",
                "--iterations",
                "1",
                "--require-accelerated",
                "3d-lut",
            ]
        )
    finally:
        set_accelerator_backend(original)

    captured = capsys.readouterr()
    assert code == 2
    assert "3d-lut" in captured.err
