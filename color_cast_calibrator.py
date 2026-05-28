#!/usr/bin/env python3
"""CLI wrapper for Photo Calibrator core calibration."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))

from photo_calibrator.core.calibration import (
    DEFAULT_STRENGTH,
    CalibrationMode,
    CalibrationParams,
    calibrate_image,
    make_comparison,
)
from photo_calibrator.io import load_rgb_image, save_rgb_image


def _parse_mode(args: argparse.Namespace) -> CalibrationMode:
    if args.skin_only:
        return CalibrationMode.SKIN_PRIORITY
    if args.midtones_only:
        return CalibrationMode.MIDTONES_ONLY
    if args.highlights_only:
        return CalibrationMode.HIGHLIGHTS_ONLY
    if args.preserve_split_tone:
        return CalibrationMode.PRESERVE_SPLIT_TONE
    return CalibrationMode.GLOBAL


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Color Cast Calibrator - analyze and correct Lab color cast",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("image", help="Input image path")
    parser.add_argument("-o", "--output", default=None, help="Output path")
    parser.add_argument("--auto", action="store_true", help="Auto-detect cast and calibrate")
    parser.add_argument("--shift", nargs=2, type=float, metavar=("A", "B"), help="Manual a* b* correction shift")
    parser.add_argument("--strength", type=float, default=DEFAULT_STRENGTH, help="Correction strength, 0-1")
    parser.add_argument("--preserve-split-tone", action="store_true", help="Preserve split-tone shadows/highlights")
    parser.add_argument("--skin-only", action="store_true", help="Prioritize skin regions")
    parser.add_argument("--midtones-only", action="store_true", help="Correct midtones only")
    parser.add_argument("--highlights-only", action="store_true", help="Correct bright low-saturation regions")
    parser.add_argument("--highlight-pct", type=float, default=55.0, help="Highlight percentile threshold")
    parser.add_argument("--sat-pct", type=float, default=25.0, help="Saturation percentile threshold")
    parser.add_argument("--compare", action="store_true", help="Write side-by-side comparison")
    parser.add_argument("--quality", type=int, default=92, help="JPEG quality")
    args = parser.parse_args()

    img = load_rgb_image(args.image)
    manual_shift = args.shift is not None
    params = CalibrationParams(
        mode=_parse_mode(args),
        a_shift=args.shift[0] if manual_shift else None,
        b_shift=args.shift[1] if manual_shift else None,
        strength=args.strength,
        highlight_pct=args.highlight_pct,
        sat_pct=args.sat_pct,
    )
    result = calibrate_image(img, params)
    output_img = make_comparison(img, result.image) if args.compare else result.image
    output_path = args.output or f"{Path(args.image).stem}_calibrated.jpg"
    save_rgb_image(output_path, output_img, args.quality)

    pre = result.pre_report.lab
    post = result.post_report.lab
    print(f"Mode: {result.mode.value}")
    print(f"Shift: a*={result.a_shift:+.1f} b*={result.b_shift:+.1f} strength={args.strength:.2f}")
    print(f"Before: a*={pre.a_mean:+.1f} b*={pre.b_star_mean:+.1f} |dE|={pre.cast_strength:.1f}")
    print(f"After:  a*={post.a_mean:+.1f} b*={post.b_star_mean:+.1f} |dE|={post.cast_strength:.1f}")
    print(f"Reduction: {result.reduction_pct:.0f}%")
    print(f"Saved: {output_path}")


if __name__ == "__main__":
    main()
