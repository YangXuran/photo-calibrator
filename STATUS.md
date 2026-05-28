# Photo Calibrator — Development Status

> Last updated: 2026-05-28  
> Branch: `dev-codex`  
> Tests: 145 passed / 1 skipped | Coverage: 83%

---

## Completed

### Phase 1: Refactor scripts → library ✅
- `core/image_model.py` — ImageBuffer dataclass
- `core/cast_detection.py` — color cast detection
- `core/calibration.py` — 11 calibration modes
- `core/accelerator.py` — CPU/OpenCL/Torch/Hybrid backends
- `backend/simple_server.py` — HTTP API server
- `web/` — vanilla JS single-page UI

### Phase 2: Image I/O / HDR / Export (Agent B) ✅
- `io/` package (readers, writers, raw, metadata, sidecar, lut_export)
- ImageBuffer: float32/uint16 support, auto bit_depth/data_range, is_hdr, icc_profile
- `read_image()`: imageio → cv2 fallback, HDR/EXR → OIIO
- `export_jpeg()` / `export_png()` / `export_tiff16()` / `write_image()`
- `POST /api/export`: jpeg/png/tiff16/sidecar/cube
- RAW decode via rawpy (`io/raw.py`)
- HDR/EXR detection + OIIO integration

### Phase 2.5: OCIO + OIIO ✅
- OCIO: sRGB↔scene-linear via PyOpenColorIO + NumPy fallback
- OIIO: EXR/HDR read/write, integrated into `read_image()`
- System deps: `dnf install python3-openimageio OpenColorIO`

### Phase 3: Backend API / Pipeline / Cache (Agent D) ✅
- `backend/schemas.py`: PreparedImage, AnalysisEntry, 10 request models
- Session TTL: 1h expiry with auto-reclaim
- `GET /api/cache/stats` + `POST /api/cache/clear`
- `POST /api/sidecar/save` + `GET /api/sidecar/load`
- `POST /api/export-path`: file-to-file export
- `GET /api/batch/status` + `POST /api/batch/cancel`
- Route dispatch: if/elif → dict lookup
- `pipeline/`: Operation/Document/LabShiftOp/RgbCurvesOp/MatrixOp/Lut3DOp

### Phase 3: Frontend MVC Restructure (Agent E) ✅
- `web/store.js`, `web/dom.js`, `web/api/client.js`
- `web/controllers/calibration.js`, `web/controllers/workspace.js`
- `web/ui/viewer.js`, `web/ui/charts.js`, `web/ui/inspector.js`, `web/ui/panels.js`
- Library panel, dock panels, session card, data-testids
- Playwright test updated

---

## Remaining

### Phase 4: Electron Shell + Film Scan + Plugin System

| Priority | Task | Agent | Details |
|----------|------|-------|---------|
| P0 | **Film scan auto-level/crop** | C | `core/film_scan.py`: Canny→Hough→quad fit, low-confidence skip |
| P0 | **Skin detection robustness** | C | Replace HSV heuristics with more robust masking |
| P1 | **Plugin system skeleton** | F | `plugins/`: manifest validation, hook API, builtin stubs |
| P1 | **AI evaluator interface** | F | `ai/`: provider-agnostic schema, no direct image mutation |
| P1 | **ICC/OCIO export pipeline** | D/F | `.cube` LUT completion, ICC profile embedding, OCIO config gen |
| P2 | **Electron Shell** | E | Desktop window, menus, file dialogs, backend lifecycle |
| P2 | **Full-resolution export** | D | Replay calibration on original image, not analysis preview |
| P3 | **FastAPI migration** | D | Replace ThreadingHTTPServer with FastAPI + WebSocket |
| P3 | **Non-destructive edit model** | D | History stack + serialization in `pipeline/` |
| P3 | **Batch true cancellation** | D | ProcessPoolExecutor for killable batch workers |

### Phase 5: AI Evaluation + Packaging

| Task | Details |
|------|---------|
| AI provider interface | At least one configurable provider (OpenAI/Claude/local) |
| Privacy confirmation UI | Upload consent, request logging, retry on failure |
| Linux/macOS packaging | Electron + Python runtime + native I/O deps |
| Minimal CI | lint, test, build smoke test |

---

## Environment

| Component | Status |
|-----------|--------|
| Python | 3.14.4 |
| OpenCV | 4.13.0 (OpenCL ✓) |
| GPU | RTX 5070 Ti 16GB (OpenCL UMat) |
| rawpy | 0.27.0 (LibRaw) |
| OCIO | 2.4.2 |
| OIIO | 3.1.12.0 |
| imageio | ✓ |
| tifffile | ✓ |
| Torch CUDA | ❌ (pip install hangs, not blocking — OpenCL covers GPU) |
