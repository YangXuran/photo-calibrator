from __future__ import annotations

import subprocess
import sys

import cv2
import numpy as np


def write_sample(path: str) -> None:
    img = np.zeros((32, 32, 3), dtype=np.uint8)
    img[:, :] = (120, 130, 150)
    bgr = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
    assert cv2.imwrite(path, bgr)


def test_detector_cli_smoke(tmp_path) -> None:
    sample = tmp_path / "sample.png"
    write_sample(str(sample))

    proc = subprocess.run(
        [sys.executable, "color_cast_detector.py", str(sample)],
        check=True,
        text=True,
        capture_output=True,
    )

    assert "Lab:" in proc.stdout
    assert "RGB mean:" in proc.stdout


def test_calibrator_cli_smoke(tmp_path) -> None:
    sample = tmp_path / "sample.png"
    output = tmp_path / "out.jpg"
    write_sample(str(sample))

    proc = subprocess.run(
        [sys.executable, "color_cast_calibrator.py", "--auto", str(sample), "-o", str(output)],
        check=True,
        text=True,
        capture_output=True,
    )

    assert output.exists()
    assert "Reduction:" in proc.stdout
