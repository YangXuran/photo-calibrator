""".cube 3D LUT export — generate Resolve-compatible LUT files."""

from __future__ import annotations

from pathlib import Path

import numpy as np


def write_cube_lut(
    path: str | Path,
    size: int = 17,
    title: str = "Photo Calibrator Auto LUT",
    domain_min: tuple[float, float, float] = (0.0, 0.0, 0.0),
    domain_max: tuple[float, float, float] = (1.0, 1.0, 1.0),
    lut_data: np.ndarray | None = None,
) -> None:
    """Write a .cube 3D LUT file.

    If lut_data is None, generates an identity LUT.
    lut_data shape: (size, size, size, 3) float32 in [0, 1].
    """
    path = Path(path)
    lines = [
        f"TITLE \"{title}\"",
        f"DOMAIN_MIN {domain_min[0]:.6f} {domain_min[1]:.6f} {domain_min[2]:.6f}",
        f"DOMAIN_MAX {domain_max[0]:.6f} {domain_max[1]:.6f} {domain_max[2]:.6f}",
        f"LUT_3D_SIZE {size}",
        "",
    ]

    if lut_data is None:
        axis = np.linspace(0, 1, size, dtype=np.float32)
        r, g, b = np.meshgrid(axis, axis, axis, indexing="ij")
        lut_data = np.stack([r, g, b], axis=-1)

    # Flatten in r-fastest order (standard .cube convention)
    flat = lut_data.reshape(-1, 3)
    for row in flat:
        lines.append(f"{row[0]:.6f} {row[1]:.6f} {row[2]:.6f}")

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
