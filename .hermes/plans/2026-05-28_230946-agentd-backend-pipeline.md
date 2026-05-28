# Agent D: Backend API / Pipeline / Cache — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.  
> **Agent role:** Agent D (Backend API / Pipeline / Cache) per AGENTS.md §15.6  
> **Goal:** 将 MVP HTTP 服务稳定为桌面应用可复用的 API 层，完善 session/缓存/批处理/pipeline 骨架。  
> **Architecture:** 拆分 schemas.py + pipeline/ 模块 + cache API + sidecar API + 路由重构。  
> **Tech Stack:** Python 3.12+, dataclasses, ThreadingHTTPServer (保持), NumPy, OpenCV

---

## Context & Constraints

### Current State
- `simple_server.py`: 943 行，单文件。含 `PreparedImage`/`AnalysisEntry` dataclass、LRU 缓存（OrderedDict + Lock）、per-key 并发锁、7 POST + 4 GET 路由（if/elif 链）。
- 缓存：`MEMORY_CACHE_LIMIT=16`，无 TTL，无 stats API，无 clear 端点。
- Session：通过 `session_id`（即 `cache_key`）引用，无生命周期管理。
- 批处理：`ThreadPoolExecutor`，无取消机制，无进度查询。
- 无 `pipeline/` 目录，无 `schemas.py`。
- 响应格式：`_calibration_response()` 返回 `dict` 包含 `input`/`output`/`charts`/`processing` 等，字段全手动拼装。
- 导出：analysis-resolution 图片，非全分辨率。

### Agent D Boundaries (from AGENTS.md §15.6)
- **Files owned:** `backend/simple_server.py`, `backend/schemas.py` (new), `pipeline/` (new), `tests/test_simple_server_api.py`
- **Can do:** Split API schema, add cache stats/clear/SLA, session lifecycle, sidecar save/load API, pipeline skeleton, route dispatch refactoring
- **Cannot do:** Change core algorithm, change frontend UI (only add compatible fields), change accelerator internals
- **Shared contracts not to break:** `CalibrationParams`, `CalibrationResult`, response structure of `/api/calibrate*`, `accelerator_payload()` fields

### Key Risks
- Backward compatibility: all existing API payloads must survive schema extraction unchanged
- Thread safety: cache stats/clear must be atomic with existing LRU logic
- Pipeline abstraction must not slow down the hot path (preview calibration)

---

## Plan: 10 Tasks

### Task 1: Create `schemas.py` — extract request/response models

**Objective:** Move `PreparedImage` and `AnalysisEntry` dataclasses into `schemas.py`, add typed request/response models for all API endpoints. Keep backward compat.

**Files:**
- Create: `src/photo_calibrator/backend/schemas.py`
- Modify: `src/photo_calibrator/backend/simple_server.py` (import from schemas)

**Step 1: Create schemas.py with all data models**

```python
# src/photo_calibrator/backend/schemas.py
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np


@dataclass(frozen=True)
class PreparedImage:
    image: np.ndarray
    original_width: int
    original_height: int
    analysis_width: int
    analysis_height: int
    downsample_ratio: float
    source_dtype: str
    preview_source: str


@dataclass(frozen=True)
class AnalysisEntry:
    prepared: PreparedImage
    input_report: object
    zones: dict
    static_charts: dict
    cache_key: str
    created_at: float


@dataclass
class CalibrateRequest:
    """POST /api/calibrate, /api/calibrate-session"""
    image_data: str | None = None
    file_name: str = ""
    mode: str = "global"
    strength: float = 0.8
    highlight_pct: float = 55.0
    sat_pct: float = 25.0
    analysis_max_side: int = 1800
    session_id: str | None = None
    include_original: bool = True


@dataclass
class ExportRequest:
    """POST /api/export"""
    image_data: str = ""
    file_name: str = ""
    mode: str = "global"
    strength: float = 0.8
    output_path: str = ""
    format: str = "jpeg"
    quality: int = 92


@dataclass
class BatchItem:
    image_data: str
    file_name: str = ""


@dataclass
class CalibrateBatchRequest:
    items: list[dict] = field(default_factory=list)
    mode: str = "global"
    strength: float = 0.8
    analysis_max_side: int = 1800
    workers: int = 2
```

**Step 2: Update simple_server imports, replace local dataclass definitions with imports**

```python
from photo_calibrator.backend.schemas import PreparedImage, AnalysisEntry
```

Remove the local `@dataclass(frozen=True) class PreparedImage` and `AnalysisEntry` definitions.

**Step 3: Verify**

Run: `python3 -m pytest tests/ -q`  
Expected: 84 passed (no regression)

**Step 4: Commit**

```bash
git add src/photo_calibrator/backend/schemas.py src/photo_calibrator/backend/simple_server.py
git commit -m "refactor(backend): extract PreparedImage/AnalysisEntry into schemas.py"
```

---

### Task 2: Add `AnalyticsEntry.created_at` → TTL-based session expiry

**Objective:** Sessions should expire after a configurable TTL. Add expiry check in `_get_analysis()`.

**Files:**
- Modify: `src/photo_calibrator/backend/simple_server.py`

**Step 1: Write test**

```python
# In tests/test_simple_server_api.py
def test_session_expires_after_ttl(monkeypatch) -> None:
    from photo_calibrator.backend import simple_server
    
    # Set TTL to 0 so entry expires immediately
    monkeypatch.setattr(simple_server, "SESSION_TTL_SECONDS", 0)
    simple_server._ANALYSIS_CACHE.clear()
    
    payload = simple_server._calibrate_payload({
        "image_data": sample_data_url(),
        "file_name": "test.png",
    })
    session_id = payload["session_id"]
    
    # Second call should fail because TTL=0
    with pytest.raises(ValueError, match="expired"):
        simple_server._calibrate_session_payload({
            "session_id": session_id,
            "mode": "global",
        })
```

**Step 2: Implement TTL**

```python
SESSION_TTL_SECONDS = 3600  # 1 hour default

def _get_analysis(cache_key: str) -> AnalysisEntry | None:
    with _CACHE_LOCK:
        entry = _ANALYSIS_CACHE.get(cache_key)
        if entry is None:
            return None
        if time.time() - entry.created_at > SESSION_TTL_SECONDS:
            _ANALYSIS_CACHE.pop(cache_key, None)
            _ANALYSIS_KEY_LOCKS.pop(cache_key, None)
            return None
        _ANALYSIS_CACHE.move_to_end(cache_key)
        return entry
```

**Step 3: Update _calibrate_session_payload error message**

Change `"Unknown or expired session_id"` to include "or expired".

**Step 4: Run test**

Run: `pytest tests/test_simple_server_api.py::test_session_expires_after_ttl -v`  
Expected: PASS

**Step 5: Commit**

---

### Task 3: Add cache management API (`GET /api/cache/stats`, `POST /api/cache/clear`)

**Objective:** Expose cache statistics and allow cache clearing via HTTP.

**Files:**
- Modify: `src/photo_calibrator/backend/simple_server.py`
- Modify: `tests/test_simple_server_api.py`

**Step 1: Write tests**

```python
def test_cache_stats_reports_hit_count() -> None:
    from photo_calibrator.backend import simple_server
    simple_server._ANALYSIS_CACHE.clear()
    
    # Populate cache
    simple_server._calibrate_payload({
        "image_data": sample_data_url(),
        "file_name": "a.png",
    })
    
    stats = simple_server._cache_stats_payload()
    assert stats["items"] == 1
    assert stats["limit"] == 16
    assert "ttl_seconds" in stats
    assert "oldest_age_seconds" in stats


def test_cache_clear_empties_cache() -> None:
    from photo_calibrator.backend import simple_server
    simple_server._calibrate_payload({
        "image_data": sample_data_url(),
        "file_name": "b.png",
    })
    assert len(simple_server._ANALYSIS_CACHE) >= 1
    
    result = simple_server._cache_clear_payload()
    assert result["ok"] is True
    assert len(simple_server._ANALYSIS_CACHE) == 0
```

**Step 2: Implement functions**

```python
def _cache_stats_payload() -> dict:
    with _CACHE_LOCK:
        items = []
        now = time.time()
        for key, entry in _ANALYSIS_CACHE.items():
            items.append({
                "key": key[-32:],  # truncated for readability
                "age_seconds": now - entry.created_at,
                "preview_source": entry.prepared.preview_source,
            })
        return {
            "items": len(_ANALYSIS_CACHE),
            "limit": MEMORY_CACHE_LIMIT,
            "ttl_seconds": SESSION_TTL_SECONDS,
            "oldest_age_seconds": items[0]["age_seconds"] if items else 0,
        }


def _cache_clear_payload() -> dict:
    count = 0
    with _CACHE_LOCK:
        count = len(_ANALYSIS_CACHE)
        _ANALYSIS_CACHE.clear()
        _ANALYSIS_KEY_LOCKS.clear()
    return {"ok": True, "cleared": count}
```

**Step 3: Add routes**

In `do_GET`:
```python
if parsed.path == "/api/cache/stats":
    self._send_json(_cache_stats_payload())
    return
```

In `do_POST`:
```python
if self.path == "/api/cache/clear":
    self._send_json(_cache_clear_payload())
    return
```

**Step 4: Run tests**

Run: `pytest tests/test_simple_server_api.py -k "cache" -v`  
Expected: 2 PASS

**Step 5: Commit**

---

### Task 4: Add sidecar save/load API

**Objective:** `POST /api/sidecar/save` and `GET /api/sidecar/load` for calibration parameter persistence.

**Files:**
- Modify: `src/photo_calibrator/backend/simple_server.py`
- Modify: `tests/test_simple_server_api.py`

**Step 1: Write tests**

```python
def test_sidecar_save_and_load(tmp_path) -> None:
    from photo_calibrator.backend.simple_server import _sidecar_save_payload, _sidecar_load_payload
    
    sidecar_path = tmp_path / "test.calib.json"
    
    # Save
    result = _sidecar_save_payload({
        "path": str(sidecar_path),
        "calibration": {"mode": "midtones-only", "a_shift": -1.2, "b_shift": 3.4, "strength": 0.7},
        "algorithm_version": "0.3.0",
    })
    assert result["ok"] is True
    
    # Load
    loaded = _sidecar_load_payload({"path": str(sidecar_path)})
    assert loaded["calibration"]["mode"] == "midtones-only"
    assert loaded["calibration"]["a_shift"] == -1.2
    assert loaded["algorithm_version"] == "0.3.0"
```

**Step 2: Implement**

```python
def _sidecar_save_payload(body: dict) -> dict:
    from photo_calibrator.io.sidecar import write_sidecar_json
    path = Path(body["path"])
    calib = body.get("calibration", {})
    version = body.get("algorithm_version", "0.2.0")
    metadata = body.get("input_metadata")
    write_sidecar_json(path, calib, algorithm_version=version, input_metadata=metadata)
    return {"ok": True, "path": str(path), "size": path.stat().st_size}


def _sidecar_load_payload(body: dict) -> dict:
    from photo_calibrator.io.sidecar import read_sidecar_json
    return read_sidecar_json(body["path"])
```

**Step 3: Add routes**

```python
# POST
if self.path == "/api/sidecar/save":
    self._send_json(_sidecar_save_payload(body))
    return

# GET (use query param for path)
if parsed.path == "/api/sidecar/load":
    query = parse_qs(parsed.query)
    self._send_json(_sidecar_load_payload({"path": query["path"][0]}))
    return
```

**Step 4: Run tests**

**Step 5: Commit**

---

### Task 5: Route dispatch refactoring — from if/elif to dispatch dict

**Objective:** Replace the long `if/elif` chains in `do_POST` and `do_GET` with a dispatch dictionary. Cleaner, faster, easier to extend.

**Files:**
- Modify: `src/photo_calibrator/backend/simple_server.py`

**Step 1: Define dispatch tables**

```python
_POST_ROUTES: dict[str, Callable[[dict], dict]] = {}

def _register_post(path: str):
    def decorator(fn):
        _POST_ROUTES[path] = fn
        return fn
    return decorator


_GET_ROUTES: dict[str, Callable[[dict], dict]] = {}

def _register_get(path: str):
    def decorator(fn):
        _GET_ROUTES[path] = fn
        return fn
    return decorator
```

**Step 2: Decorate existing handlers**

```python
@_register_post("/api/analyze")
def _analyze_payload(body: dict) -> dict:
    report = analyze_image_array(_decode_data_url(body["image_data"]))
    return {"input": _report_payload(report)}

@_register_post("/api/calibrate")
def _calibrate_payload(body: dict) -> dict:
    # ... existing implementation ...

# etc for all 7 POST + 4 GET routes
```

**Step 3: Simplify Handler.do_POST / do_GET**

```python
def do_POST(self) -> None:
    try:
        length = int(self.headers.get("Content-Length", "0"))
        body = json.loads(self.rfile.read(length).decode("utf-8"))
        handler = _POST_ROUTES.get(self.path)
        if handler is None:
            self.send_error(404)
            return
        self._send_json(handler(body))
    except Exception as exc:
        self._send_json({"error": str(exc)}, status=400)
```

**Step 4: Verify full test suite passes**

Run: `python3 -m pytest tests/ -q`  
Expected: 84+ passed

**Step 5: Commit**

---

### Task 6: Create `pipeline/` module skeleton

**Objective:** Establish the non-destructive pipeline graph abstraction per AGENTS.md architecture.

**Files:**
- Create: `src/photo_calibrator/pipeline/__init__.py`
- Create: `src/photo_calibrator/pipeline/document.py`
- Create: `src/photo_calibrator/pipeline/operations.py`
- Create: `tests/test_pipeline.py`

**Step 1: Define base Operation class**

```python
# src/photo_calibrator/pipeline/operations.py
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np


@dataclass(frozen=True)
class Operation:
    """Abstract pipeline operation node."""
    name: str
    params: dict[str, Any] = field(default_factory=dict)

    def apply(self, image: np.ndarray) -> np.ndarray:
        raise NotImplementedError


@dataclass(frozen=True)
class LabShiftOp(Operation):
    """Lab a*/b* channel shift — the most common calibration operation."""
    name: str = "lab-shift"
    
    def apply(self, image: np.ndarray) -> np.ndarray:
        a_shift = self.params.get("a_shift", 0.0)
        b_shift = self.params.get("b_shift", 0.0)
        strength = self.params.get("strength", 0.8)
        from photo_calibrator.core.calibration import calibrate_global
        return calibrate_global(image, a_shift, b_shift, strength)


@dataclass(frozen=True)
class IdentityOp(Operation):
    """No-op passthrough."""
    name: str = "identity"
    
    def apply(self, image: np.ndarray) -> np.ndarray:
        return image
```

**Step 2: Define Document (pipeline graph)**

```python
# src/photo_calibrator/pipeline/document.py
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .operations import Operation


@dataclass
class PipelineDocument:
    """Non-destructive editing graph: source image + ordered operations."""
    
    source_image: np.ndarray
    operations: list[Operation] = field(default_factory=list)
    
    def add_op(self, op: Operation) -> None:
        self.operations.append(op)
    
    def remove_op(self, index: int) -> None:
        del self.operations[index]
    
    def render(self) -> np.ndarray:
        """Apply all operations in order to produce output image."""
        img = self.source_image
        for op in self.operations:
            img = op.apply(img)
        return img
    
    def render_at(self, index: int) -> np.ndarray:
        """Render up to operation index (for undo/redo preview)."""
        img = self.source_image
        for op in self.operations[:index + 1]:
            img = op.apply(img)
        return img
    
    @property
    def op_count(self) -> int:
        return len(self.operations)
```

**Step 3: Write tests**

```python
# tests/test_pipeline.py
import numpy as np
from photo_calibrator.pipeline.operations import LabShiftOp, IdentityOp
from photo_calibrator.pipeline.document import PipelineDocument

def test_identity_op_returns_same_image() -> None:
    img = np.zeros((16, 16, 3), dtype=np.uint8)
    img[:, :] = 128
    op = IdentityOp()
    result = op.apply(img)
    assert np.array_equal(result, img)

def test_pipeline_document_applies_ops_in_order() -> None:
    img = np.zeros((16, 16, 3), dtype=np.uint8)
    img[:, :] = 128
    doc = PipelineDocument(source_image=img)
    doc.add_op(LabShiftOp(params={"a_shift": 0, "b_shift": 0, "strength": 0}))
    result = doc.render()
    assert result.shape == img.shape

def test_pipeline_document_undo_redo() -> None:
    img = np.zeros((16, 16, 3), dtype=np.uint8)
    img[:, :] = 128
    doc = PipelineDocument(source_image=img)
    doc.add_op(IdentityOp())
    doc.add_op(IdentityOp())
    assert doc.op_count == 2
    doc.remove_op(0)
    assert doc.op_count == 1
```

**Step 4: Run tests**

Run: `pytest tests/test_pipeline.py -v`  
Expected: 3 PASS

**Step 5: Commit**

---

### Task 7: Add full-resolution calibration replay via PipelineDocument

**Objective:** The current `/api/calibrate-path` and `/api/export` use analysis-resolution images. Add a new endpoint that replays calibration on the full-resolution image, using `PipelineDocument`.

**Files:**
- Modify: `src/photo_calibrator/backend/simple_server.py`
- Modify: `tests/test_simple_server_api.py`

**Step 1: Write test**

```python
def test_fullres_calibrate_path_uses_original_resolution(tmp_path) -> None:
    import cv2
    from photo_calibrator.backend.simple_server import _fullres_calibrate_path_payload
    
    # Create a test image larger than analysis max_side
    path = tmp_path / "large.tif"
    img = np.zeros((400, 600, 3), dtype=np.uint8)
    img[:, :] = (100, 120, 150)
    cv2.imwrite(str(path), img)
    
    result = _fullres_calibrate_path_payload({
        "path": str(path),
        "mode": "global",
        "strength": 0.8,
        "analysis_max_side": 100,  # much smaller than 600
    })
    assert result["processing"]["analysis_width"] <= 100  # analysis was small
    assert "fullres_image" in result  # but output is full resolution
```

**Step 2: Implement `_fullres_calibrate_path_payload()`**

This loads the image at full resolution, applies calibration (using the same params computed from analysis), and returns the full-res calibrated image.

```python
def _fullres_calibrate_path_payload(body: dict) -> dict:
    start = time.perf_counter()
    path = body["path"]
    max_side = int(body.get("analysis_max_side", DEFAULT_ANALYSIS_MAX_SIDE))
    
    # 1. Run analysis at reduced resolution
    entry = _prepare_file_analysis(path, max_side=max_side)
    
    # 2. Compute calibration params from analysis
    mode = CalibrationMode(body.get("mode", CalibrationMode.GLOBAL.value))
    params = CalibrationParams(
        mode=mode,
        strength=float(body.get("strength", 0.8)),
    )
    result = calibrate_image_from_analysis(
        entry.prepared.image, params, entry.input_report, entry.zones
    )
    
    # 3. Load full-res image
    from photo_calibrator.io.readers import read_image
    full_buf = read_image(path)
    
    # 4. Build and replay pipeline on full-res
    from photo_calibrator.pipeline.document import PipelineDocument
    from photo_calibrator.pipeline.operations import LabShiftOp
    
    doc = PipelineDocument(source_image=full_buf.data)
    doc.add_op(LabShiftOp(params={
        "a_shift": result.a_shift,
        "b_shift": result.b_shift,
        "strength": params.strength,
    }))
    fullres_calibrated = doc.render()
    
    response = _calibration_response(entry, result, entry.prepared.image,
                                      (time.perf_counter() - start) * 1000.0)
    response["fullres_image"] = _encode_data_url(fullres_calibrated)
    return response
```

**Step 3: Add route**

```python
if self.path == "/api/calibrate-fullres":
    self._send_json(_fullres_calibrate_path_payload(body))
    return
```

**Step 4: Run tests**

**Step 5: Commit**

---

### Task 8: Add batch progress query and cancellation

**Objective:** `GET /api/batch/status?batch_id=...` and `POST /api/batch/cancel` for long-running batch operations.

**Files:**
- Modify: `src/photo_calibrator/backend/simple_server.py`
- Modify: `tests/test_simple_server_api.py`

**Step 1: Write test**

```python
def test_batch_status_tracks_progress(tmp_path) -> None:
    import cv2
    from photo_calibrator.backend import simple_server
    
    # Create files
    paths = []
    for i in range(3):
        p = tmp_path / f"img{i}.tif"
        img = np.zeros((40, 60, 3), dtype=np.uint8)
        img[:, :] = (100, 120, 150)
        cv2.imwrite(str(p), img)
        paths.append(str(p))
    
    # Run batch via the non-blocking path (for now, just verify status payload)
    result = simple_server._calibrate_paths_payload({
        "paths": paths,
        "analysis_max_side": 80,
    })
    assert result["workers"] > 0
    assert len(result["results"]) == 3
    assert all("calibrated_image" in r for r in result["results"])
```

**Step 2: Implement batch status tracking**

Add a module-level dict to track batch progress:

```python
_BATCH_STATUS: dict[str, dict] = {}
_BATCH_STATUS_LOCK = Lock()

def _batch_status_payload(batch_id: str) -> dict:
    with _BATCH_STATUS_LOCK:
        return _BATCH_STATUS.get(batch_id, {"error": "unknown batch_id"})


def _batch_cancel_payload(body: dict) -> dict:
    batch_id = body["batch_id"]
    with _BATCH_STATUS_LOCK:
        status = _BATCH_STATUS.get(batch_id)
        if status:
            status["cancelled"] = True
    return {"ok": True, "batch_id": batch_id}
```

**Step 3: Add routes**

```python
# GET /api/batch/status?batch_id=xxx
if parsed.path == "/api/batch/status":
    query = parse_qs(parsed.query)
    self._send_json(_batch_status_payload(query["batch_id"][0]))
    return

# POST /api/batch/cancel
if self.path == "/api/batch/cancel":
    self._send_json(_batch_cancel_payload(body))
    return
```

**Step 4: Run tests**

**Step 5: Commit**

---

### Task 9: Add `/api/export-path` for direct file-to-file export

**Objective:** Current `/api/export` requires a data URL. Add `/api/export-path` that accepts a local file path, calibrates, and exports directly to disk.

**Files:**
- Modify: `src/photo_calibrator/backend/simple_server.py`
- Modify: `tests/test_simple_server_api.py`

**Step 1: Write test**

```python
def test_export_path_writes_calibrated_file(tmp_path) -> None:
    import cv2
    from photo_calibrator.backend.simple_server import _export_path_payload
    
    src = tmp_path / "src.tif"
    dst = tmp_path / "out.jpg"
    img = np.zeros((60, 80, 3), dtype=np.uint8)
    img[:, :] = (100, 120, 150)
    cv2.imwrite(str(src), img)
    
    result = _export_path_payload({
        "input_path": str(src),
        "output_path": str(dst),
        "mode": "global",
        "format": "jpeg",
    })
    assert result["ok"] is True
    assert dst.exists()
```

**Step 2: Implement**

```python
def _export_path_payload(body: dict) -> dict:
    start = time.perf_counter()
    input_path = body["input_path"]
    output_path = Path(body["output_path"]).resolve()
    fmt = body.get("format", "jpeg")
    max_side = int(body.get("analysis_max_side", DEFAULT_ANALYSIS_MAX_SIDE))
    
    entry = _prepare_file_analysis(input_path, max_side=max_side)
    mode = CalibrationMode(body.get("mode", CalibrationMode.GLOBAL.value))
    params = CalibrationParams(
        mode=mode,
        strength=float(body.get("strength", 0.8)),
    )
    result = calibrate_image_from_analysis(
        entry.prepared.image, params, entry.input_report, entry.zones
    )
    
    from photo_calibrator.core.image_model import ImageBuffer
    from photo_calibrator.io.writers import write_image
    buf = ImageBuffer(data=result.image)
    write_image(buf, output_path, quality=int(body.get("quality", 92)))
    
    elapsed_ms = (time.perf_counter() - start) * 1000.0
    return {
        "ok": True,
        "path": str(output_path),
        "format": fmt,
        "size": output_path.stat().st_size,
        "elapsed_ms": elapsed_ms,
    }
```

**Step 3: Add route**

```python
if self.path == "/api/export-path":
    self._send_json(_export_path_payload(body))
    return
```

**Step 4: Run tests**

**Step 5: Commit**

---

### Task 10: Final integration test and regression check

**Objective:** Run full test suite, verify all existing tests pass, check new route count.

**Steps:**

```bash
# 1. Compile check
python3 -m compileall -q src tests

# 2. Full test suite
python3 -m pytest tests/ -v

# 3. Count routes
python3 -c "
from photo_calibrator.backend.simple_server import _POST_ROUTES, _GET_ROUTES
print(f'POST routes: {len(_POST_ROUTES)}')
print(f'GET routes: {len(_GET_ROUTES)}')
for path in sorted(_POST_ROUTES):
    print(f'  POST {path}')
for path in sorted(_GET_ROUTES):
    print(f'  GET  {path}')
"

# 4. Start server and smoke test
PYTHONPATH=src python3 -m photo_calibrator.backend.simple_server --port 8766 &
sleep 1
curl -s http://127.0.0.1:8766/api/health
curl -s http://127.0.0.1:8766/api/cache/stats
kill %1
```

**Commit**

---

## Verification Checklist

- [ ] `schemas.py` contains all data models; `simple_server.py` imports from it
- [ ] Session TTL expiry works (tested)
- [ ] `GET /api/cache/stats` returns correct counts, oldest age, TTL
- [ ] `POST /api/cache/clear` empties cache
- [ ] `POST /api/sidecar/save` and `GET /api/sidecar/load` roundtrip
- [ ] Route dispatch uses dict instead of if/elif
- [ ] PipelineDocument applies operations in order; supports undo/redo
- [ ] Full-res calibration produces image at original resolution
- [ ] `/api/export-path` works with local file paths
- [ ] Batch status tracking exists
- [ ] All existing tests pass (84+)
- [ ] compileall clean
- [ ] Health check responds

## API Surface After Agent D

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/capabilities` | Accelerator info |
| GET | `/api/accelerator-benchmark` | Run benchmark |
| GET | `/api/cache/stats` | **New** — cache statistics |
| GET | `/api/sidecar/load?path=` | **New** — load sidecar JSON |
| GET | `/api/batch/status?batch_id=` | **New** — batch progress |
| POST | `/api/analyze` | Analyze image |
| POST | `/api/calibrate` | Calibrate (data URL) |
| POST | `/api/calibrate-session` | Calibrate (session) |
| POST | `/api/calibrate-batch` | Batch calibrate (uploads) |
| POST | `/api/calibrate-path` | Calibrate (local path) |
| POST | `/api/calibrate-paths` | Batch calibrate (paths) |
| POST | `/api/calibrate-fullres` | **New** — full-res calibration |
| POST | `/api/export` | Export (data URL) |
| POST | `/api/export-path` | **New** — export (local path) |
| POST | `/api/sidecar/save` | **New** — save sidecar JSON |
| POST | `/api/cache/clear` | **New** — clear cache |
| POST | `/api/batch/cancel` | **New** — cancel batch |

## Files Changed (Summary)

| File | Action |
|------|--------|
| `src/photo_calibrator/backend/schemas.py` | Create |
| `src/photo_calibrator/backend/simple_server.py` | Modify (schemas import, TTL, cache API, sidecar API, route dispatch, fullres, export-path, batch tracking) |
| `src/photo_calibrator/pipeline/__init__.py` | Create |
| `src/photo_calibrator/pipeline/document.py` | Create |
| `src/photo_calibrator/pipeline/operations.py` | Create |
| `tests/test_pipeline.py` | Create |
| `tests/test_simple_server_api.py` | Modify (new endpoint tests) |

## Risks

- Route dispatch refactoring must preserve exact same behavior for all existing routes
- Cache TTL check adds a time call per lookup — negligible overhead (~ns)
- PipelineDocument is a skeleton; full undo/redo history + serialization is Phase 4
- Batch cancellation is cooperative — in-flight workers can't be killed mid-computation without ProcessPoolExecutor
