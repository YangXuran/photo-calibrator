from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from photo_calibrator.core.accelerator import benchmark_accelerator, set_accelerator_backend


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Benchmark and verify Photo Calibrator accelerator backends")
    parser.add_argument("--backend", default="auto")
    parser.add_argument("--image-side", type=int, default=256)
    parser.add_argument("--lut-size", type=int, default=17)
    parser.add_argument("--iterations", type=int, default=3)
    parser.add_argument("--output", type=Path)
    parser.add_argument(
        "--require-accelerated",
        action="append",
        default=[],
        help="Operation that must report accelerated path, e.g. 3d-lut. Can be passed multiple times.",
    )
    args = parser.parse_args(argv)

    set_accelerator_backend(args.backend)
    payload = benchmark_accelerator(
        image_side=args.image_side,
        lut_size=args.lut_size,
        iterations=args.iterations,
    )
    raw = json.dumps(payload, indent=2)
    if args.output:
        args.output.write_text(raw + "\n", encoding="utf-8")
    print(raw)

    operations = {item["name"]: item for item in payload["operations"]}
    failures = [
        name
        for name in args.require_accelerated
        if name not in operations or operations[name].get("path") != "accelerated"
    ]
    if failures:
        active = payload["accelerator"]["active_backend"]
        print(
            f"Required accelerated operation(s) not satisfied on {active}: {', '.join(failures)}",
            file=sys.stderr,
        )
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
