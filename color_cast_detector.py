#!/usr/bin/env python3
"""CLI wrapper for Photo Calibrator core detection."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))

from photo_calibrator.core.cast_detection import analyze_image_array
from photo_calibrator.io import load_rgb_image


def print_report(path: str, is_gray_ref: bool = False) -> None:
    img = load_rgb_image(path)
    report = analyze_image_array(img, is_gray_ref=is_gray_ref)
    lab = report.lab
    rgb = report.rgb
    print(f"\n[IMG] {path} ({report.width}x{report.height})")
    print(f"  {report.severity} -> {report.cast_direction}")
    print(f"  Lab: a*={lab.a_mean:+.1f} b*={lab.b_star_mean:+.1f} intensity={lab.cast_strength:.1f}")
    print(f"  RGB mean: R={rgb.r_mean:.1f} G={rgb.g_mean:.1f} B={rgb.b_mean:.1f}")
    print(
        "  Peaks: "
        f"R={report.peaks['r']} G={report.peaks['g']} B={report.peaks['b']} "
        f"spread={report.peak_spread}"
    )
    if report.skin:
        print(
            "  Skin: "
            f"a*={report.skin.a_mean:+.1f} b*={report.skin.b_mean:+.1f} "
            f"pixels={report.skin.pixels}"
        )
    for name, zone in report.zones.items():
        if name == "global":
            continue
        print(f"  {name}: a*={zone.a_mean:+.1f} b*={zone.b_mean:+.1f} pixels={zone.pixels}")
    if report.is_gray_ref:
        print(f"  Gray deviation: {report.gray_deviation:.1f}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Color cast detector")
    parser.add_argument("images", nargs="+", help="Image paths")
    parser.add_argument("--gray-ref", action="append", default=[], metavar="IMG", help="Mark image as gray card reference")
    parser.add_argument("--skin", action="store_true", help="Accepted for compatibility; skin is included when detected")
    parser.add_argument("--regions", action="store_true", help="Accepted for compatibility; regions are included")
    parser.add_argument("--perceptual", action="store_true", help="Reserved for compatibility")
    parser.add_argument("--ccc", action="store_true", help="Reserved for compatibility")
    parser.add_argument("--induction", action="store_true", help="Reserved for compatibility")
    parser.add_argument("--chart", metavar="OUTPUT", help="Reserved for compatibility")
    parser.add_argument("--threshold", type=float, default=3.0, help="Reserved for compatibility")
    args = parser.parse_args()

    gray_refs = set(args.gray_ref)
    for image in args.images:
        print_report(image, is_gray_ref=image in gray_refs)


if __name__ == "__main__":
    main()
