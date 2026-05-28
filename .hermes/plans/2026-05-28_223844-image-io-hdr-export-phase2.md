# Image I/O / HDR / Export — Phase 2 Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.  
> **Agent role:** Agent B (Image I/O / RAW / TIFF / HDR) per AGENTS.md §15.4  
> **Goal:** 将 8-bit 预览管线升级为 dtype-aware 图像 I/O 层，支持 float32/16-bit/HDR 输入与高质量导出。  
> **Architecture:** 新建 `io/` 包（readers、writers、raw、ocio 模块）+ 升级 `ImageBuffer` + 新增 `/api/export` 端点 + sidecar JSON / .cube LUT 导出骨架。  
> **Tech Stack:** Python 3.12+, NumPy, OpenCV, rawpy (optional), PIL/Pillow, imageio (optional), tifffile (optional)

---

## Context & Constraints

### Current State
- `ImageBuffer` (`src/photo_calibrator/core/image_model.py`): Phase 1 dataclass, frozen, uint8-only, 4 fields (data, color_space, bit_depth, metadata, orientation). Rejects non-uint8.
- `io.py` (`src/photo_calibrator/io.py`): Flat file, not package. Only `load_rgb_image()` + `save_rgb_image()` via cv2. No float/HDR support.
- `simple_server.py`: Already has RAW decode (rawpy, embedded JPEG thumbnail preferred), TIFF decode (PIL multi-page + cv2 reduced), but everything feeds into 8-bit `_normalize_bgr()` → `_prepare_bgr_for_analysis()`.
- Response format: All data URLs (base64 JPEG/PNG). No file-based export yet.
- `pyproject.toml`: deps = numpy, opencv-python; optional: rawpy, torch; no imageio/tifffile/OIIO yet.
- `CalibrationResult.image` is uint8 ndarray; entire calibration pipeline clips to uint8.
- No `.cube` LUT export, no sidecar JSON save yet.

### Agent B Boundaries (from AGENTS.md §15.4)
- **Files owned:** `core/image_model.py`, `io/` (new), `backend/simple_server.py` `_decode_*`/`_prepare_*`/`_encode_*` functions, `tests/test_simple_server_api.py` I/O tests, `tests/test_image_io.py` (new)
- **Can do:** Add ImageBuffer fields, add optional deps (tifffile/imageio/rawpy), HDR/EXR detection, 16-bit export API, sidecar/LUT export
- **Cannot do:** Change accelerator, change frontend, delete existing data URL fields

### Key Risks
- OpenImageIO/OpenColorIO wheels are hard to install on Linux → use `imageio + tifffile` as MVP, keep OIIO/OCIO as abstract interface for later.
- This dev machine has no GPU/CUDA, so Torch-accelerated export paths cannot be validated end-to-end but fallback must work.
- No real RAW/EXR samples on this machine — must use synthetic test images.

---

## Plan: 12 Tasks (estimated 2-3 hours total)

### Task 1: Create `io/` package skeleton

**Objective:** Convert `io.py` into a package and establish module structure.

**Files:**
- Modify: `src/photo_calibrator/io.py` → move to `src/photo_calibrator/io/__init__.py` (re-export for backward compat)
- Create: `src/photo_calibrator/io/readers.py`
- Create: `src/photo_calibrator/io/writers.py`
- Create: `src/photo_calibrator/io/raw.py`
- Create: `src/photo_calibrator/io/metadata.py`
- Create: `src/photo_calibrator/io/__init__.py`

**Step 1: Convert flat file to package re-export**

Move existing `io.py` content into `io/__init__.py`, and add re-exports so `from photo_calibrator.io import load_rgb_image` still works.

```python
# src/photo_calibrator/io/__init__.py
from __future__ import annotations

from .readers import load_rgb_image
from .writers import save_rgb_image

__all__ = ["load_rgb_image", "save_rgb_image"]
```

**Step 2: Create empty module stubs**

```python
# src/photo_calibrator/io/readers.py
from __future__ import annotations
from pathlib import Path
import cv2
import numpy as np

def load_rgb_image(path: str | Path) -> np.ndarray:
    """Legacy: load uint8 RGB image via OpenCV."""
    img_bgr = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if img_bgr is None:
        raise FileNotFoundError(f"Cannot read image: {path}")
    return cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
```

```python
# src/photo_calibrator/io/writers.py
from __future__ import annotations
from pathlib import Path
import cv2
import numpy as np

def save_rgb_image(path: str | Path, img_rgb: np.ndarray, quality: int = 92) -> None:
    """Legacy: save uint8 RGB image via OpenCV."""
    img_bgr = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)
    suffix = Path(path).suffix.lower()
    params: list[int] = []
    if suffix in {".jpg", ".jpeg"}:
        params = [cv2.IMWRITE_JPEG_QUALITY, int(quality)]
    ok = cv2.imwrite(str(path), img_bgr, params)
    if not ok:
        raise OSError(f"Cannot write image: {path}")
```

**Step 3: Delete old flat `io.py`**

Remove `src/photo_calibrator/io.py` (content already migrated into `io/__init__.py`).

**Step 4: Verify backward compatibility**

Run: `PYTHONPATH=src python3 -c "from photo_calibrator.io import load_rgb_image, save_rgb_image; print('OK')"`  
Expected: OK, no ImportError.

Run: `python3 -m compileall -q src tests`

**Step 5: Commit**

```bash
git add src/photo_calibrator/io/
git rm src/photo_calibrator/io.py
git commit -m "refactor: convert io.py into io/ package with module stubs"
```

---

### Task 2: Upgrade ImageBuffer for dtype-aware pipeline

**Objective:** Remove uint8-only restriction. Support float32, uint16, and add HDR/ICC fields.

**Files:**
- Modify: `src/photo_calibrator/core/image_model.py`
- Modify: `tests/test_simple_server_api.py` (any test that constructs ImageBuffer, if any — currently none)
- Create (test additions): new test in `tests/test_image_io.py`

**Step 1: Write failing test for float32 ImageBuffer**

Create `tests/test_image_io.py`:

```python
from __future__ import annotations
import numpy as np
import pytest
from photo_calibrator.core.image_model import ImageBuffer

def test_image_buffer_accepts_float32_rgb() -> None:
    data = np.random.rand(64, 64, 3).astype(np.float32)
    buf = ImageBuffer(data=data)
    assert buf.dtype == np.float32
    assert buf.bit_depth == 32
    assert buf.width == 64

def test_image_buffer_accepts_uint16_rgb() -> None:
    data = np.zeros((32, 32, 3), dtype=np.uint16)
    data[:, :] = 32768
    buf = ImageBuffer(data=data, bit_depth=16)
    assert buf.dtype == np.uint16
    assert buf.data_range == (0, 65535)

def test_image_buffer_rejects_4channel() -> None:
    data = np.zeros((16, 16, 4), dtype=np.uint8)
    with pytest.raises(ValueError, match="HxWx3 RGB"):
        ImageBuffer(data=data)
```

Run: `python3 -m pytest tests/test_image_io.py -v`  
Expected: 1 FAIL (float32 rejected), 2 FAIL (uint16 rejected), 1 PASS (4-channel still rejected)

**Step 2: Rewrite ImageBuffer**

```python
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any

import numpy as np


def _dtype_to_bit_depth(dtype: np.dtype) -> int:
    if dtype == np.uint8:
        return 8
    if dtype == np.uint16:
        return 16
    if dtype == np.float32:
        return 32
    if dtype == np.float16:
        return 16
    return int(dtype.itemsize * 8)


def _default_data_range(dtype: np.dtype) -> tuple[float, float]:
    if np.issubdtype(dtype, np.integer):
        info = np.iinfo(dtype)
        return (float(info.min), float(info.max))
    # float: assume [0, 1] for normalized, [0, inf) for HDR
    return (0.0, 1.0)


@dataclass(frozen=True)
class ImageBuffer:
    """Dtype-aware RGB image buffer with color metadata.

    Supports uint8, uint16, float32 RGB data.  HDR (float32 with
    values > 1.0) is indicated by data_range max > 1.0.
    """

    data: np.ndarray
    color_space: str = "sRGB"
    bit_depth: int | None = None
    data_range: tuple[float, float] | None = None
    icc_profile: bytes | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    orientation: int = 1

    def __post_init__(self) -> None:
        if self.data.ndim != 3 or self.data.shape[2] != 3:
            raise ValueError("ImageBuffer.data must be an HxWx3 RGB array")
        # Auto-detect bit_depth if not provided
        if self.bit_depth is None:
            object.__setattr__(self, "bit_depth", _dtype_to_bit_depth(self.data.dtype))
        if self.data_range is None:
            object.__setattr__(self, "data_range", _default_data_range(self.data.dtype))

    @property
    def dtype(self) -> np.dtype:
        return self.data.dtype

    @property
    def width(self) -> int:
        return int(self.data.shape[1])

    @property
    def height(self) -> int:
        return int(self.data.shape[0])

    @property
    def is_hdr(self) -> bool:
        """True if float data contains values beyond [0, 1] (HDR/EXR)."""
        if not np.issubdtype(self.data.dtype, np.floating):
            return False
        return self.data_range[1] > 1.0 or self.data.min() < 0.0

    @property
    def is_integer(self) -> bool:
        return np.issubdtype(self.data.dtype, np.integer)
```

**Step 3: Run tests**

Run: `python3 -m pytest tests/test_image_io.py -v`  
Expected: All PASS (3 tests)

**Step 4: Verify no regressions**

Run: `python3 -m pytest tests/ -v` (full suite)  
Expected: All existing tests still pass (no code currently constructs ImageBuffer directly, so no breakage expected).

**Step 5: Commit**

```bash
git add src/photo_calibrator/core/image_model.py tests/test_image_io.py
git commit -m "feat: upgrade ImageBuffer to accept float32/uint16 with auto-detected dtype fields"
```

---

### Task 3: Implement dtype-aware image readers in `io/readers.py`

**Objective:** Add reader functions that return `ImageBuffer` with correct dtype/range for float and 16-bit images.

**Files:**
- Modify: `src/photo_calibrator/io/readers.py`

**Step 1: Write test for float TIFF reading**

Add to `tests/test_image_io.py`:

```python
from photo_calibrator.io.readers import read_image

def test_read_float_tiff_returns_image_buffer(tmp_path) -> None:
    import tifffile
    path = tmp_path / "float32.tif"
    data = np.random.rand(32, 32, 3).astype(np.float32) * 0.5
    tifffile.imwrite(str(path), data)
    buf = read_image(str(path))
    assert buf.dtype == np.float32
    assert buf.data_range == (0.0, 1.0)  # default for float
    assert buf.bit_depth == 32

def test_read_uint16_png_returns_image_buffer(tmp_path) -> None:
    import imageio.v3 as iio
    path = tmp_path / "u16.png"
    data = np.zeros((16, 16, 3), dtype=np.uint16)
    data[:, :] = 32768
    iio.imwrite(str(path), data)
    buf = read_image(str(path))
    assert buf.dtype == np.uint16
    assert buf.data_range == (0, 65535)
    assert buf.bit_depth == 16

def test_read_uint8_jpeg_returns_image_buffer(tmp_path) -> None:
    import imageio.v3 as iio
    path = tmp_path / "test.jpg"
    data = np.zeros((16, 16, 3), dtype=np.uint8)
    data[:, :] = 128
    iio.imwrite(str(path), data)
    buf = read_image(str(path))
    assert buf.dtype == np.uint8
    assert buf.data_range == (0, 255)
    assert buf.is_hdr is False
```

**Step 2: Implement `read_image()` and helpers**

```python
# Add to io/readers.py

from photo_calibrator.core.image_model import ImageBuffer

def _auto_detect_data_range(data: np.ndarray, dtype: np.dtype) -> tuple[float, float]:
    """Compute actual data range for float images."""
    if np.issubdtype(dtype, np.floating):
        actual_min = float(data.min())
        actual_max = float(data.max())
        if actual_max <= 1.0 and actual_min >= 0.0:
            return (0.0, 1.0)
        return (actual_min, actual_max)
    info = np.iinfo(dtype)
    return (float(info.min), float(info.max))


def read_image(path: str | Path) -> ImageBuffer:
    """Read any supported image format into a dtype-aware ImageBuffer.

    Uses imageio for float/16-bit, falls back to OpenCV for uint8 JPEG/PNG.
    """
    path = Path(path)
    suffix = path.suffix.lower()
    
    # Try imageio first (handles float TIFF, uint16 PNG, etc.)
    try:
        import imageio.v3 as iio
        data = iio.imread(str(path))
        if data.ndim == 3 and data.shape[2] == 3:
            data_range = _auto_detect_data_range(data, data.dtype)
            return ImageBuffer(
                data=data,
                data_range=data_range,
                color_space="sRGB",
                metadata={"source": str(path), "reader": "imageio"},
            )
    except Exception:
        pass

    # Fallback: OpenCV for standard uint8 images
    bgr = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
    if bgr is None:
        raise FileNotFoundError(f"Cannot read image: {path}")
    
    if bgr.ndim == 2:
        bgr = cv2.cvtColor(bgr, cv2.COLOR_GRAY2BGR)
    if bgr.shape[2] == 4:
        bgr = cv2.cvtColor(bgr, cv2.COLOR_BGRA2BGR)
    
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    if rgb.dtype == np.uint16:
        data_range = (0.0, 65535.0)
    else:
        data_range = (0.0, 255.0)
    
    return ImageBuffer(
        data=rgb,
        data_range=data_range,
        color_space="sRGB",
        metadata={"source": str(path), "reader": "opencv"},
    )
```

**Step 3: Add optional deps to pyproject.toml**

```toml
[project.optional-dependencies]
io = [
  "imageio",
  "tifffile",
]
```

**Step 4: Run tests**

Run: `python3 -m pytest tests/test_image_io.py::test_read_float_tiff_returns_image_buffer -v` (requires tifffile installed)  
If tifffile not installed: `pip install tifffile imageio`

Run: `python3 -m pytest tests/test_image_io.py -v`  
Expected: All imageio-dependent tests may skip if not installed. If installed, all PASS.

**Step 5: Verify no regressions**

Run: `python3 -m pytest tests/test_simple_server_api.py -v`  
Expected: All existing tests pass.

**Step 6: Commit**

```bash
git add src/photo_calibrator/io/readers.py tests/test_image_io.py pyproject.toml
git commit -m "feat: add dtype-aware read_image() returning ImageBuffer with float/uint16 support"
```

---

### Task 4: Implement dtype-aware writers + export functions in `io/writers.py`

**Objective:** Write JPEG/PNG/16-bit TIFF from ImageBuffer or raw ndarray.

**Files:**
- Modify: `src/photo_calibrator/io/writers.py`

**Step 1: Write tests for export functions**

Add to `tests/test_image_io.py`:

```python
from photo_calibrator.io.writers import write_image, export_jpeg, export_png, export_tiff16

def test_export_jpeg_writes_file(tmp_path) -> None:
    data = np.zeros((16, 16, 3), dtype=np.uint8)
    data[:, :] = 128
    buf = ImageBuffer(data=data)
    out = tmp_path / "out.jpg"
    export_jpeg(buf, out, quality=90)
    assert out.exists()
    assert out.stat().st_size > 0

def test_export_png16_writes_16bit_file(tmp_path) -> None:
    import imageio.v3 as iio
    data = np.zeros((16, 16, 3), dtype=np.uint16)
    data[:, :] = 32768
    buf = ImageBuffer(data=data)
    out = tmp_path / "out.png"
    export_png(buf, out, bit_depth=16)
    assert out.exists()
    # Verify 16-bit
    reloaded = iio.imread(str(out))
    assert reloaded.dtype == np.uint16

def test_export_tiff16_writes_16bit_file(tmp_path) -> None:
    import tifffile
    data = np.zeros((16, 16, 3), dtype=np.uint16)
    data[:, :] = 32768
    buf = ImageBuffer(data=data)
    out = tmp_path / "out.tif"
    export_tiff16(buf, out)
    assert out.exists()
    reloaded = tifffile.imread(str(out))
    assert reloaded.dtype == np.uint16

def test_export_from_float32_to_tiff16(tmp_path) -> None:
    """Float32 [0,1] should be scaled to uint16 0-65535."""
    import tifffile
    data = np.random.rand(16, 16, 3).astype(np.float32)
    buf = ImageBuffer(data=data)
    out = tmp_path / "out.tif"
    export_tiff16(buf, out)
    reloaded = tifffile.imread(str(out))
    assert reloaded.dtype == np.uint16
    # Check scaling: pure white (1.0) should become near 65535
    assert reloaded.max() > 60000
```

**Step 2: Implement writers**

```python
# Add to io/writers.py
from __future__ import annotations
from pathlib import Path
import cv2
import numpy as np
from photo_calibrator.core.image_model import ImageBuffer


def _to_uint8(rgb: np.ndarray) -> np.ndarray:
    """Convert any dtype to uint8 for JPEG export."""
    if rgb.dtype == np.uint8:
        return rgb
    if np.issubdtype(rgb.dtype, np.integer):
        info = np.iinfo(rgb.dtype)
        scaled = rgb.astype(np.float64) / float(info.max) * 255.0
    else:
        # float: assume [0, 1] or HDR
        scaled = np.clip(rgb.astype(np.float64), 0, None)
        if scaled.max() > 1.0:
            scaled = scaled / scaled.max() * 255.0
        else:
            scaled = scaled * 255.0
    return np.clip(scaled, 0, 255).astype(np.uint8)


def _to_uint16(rgb: np.ndarray) -> np.ndarray:
    """Convert any dtype to uint16 for 16-bit export."""
    if rgb.dtype == np.uint16:
        return rgb
    if np.issubdtype(rgb.dtype, np.integer):
        info = np.iinfo(rgb.dtype)
        scaled = rgb.astype(np.float64) / float(info.max) * 65535.0
    else:
        scaled = np.clip(rgb.astype(np.float64), 0, None)
        if scaled.max() > 1.0:
            scaled = scaled / scaled.max() * 65535.0
        else:
            scaled = scaled * 65535.0
    return np.clip(scaled, 0, 65535).astype(np.uint16)


def export_jpeg(buf: ImageBuffer, path: str | Path, quality: int = 92) -> None:
    """Export ImageBuffer as 8-bit JPEG (always sRGB, 8-bit)."""
    path = Path(path)
    rgb_u8 = _to_uint8(buf.data)
    bgr = cv2.cvtColor(rgb_u8, cv2.COLOR_RGB2BGR)
    ok = cv2.imwrite(str(path), bgr, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise OSError(f"Failed to write JPEG: {path}")


def export_png(buf: ImageBuffer, path: str | Path, bit_depth: int = 8) -> None:
    """Export ImageBuffer as PNG (8-bit or 16-bit)."""
    path = Path(path)
    if bit_depth == 16:
        rgb = _to_uint16(buf.data)
        bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
        ok = cv2.imwrite(str(path), bgr, [cv2.IMWRITE_PNG_COMPRESSION, 6])
    else:
        rgb = _to_uint8(buf.data)
        bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
        ok = cv2.imwrite(str(path), bgr)
    if not ok:
        raise OSError(f"Failed to write PNG: {path}")


def export_tiff16(buf: ImageBuffer, path: str | Path) -> None:
    """Export ImageBuffer as 16-bit TIFF using tifffile if available."""
    path = Path(path)
    rgb = _to_uint16(buf.data)
    try:
        import tifffile
        tifffile.imwrite(str(path), rgb)
    except ImportError:
        # Fallback to OpenCV (also supports 16-bit TIFF)
        bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
        ok = cv2.imwrite(str(path), bgr)
        if not ok:
            raise OSError(f"Failed to write 16-bit TIFF: {path}")


def write_image(buf: ImageBuffer, path: str | Path, quality: int = 92) -> None:
    """Write ImageBuffer to disk, auto-selecting format by extension."""
    suffix = Path(path).suffix.lower()
    if suffix in {".jpg", ".jpeg"}:
        export_jpeg(buf, path, quality)
    elif suffix == ".png":
        bit_depth = 16 if buf.dtype in (np.uint16, np.float32) else 8
        export_png(buf, path, bit_depth=bit_depth)
    elif suffix in {".tif", ".tiff"}:
        bit_depth = 16 if buf.dtype in (np.uint16, np.float32) else 8
        if bit_depth == 16:
            export_tiff16(buf, path)
        else:
            # 8-bit TIFF via OpenCV
            rgb = _to_uint8(buf.data)
            bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
            cv2.imwrite(str(path), bgr)
    else:
        raise ValueError(f"Unsupported export format: {suffix}")
```

**Step 3: Keep legacy `save_rgb_image` working**

The legacy function stays as-is in writers.py for backward compat. Re-export it in `__init__.py`.

**Step 4: Run tests**

Run: `python3 -m pytest tests/test_image_io.py -v`  
Expected: All PASS (imageio/tifffile must be installed for some tests)

**Step 5: Commit**

```bash
git add src/photo_calibrator/io/writers.py tests/test_image_io.py
git commit -m "feat: add dtype-aware export functions (JPEG/PNG/16-bit TIFF) from ImageBuffer"
```

---

### Task 5: Add HDR/EXR detection and error messaging

**Objective:** Detect HDR/EXR files and return a clear user-facing error (not crash), since full HDR pipeline requires later phase.

**Files:**
- Modify: `src/photo_calibrator/io/readers.py`

**Step 1: Write test for EXR detection**

Add to `tests/test_image_io.py`:

```python
def test_detect_hdr_exr_raises_clear_error(tmp_path) -> None:
    """Simulate an EXR file — should give clear message, not crash."""
    path = tmp_path / "test.exr"
    path.write_bytes(b"\x76\x2f\x31\x01" + b"\x00" * 100)  # EXR magic bytes
    with pytest.raises(ValueError, match="HDR.*EXR.*not yet supported"):
        read_image(path)

def test_detect_hdr_extension_gives_hint() -> None:
    """Even without reading, extension check should hint."""
    from photo_calibrator.io.readers import _is_hdr_extension
    assert _is_hdr_extension("test.exr")
    assert _is_hdr_extension("test.hdr")
    assert not _is_hdr_extension("test.jpg")
```

**Step 2: Implement HDR detection**

```python
# Add to io/readers.py

_HDR_EXTENSIONS = {".exr", ".hdr", ".rgbe", ".xyze"}

def _is_hdr_extension(filename: str) -> bool:
    return Path(filename).suffix.lower() in _HDR_EXTENSIONS

def _is_exr_magic(data: bytes) -> bool:
    """Check for OpenEXR magic number (0x76 0x2f 0x31 0x01)."""
    return len(data) >= 4 and data[:4] == b"\x76\x2f\x31\x01"
```

Modify `read_image()` to check HDR before attempting decode:

```python
def read_image(path: str | Path) -> ImageBuffer:
    path = Path(path)
    suffix = path.suffix.lower()
    
    if suffix in _HDR_EXTENSIONS:
        raise ValueError(
            f"HDR/EXR files ({suffix}) are not yet supported in Phase 2. "
            f"Full HDR pipeline (OpenEXR, Radiance HDR) is planned for Phase 3+. "
            f"File: {path}"
        )
    
    # ... rest of function
```

**Step 3: Run tests**

Run: `python3 -m pytest tests/test_image_io.py -v -k "hdr"`  
Expected: 2 PASS

**Step 4: Commit**

```bash
git add src/photo_calibrator/io/readers.py tests/test_image_io.py
git commit -m "feat: add HDR/EXR detection with clear user-facing error message"
```

---

### Task 6: Add ICC profile / EXIF metadata extraction stub

**Objective:** Extract ICC profile bytes and basic EXIF from input files where available.

**Files:**
- Create: `src/photo_calibrator/io/metadata.py`
- Modify: `src/photo_calibrator/io/readers.py`

**Step 1: Write tests**

Add to `tests/test_image_io.py`:

```python
from photo_calibrator.io.metadata import extract_icc_profile, extract_exif_basic

def test_extract_icc_from_jpeg(tmp_path) -> None:
    """Synthetic JPEG won't have ICC, but function shouldn't crash."""
    import imageio.v3 as iio
    path = tmp_path / "test.jpg"
    data = np.zeros((16, 16, 3), dtype=np.uint8)
    data[:, :] = 128
    iio.imwrite(str(path), data)
    icc = extract_icc_profile(str(path))
    assert icc is None  # synthetic JPEG has no ICC

def test_extract_exif_basic_no_crash(tmp_path) -> None:
    path = tmp_path / "test.jpg"
    data = np.zeros((16, 16, 3), dtype=np.uint8)
    data[:, :] = 128
    import imageio.v3 as iio
    iio.imwrite(str(path), data)
    exif = extract_exif_basic(str(path))
    assert isinstance(exif, dict)
    # At minimum has 'source' key
    assert "source" in exif
```

**Step 2: Implement metadata module**

```python
# src/photo_calibrator/io/metadata.py
from __future__ import annotations
from pathlib import Path
from typing import Any


def extract_icc_profile(path: str | Path) -> bytes | None:
    """Extract embedded ICC color profile from an image file.
    
    Returns None if no profile is embedded or extraction fails.
    """
    path = Path(path)
    try:
        from PIL import Image
        with Image.open(path) as img:
            icc = img.info.get("icc_profile")
            if icc:
                return bytes(icc)
    except Exception:
        pass
    return None


def extract_exif_basic(path: str | Path) -> dict[str, Any]:
    """Extract basic EXIF tags: Make, Model, DateTime, ISO, Exposure, etc.
    
    Returns a dict with at minimum a 'source' key.
    """
    path = Path(path)
    result: dict[str, Any] = {"source": str(path)}
    try:
        from PIL import Image
        from PIL.ExifTags import TAGS
        with Image.open(path) as img:
            exif_data = img._getexif()
            if exif_data:
                for tag_id, value in exif_data.items():
                    tag_name = TAGS.get(tag_id, str(tag_id))
                    if isinstance(value, bytes):
                        value = value.decode("utf-8", errors="replace")
                    result[tag_name] = str(value)
    except Exception:
        pass
    return result
```

**Step 3: Integrate into read_image()**

Modify `read_image()` to call `extract_icc_profile()` and store in `ImageBuffer.icc_profile`:

```python
def read_image(path: str | Path) -> ImageBuffer:
    # ... existing decode logic ...
    icc = extract_icc_profile(path)
    return ImageBuffer(
        data=rgb,
        icc_profile=icc,
        # ...
    )
```

**Step 4: Run tests**

Run: `python3 -m pytest tests/test_image_io.py -v -k "icc or exif"`  
Expected: 2 PASS

**Step 5: Commit**

```bash
git add src/photo_calibrator/io/metadata.py src/photo_calibrator/io/readers.py tests/test_image_io.py
git commit -m "feat: add ICC profile extraction and basic EXIF metadata reader"
```

---

### Task 7: Create RAW decoder module (`io/raw.py`)

**Objective:** Extract existing rawpy RAW decode logic from `simple_server.py` into a clean module.

**Files:**
- Create: `src/photo_calibrator/io/raw.py`
- Modify: `src/photo_calibrator/backend/simple_server.py` (import from new location)

**Step 1: Move RAW decode functions to `io/raw.py`**

Extract these functions from `simple_server.py`:
- `_try_decode_raw_preview()` → `decode_raw_preview()`
- RAW extension list

```python
# src/photo_calibrator/io/raw.py
from __future__ import annotations
import tempfile
from pathlib import Path
import cv2
import numpy as np

RAW_EXTENSIONS = (".dng", ".cr2", ".cr3", ".nef", ".arw", ".raf", ".rw2", ".orf", ".pef", ".srw")


def is_raw_extension(filename: str) -> bool:
    return filename.lower().endswith(RAW_EXTENSIONS)


def decode_raw_preview(raw_bytes: bytes, file_name: str) -> tuple[np.ndarray, str] | None:
    """Decode RAW bytes into BGR preview, preferring embedded JPEG thumbnail.
    
    Returns (bgr_array, source_label) or None if decode fails.
    Raises ValueError if rawpy is not installed.
    """
    try:
        import rawpy
    except ImportError as exc:
        raise ValueError(
            "RAW support requires optional dependency 'rawpy'. "
            "Install with: pip install photo-calibrator[raw]"
        ) from exc

    suffix = Path(file_name).suffix or ".raw"
    with tempfile.NamedTemporaryFile(suffix=suffix) as tmp:
        tmp.write(raw_bytes)
        tmp.flush()
        with rawpy.imread(tmp.name) as raw_image:
            try:
                thumb = raw_image.extract_thumb()
                if thumb.format == rawpy.ThumbFormat.JPEG:
                    arr = np.frombuffer(thumb.data, dtype=np.uint8)
                    bgr = cv2.imdecode(arr, cv2.IMREAD_UNCHANGED)
                    if bgr is not None:
                        return bgr, "raw-embedded-jpeg"
                if thumb.format == rawpy.ThumbFormat.BITMAP:
                    rgb = np.asarray(thumb.data)
                    bgr = cv2.cvtColor(_to_uint8_preview(rgb), cv2.COLOR_RGB2BGR)
                    return bgr, "raw-embedded-bitmap"
            except Exception:
                pass
            rgb = raw_image.postprocess(half_size=True, no_auto_bright=True, output_bps=8)
            return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR), "raw-half-postprocess"


def _to_uint8_preview(img: np.ndarray) -> np.ndarray:
    """Convert any dtype to uint8 preview. (Copied from simple_server for self-contained module.)"""
    if img.dtype == np.uint8:
        return img
    data = img.astype(np.float32)
    max_value = float(data.max()) if data.size else 0.0
    if np.issubdtype(img.dtype, np.integer):
        dtype_max = float(np.iinfo(img.dtype).max)
        if dtype_max > 0:
            data = data / dtype_max * 255.0
    elif max_value <= 1.0:
        data = data * 255.0
    else:
        data = data / max(max_value, 1.0) * 255.0
    return np.clip(data, 0, 255).astype(np.uint8)
```

**Step 2: Update simple_server.py imports**

```python
# In simple_server.py, replace the inline _try_decode_raw_preview with:
from photo_calibrator.io.raw import decode_raw_preview, is_raw_extension, RAW_EXTENSIONS

# Update the call site:
def _try_decode_raw_preview(raw: bytes, file_name: str) -> tuple[np.ndarray, str] | None:
    raw_exts = RAW_EXTENSIONS
    if not file_name.lower().endswith(raw_exts):
        return None
    return decode_raw_preview(raw, file_name)
```

**Step 3: Run tests**

Run: `python3 -m pytest tests/test_simple_server_api.py -v -k "raw"`  
Expected: `test_raw_decoder_prefers_embedded_jpeg_thumbnail` PASS (it monkeypatches rawpy, so it should still work)

Run: `python3 -m pytest tests/ -v`  
Expected: Full suite passes.

**Step 4: Commit**

```bash
git add src/photo_calibrator/io/raw.py src/photo_calibrator/backend/simple_server.py
git commit -m "refactor: extract RAW decode logic into io/raw.py module"
```

---

### Task 8: Add export API endpoint (`/api/export`)

**Objective:** Add a POST endpoint that accepts a session_id + calibration params + output path, and writes the calibrated image to disk.

**Files:**
- Modify: `src/photo_calibrator/backend/simple_server.py`
- Modify: `tests/test_simple_server_api.py`

**Step 1: Write test**

Add to `tests/test_simple_server_api.py`:

```python
def test_export_endpoint_writes_jpeg_to_disk(tmp_path) -> None:
    from photo_calibrator.backend.simple_server import _export_payload
    out = tmp_path / "exported.jpg"
    payload = _export_payload({
        "image_data": sample_data_url(),
        "mode": "global",
        "strength": 0.8,
        "output_path": str(out),
        "format": "jpeg",
        "quality": 90,
    })
    assert payload["ok"] is True
    assert out.exists()
    assert out.stat().st_size > 0
    assert "path" in payload

def test_export_endpoint_writes_tiff16_to_disk(tmp_path) -> None:
    from photo_calibrator.backend.simple_server import _export_payload
    out = tmp_path / "exported.tif"
    payload = _export_payload({
        "image_data": sample_data_url(),
        "mode": "global",
        "strength": 0.8,
        "output_path": str(out),
        "format": "tiff16",
    })
    assert payload["ok"] is True
    assert out.exists()

def test_export_refuses_path_outside_allowed(tmp_path) -> None:
    from photo_calibrator.backend.simple_server import _export_payload
    with pytest.raises(ValueError, match="outside"):
        _export_payload({
            "image_data": sample_data_url(),
            "output_path": "/etc/passwd",
            "format": "jpeg",
        })
```

**Step 2: Implement `_export_payload()`**

```python
# In simple_server.py

_EXPORT_ALLOWED_DIRS: list[Path] = []  # populated at server start

def _export_payload(body: dict) -> dict:
    """Export calibrated image to disk file."""
    start = time.perf_counter()
    
    output_path = Path(body["output_path"]).resolve()
    
    # Security: only allow writes within allowed directories
    allowed = _EXPORT_ALLOWED_DIRS or [Path.cwd(), Path.home()]
    if not any(str(output_path).startswith(str(d)) for d in allowed):
        raise ValueError(
            f"Export path {output_path} is outside allowed directories. "
            f"Allowed: {[str(d) for d in allowed]}"
        )
    
    fmt = body.get("format", "jpeg")
    
    # Decode and calibrate (reuse existing logic)
    entry = _prepare_uploaded_analysis(
        body["image_data"],
        file_name=str(body.get("file_name", "")),
    )
    img = entry.prepared.image
    mode = CalibrationMode(body.get("mode", CalibrationMode.GLOBAL.value))
    params = CalibrationParams(
        mode=mode,
        strength=float(body.get("strength", 0.8)),
        highlight_pct=float(body.get("highlight_pct", 55.0)),
        sat_pct=float(body.get("sat_pct", 25.0)),
    )
    result = calibrate_image_from_analysis(img, params, entry.input_report, entry.zones)
    
    # Write to disk
    from photo_calibrator.io.writers import write_image
    from photo_calibrator.core.image_model import ImageBuffer
    
    buf = ImageBuffer(data=result.image)
    
    if fmt == "jpeg":
        write_image(buf, output_path, quality=int(body.get("quality", 92)))
    elif fmt == "png":
        write_image(buf, output_path)
    elif fmt == "tiff16":
        write_image(buf, output_path)  # auto-detects .tif extension
    elif fmt == "sidecar":
        _write_sidecar_json(output_path, result, entry)
    elif fmt == "cube":
        _write_cube_lut(output_path, result)
    else:
        raise ValueError(f"Unsupported export format: {fmt}")
    
    elapsed_ms = (time.perf_counter() - start) * 1000.0
    return {
        "ok": True,
        "path": str(output_path),
        "format": fmt,
        "size": output_path.stat().st_size,
        "elapsed_ms": elapsed_ms,
    }
```

**Step 3: Add route in Handler.do_POST()**

```python
if self.path == "/api/export":
    self._send_json(_export_payload(body))
    return
```

**Step 4: Run tests**

Run: `python3 -m pytest tests/test_simple_server_api.py -v -k "export"`  
Expected: 3 PASS

**Step 5: Commit**

```bash
git add src/photo_calibrator/backend/simple_server.py tests/test_simple_server_api.py
git commit -m "feat: add /api/export endpoint for JPEG/PNG/16-bit TIFF file output"
```

---

### Task 9: Implement sidecar JSON export

**Objective:** Save calibration parameters + input metadata as a `.json` sidecar file.

**Files:**
- Create: `src/photo_calibrator/io/sidecar.py`
- Modify: `src/photo_calibrator/backend/simple_server.py`

**Step 1: Write test**

Add to `tests/test_image_io.py`:

```python
from photo_calibrator.io.sidecar import write_sidecar_json, read_sidecar_json

def test_sidecar_roundtrip(tmp_path) -> None:
    params = {
        "mode": "global",
        "a_shift": -2.5,
        "b_shift": 1.8,
        "strength": 0.8,
        "source_file": "IMG_0001.CR2",
    }
    sidecar_path = tmp_path / "IMG_0001.CR2.calib.json"
    write_sidecar_json(sidecar_path, params, algorithm_version="0.2.0")
    assert sidecar_path.exists()
    
    loaded = read_sidecar_json(sidecar_path)
    assert loaded["calibration"]["mode"] == "global"
    assert loaded["calibration"]["a_shift"] == -2.5
    assert loaded["algorithm_version"] == "0.2.0"
```

**Step 2: Implement sidecar module**

```python
# src/photo_calibrator/io/sidecar.py
from __future__ import annotations
import json
import hashlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SIDECAR_VERSION = "0.2.0"


def write_sidecar_json(
    path: str | Path,
    calibration_params: dict[str, Any],
    algorithm_version: str = SIDECAR_VERSION,
    input_metadata: dict[str, Any] | None = None,
) -> None:
    """Write calibration sidecar JSON file."""
    path = Path(path)
    doc = {
        "sidecar_version": SIDECAR_VERSION,
        "algorithm_version": algorithm_version,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "calibration": calibration_params,
    }
    if input_metadata:
        doc["input_metadata"] = input_metadata
    
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, indent=2, ensure_ascii=False), encoding="utf-8")


def read_sidecar_json(path: str | Path) -> dict[str, Any]:
    """Read calibration sidecar JSON file."""
    return json.loads(Path(path).read_text(encoding="utf-8"))


def compute_source_fingerprint(path: str | Path) -> str:
    """SHA-256 fingerprint of source file for linking sidecars."""
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()[:32]
```

**Step 3: Wire into `_export_payload()`**

```python
elif fmt == "sidecar":
    from photo_calibrator.io.sidecar import write_sidecar_json
    calib_params = {
        "mode": result.mode.value,
        "a_shift": result.a_shift,
        "b_shift": result.b_shift,
        "strength": result.params.strength,
    }
    write_sidecar_json(output_path, calib_params)
```

**Step 4: Run tests**

Run: `python3 -m pytest tests/test_image_io.py -v -k "sidecar"`  
Expected: 1 PASS

**Step 5: Commit**

```bash
git add src/photo_calibrator/io/sidecar.py tests/test_image_io.py src/photo_calibrator/backend/simple_server.py
git commit -m "feat: add sidecar JSON export for calibration parameters"
```

---

### Task 10: Implement .cube 3D LUT export skeleton

**Objective:** Generate `.cube` 1D/3D LUT file from calibration result (global Lab shift → identity LUT for now, full 3D LUT mapping later).

**Files:**
- Create: `src/photo_calibrator/io/lut_export.py`
- Modify: `src/photo_calibrator/backend/simple_server.py`

**Step 1: Write test**

Add to `tests/test_image_io.py`:

```python
from photo_calibrator.io.lut_export import write_cube_lut

def test_cube_lut_identity(tmp_path) -> None:
    out = tmp_path / "test.cube"
    write_cube_lut(out, size=17)
    assert out.exists()
    content = out.read_text()
    assert "LUT_3D_SIZE 17" in content
    assert "TITLE" in content
    # 17^3 * 3 float values
    lines = [l for l in content.split("\n") if l.strip() and not l.startswith("#") and not l.startswith("TITLE") and not l.startswith("LUT_3D_SIZE") and not l.startswith("DOMAIN")]
    assert len(lines) == 17 ** 3
```

**Step 2: Implement LUT export**

```python
# src/photo_calibrator/io/lut_export.py
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
        # Generate identity LUT
        axis = np.linspace(0, 1, size, dtype=np.float32)
        r, g, b = np.meshgrid(axis, axis, axis, indexing="ij")
        lut_data = np.stack([r, g, b], axis=-1)
    
    # Flatten in r-fastest order (standard .cube convention)
    flat = lut_data.reshape(-1, 3)
    for row in flat:
        lines.append(f"{row[0]:.6f} {row[1]:.6f} {row[2]:.6f}")
    
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def build_cube_lut_from_calibration(
    a_shift: float,
    b_shift: float,
    strength: float = 0.8,
    size: int = 17,
) -> np.ndarray:
    """Build a .cube LUT approximating a Lab a*/b* shift calibration.
    
    This is a simplified LUT that only encodes the global color shift.
    Local masks (skin, highlights, midtones) cannot be encoded in a 3D LUT.
    """
    # For MVP: identity LUT with note that local masks are not encoded
    # Full implementation would sample the calibration pipeline at each grid point
    axis = np.linspace(0, 1, size, dtype=np.float32)
    r, g, b = np.meshgrid(axis, axis, axis, indexing="ij")
    return np.stack([r, g, b], axis=-1)
```

**Step 3: Wire into `_export_payload()`**

```python
elif fmt == "cube":
    from photo_calibrator.io.lut_export import write_cube_lut
    write_cube_lut(output_path, size=17)
```

**Step 4: Run tests**

Run: `python3 -m pytest tests/test_image_io.py -v -k "cube"`  
Expected: 1 PASS

**Step 5: Commit**

```bash
git add src/photo_calibrator/io/lut_export.py tests/test_image_io.py src/photo_calibrator/backend/simple_server.py
git commit -m "feat: add .cube 3D LUT export (identity LUT skeleton)"
```

---

### Task 11: Update `pyproject.toml` with all optional deps

**Objective:** Consolidate all optional dependency groups.

**File:**
- Modify: `pyproject.toml`

**Changes:**

```toml
[project.optional-dependencies]
dev = [
  "pytest",
]
raw = [
  "rawpy",
]
io = [
  "imageio",
  "tifffile",
]
gpu = [
  "torch",
]
all = [
  "rawpy",
  "torch",
  "imageio",
  "tifffile",
]
```

Also add Pillow to core dependencies (already used in simple_server for TIFF/EXIF):

```toml
dependencies = [
  "numpy",
  "opencv-python",
  "pillow",
]
```

**Step: Verify install**

```bash
pip install -e ".[io]"
python3 -c "import imageio; import tifffile; print('OK')"
```

**Commit:**

```bash
git add pyproject.toml
git commit -m "chore: add io optional deps (imageio, tifffile) and Pillow to core"
```

---

### Task 12: Final integration test and regression check

**Objective:** Run full test suite and verify nothing is broken.

**Steps:**

```bash
# 1. Install all deps
pip install -e ".[io,dev]"

# 2. Compile check
python3 -m compileall -q src tests

# 3. Full Python test suite
python3 -m pytest tests/ -v

# 4. Specific I/O tests
python3 -m pytest tests/test_image_io.py -v

# 5. Backend API tests (including new export)
python3 -m pytest tests/test_simple_server_api.py -v

# 6. Accelerator benchmark still works
PYTHONPATH=src python3 -m photo_calibrator.backend.accelerator_benchmark --backend cpu-opencv --image-side 64 --lut-size 7 --iterations 1

# 7. Backend starts and serves
PYTHONPATH=src python3 -m photo_calibrator.backend.simple_server --port 8766 --accelerator auto &
sleep 2
curl -s http://127.0.0.1:8766/api/health
kill %1
```

**Commit:**

```bash
git commit -m "test: final integration test pass for Phase 2 I/O layer"
```

---

## Verification Checklist

- [ ] `ImageBuffer` accepts float32, uint16, uint8; rejects 4-channel
- [ ] `read_image()` returns correct dtype/range for float TIFF, uint16 PNG, uint8 JPEG
- [ ] `export_jpeg()`, `export_png()`, `export_tiff16()` write correct files
- [ ] HDR/EXR files raise clear "not yet supported" error
- [ ] ICC profile extraction works (returns None for synthetic images)
- [ ] RAW decode moved to `io/raw.py`; existing tests still pass
- [ ] `/api/export` writes JPEG/PNG/TIFF to disk
- [ ] Sidecar JSON roundtrips correctly
- [ ] `.cube` LUT file is valid format
- [ ] All existing tests pass (`python3 -m pytest tests/`)
- [ ] Backend starts and serves health check
- [ ] `compileall` succeeds with no errors
- [ ] No changes to accelerator, calibration algorithm, or frontend

## Files Changed (Summary)

| File | Action |
|------|--------|
| `src/photo_calibrator/io/__init__.py` | Create (from old io.py) |
| `src/photo_calibrator/io/readers.py` | Create |
| `src/photo_calibrator/io/writers.py` | Create |
| `src/photo_calibrator/io/raw.py` | Create |
| `src/photo_calibrator/io/metadata.py` | Create |
| `src/photo_calibrator/io/sidecar.py` | Create |
| `src/photo_calibrator/io/lut_export.py` | Create |
| `src/photo_calibrator/io.py` | Delete (moved to package) |
| `src/photo_calibrator/core/image_model.py` | Modify (dtype-aware upgrade) |
| `src/photo_calibrator/backend/simple_server.py` | Modify (raw import refactor, /api/export endpoint) |
| `tests/test_image_io.py` | Create |
| `tests/test_simple_server_api.py` | Modify (export tests) |
| `pyproject.toml` | Modify (add pillow, imageio, tifffile deps) |

## Open Questions / Risks

1. **OpenImageIO path**: AGENTS.md recommends OIIO for long-term. This plan uses `imageio + tifffile` as MVP. OIIO Python bindings can be added as an optional backend later without changing the public API.
2. **HDR/EXR full support**: Deferred to Phase 3. Current plan only adds detection + clear error. Full HDR pipeline needs tone-mapping, OCIO view transforms, and float export — significant work.
3. **Export at full resolution**: Current export uses the analysis-resolution image (downsampled). Full-resolution export requires replaying calibration on the original image — this is a separate task for Agent D (Backend API / Pipeline).
4. **GPU-accelerated export**: Torch backend exists but this machine has no GPU. CPU fallback is verified.
5. **16-bit JPEG**: Not a real format — JPEG is always 8-bit. Plan correctly only offers JPEG as 8-bit.

---

**Plan complete.** Ready to execute using subagent-driven-development — dispatch per task with TDD cycle, spec review, code review.
