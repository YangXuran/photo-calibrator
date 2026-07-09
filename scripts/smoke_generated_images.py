#!/usr/bin/env python3
"""Generated-image smoke test for the local HTTP backend.

The smoke inputs are intentionally synthetic:
- a pure-color PNG for preview/calibration/export stability;
- a bordered film-frame PNG for crop detection stability.

No user-supplied or repository fixture photos are required.
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parents[1]


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _write_rgb(path: Path, image: np.ndarray) -> None:
    ok = cv2.imwrite(str(path), cv2.cvtColor(image, cv2.COLOR_RGB2BGR))
    if not ok:
        raise RuntimeError(f"Could not write smoke image: {path}")


def _write_pure_color(path: Path) -> None:
    image = np.full((240, 320, 3), (154, 132, 108), dtype=np.uint8)
    _write_rgb(path, image)


def _write_bordered_film_frame(path: Path) -> None:
    image = np.full((600, 900, 3), 235, dtype=np.uint8)
    cv2.rectangle(image, (80, 70), (820, 530), (18, 18, 18), thickness=34)
    for y in range(110, 491):
        t = (y - 110) / 380.0
        image[y, 120:781] = (
            int(155 + 30 * t),
            int(124 + 20 * (1.0 - t)),
            int(92 + 16 * t),
        )
    cv2.rectangle(image, (120, 110), (780, 490), (42, 34, 30), thickness=2)
    _write_rgb(path, image)


def _request_json(method: str, url: str, payload: dict | None = None, timeout: float = 20.0) -> dict:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = Request(
        url,
        data=data,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            body = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {url} failed with HTTP {exc.code}: {detail}") from exc
    if isinstance(body, dict) and body.get("error"):
        raise RuntimeError(f"{method} {url} returned backend error: {body['error']}")
    return body


def _wait_for_health(base_url: str, timeout: float = 25.0) -> None:
    deadline = time.time() + timeout
    last_error: Exception | None = None
    while time.time() < deadline:
        try:
            payload = _request_json("GET", f"{base_url}/api/health", timeout=2.0)
            if payload.get("ok") is True:
                return
        except (RuntimeError, URLError, TimeoutError) as exc:
            last_error = exc
        time.sleep(0.25)
    raise RuntimeError(f"Backend did not become healthy at {base_url}: {last_error}")


def _start_backend(port: int, accelerator: str) -> subprocess.Popen:
    env = os.environ.copy()
    existing = env.get("PYTHONPATH")
    env["PYTHONPATH"] = str(ROOT / "src") if not existing else f"{ROOT / 'src'}{os.pathsep}{existing}"
    return subprocess.Popen(
        [
            sys.executable,
            "-m",
            "photo_calibrator.backend.simple_server",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--accelerator",
            accelerator,
        ],
        cwd=ROOT,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.STDOUT,
    )


def _assert_preview_url(value: object) -> None:
    if not isinstance(value, str) or "/api/preview-image/" not in value:
        raise AssertionError(f"Expected preview image URL, got {value!r}")


def run_smoke(accelerator: str = "cpu-opencv") -> None:
    port = _free_port()
    base_url = f"http://127.0.0.1:{port}"
    process = _start_backend(port, accelerator)
    try:
        _wait_for_health(base_url)
        with tempfile.TemporaryDirectory(prefix="photo-calibrator-smoke-") as tmp:
            tmpdir = Path(tmp)
            pure_path = tmpdir / "generated-pure-color.png"
            border_path = tmpdir / "generated-bordered-frame.png"
            export_path = tmpdir / "generated-pure-color-calibrated.jpg"
            _write_pure_color(pure_path)
            _write_bordered_film_frame(border_path)

            preview = _request_json(
                "POST",
                f"{base_url}/api/preview",
                {"path": str(pure_path), "file_name": pure_path.name, "analysis_max_side": 320},
            )
            session_id = preview.get("session_id")
            if not session_id:
                raise AssertionError("Preview did not return a session_id")
            _assert_preview_url(preview.get("original_preview"))
            processing = preview.get("processing") or {}
            if int(processing.get("analysis_width", 0)) <= 0 or int(processing.get("analysis_height", 0)) <= 0:
                raise AssertionError(f"Preview dimensions are invalid: {processing}")

            calibration = _request_json(
                "POST",
                f"{base_url}/api/calibrate-session",
                {
                    "session_id": session_id,
                    "mode": "global",
                    "strength": 0.75,
                    "fast": True,
                    "include_original": False,
                },
            )
            _assert_preview_url(calibration.get("calibrated_image"))

            export = _request_json(
                "POST",
                f"{base_url}/api/export-path",
                {
                    "input_path": str(pure_path),
                    "output_path": str(export_path),
                    "format": "jpeg",
                    "mode": "global",
                    "strength": 0.75,
                    "analysis_max_side": 320,
                },
            )
            if export.get("ok") is not True or not export_path.exists() or export_path.stat().st_size <= 0:
                raise AssertionError(f"Export smoke failed: {export}")

            film_scan = _request_json(
                "POST",
                f"{base_url}/api/film-scan",
                {"path": str(border_path), "file_name": border_path.name, "analysis_max_side": 900},
            )
            crop = film_scan.get("crop_rect") or {}
            confidence = float((film_scan.get("film_scan") or {}).get("confidence", 0.0))
            if confidence < 0.5:
                raise AssertionError(f"Film scan confidence too low: {confidence}")
            if float(crop.get("width", 1.0)) >= 0.98 or float(crop.get("height", 1.0)) >= 0.98:
                raise AssertionError(f"Film scan did not crop away the generated border: {crop}")

            print(
                json.dumps(
                    {
                        "ok": True,
                        "base_url": base_url,
                        "preview_source": processing.get("preview_source"),
                        "export_size": export_path.stat().st_size,
                        "film_scan_confidence": confidence,
                        "film_scan_crop": crop,
                    },
                    sort_keys=True,
                )
            )
    finally:
        process.terminate()
        try:
            process.wait(timeout=8)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=8)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run generated-image HTTP smoke tests.")
    parser.add_argument("--accelerator", default="cpu-opencv", help="Backend accelerator to request.")
    args = parser.parse_args()
    run_smoke(accelerator=args.accelerator)


if __name__ == "__main__":
    main()
