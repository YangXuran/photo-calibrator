# Photo Calibrator — Development Status

> Last updated: 2026-05-29  
> Branch: `dev-codex`  
> Tests: 182 passed / 10 failed / 1 skipped | Coverage: ~83%

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

### Phase 4 P0: Film Scan + Skin Detection (Agent C) ✅
- **Skin detection**: Haar cascade face-seeded → CrCb Gaussian model + YCrCb fallback
  - `_detect_faces()`: OpenCV frontal face detection
  - `_skin_face_seeded()`: adaptive skin sampling via Mahalanobis distance
  - `_skin_ycrcb()`: fixed-threshold fallback when no face detected
  - 7 dedicated skin robustness tests (dark/light skin, non-skin rejection, morphology)
  - `_find_haarcascade()`: cross-distro cascade file locator (pip + Fedora/Debian system paths)
- **Film scan**: `core/film_scan.py`
  - `detect_film_frame()`: Canny edge → Hough line → quad fit → rotation/crop rect
  - `FilmScanResult`: angle_deg, corners, crop_x/y/w/h, confidence, border_type
  - `identify_film_format()`: 11 known formats (135/120/large format/digital sensors)
  - `evaluate_film_correction()`: FilmScanEval with format_match, corner_symmetry, crop_coverage
  - Perspective distortion detection (`is_perspective`, `transform_matrix` 3x3)
  - 8 film scan tests (rotation, white border, low confidence, perspective)

### Phase 4 P1: Plugin System + AI Evaluator (Agent F) ✅
- **Plugin system**: `plugins/` package
  - `hooks.py`: protocol definitions (AnalyzerHook, CalibratorHook, ImageReaderHook, ImageWriterHook, FilmScanDetectorHook, AIEvaluatorHook)
  - `api.py`: manifest validation, `@register` decorator, `PluginManifest` schema
  - `manager.py`: `PluginManager` — discovery, loading, lifecycle, hook query (`list_for_hook`)
  - `builtin/noop.py`: bundled stub plugin for testing
  - 14 plugin manager tests
- **AI evaluator**: `ai/` package
  - `evaluators.py`: EvalImageRef, EvalInput, EvalOutput, EvalScore data models
  - `prompts.py`: reusable, provider-agnostic evaluation prompt templates
  - 5 evaluator tests
- **AI provider layer**: `ai/providers.py`
  - `OpenAICompatibleProvider`: single class covers Ollama / llama.cpp / vLLM / OpenAI / DeepSeek / Groq
  - Zero new deps: stdlib `urllib` only
  - `MockProvider`: deterministic mock for testing/offline use
  - `ProviderConfig`: base_url, api_key, model, max_tokens, temperature
  - 9 provider tests
- **i18n**: `web/i18n.js`
  - en/zh translation layer with `t("key")` API
  - `data-i18n` / `data-i18n-aria` / `data-i18n-alt` HTML attributes
  - `translateDOM()` auto-replaces static text on load / locale switch
  - All ~120 UI strings migrated to i18n keys

---

## Remaining

### Phase 4: P1/P2/P3

| Priority | Task | Details |
|----------|------|---------|
| P1 | **ICC/OCIO export pipeline** | `.cube` LUT completion, ICC profile embedding, OCIO config gen |
| P2 | **Electron Shell** | Desktop window, menus, file dialogs, backend lifecycle |
| P2 | **Full-resolution export** | Replay calibration on original image, not analysis preview |
| P3 | **FastAPI migration** | Replace ThreadingHTTPServer with FastAPI + WebSocket |
| P3 | **Non-destructive edit model** | History stack + serialization in `pipeline/` |
| P3 | **Batch true cancellation** | ProcessPoolExecutor for killable batch workers |

### Phase 5: AI Evaluation + Packaging

| Task | Details |
|------|---------|
| AI evaluation integration | Wire providers into calibration evaluation pipeline |
| Privacy confirmation UI | Upload consent, request logging, retry on failure |
| Linux/macOS packaging | Electron + Python runtime + native I/O deps |
| Minimal CI | lint, test, build smoke test |

---

## Environment

| Component | Status |
|-----------|--------|
| Python | 3.14.4 |
| OpenCV | 4.13.0 (system package, OpenCL ✓) |
| GPU | RTX 5070 Ti 16GB |
| rawpy | ❌ (not installed — `pip install rawpy` or `dnf install python3-rawpy`) |
| OCIO | 2.4.2 |
| OIIO | 3.1.12.0 |
| imageio | ❌ (not installed — `pip install imageio tifffile` for TIFF tests) |
| tifffile | ❌ (see imageio) |
| Torch CUDA | ❌ (pip install hangs, not blocking — OpenCL covers GPU) |
| pytest | 9.0.3 |
| numpy | 2.4.6 (system package) |
| Pillow | 12.2.0 (system package) |
