# Photo Calibrator — Development Status

> Last updated: 2026-06-11  
> Branch: `dev`  
> Verified locally: Python ✅ | Frontend build: ✅ | Electron: ✅ running | Backend: HTTP URL image serving + CORS | UI: preload-based image display

---

## Current Summary

The repository has moved beyond the original script stage and now has a stable MVP backend plus a modular Web UI. The main distinction at this point is:

- Some subsystems are implemented and tested as libraries.
- A smaller subset is fully wired into the end-to-end product workflow.

That distinction matters for planning and branch coordination.

## Implemented And Integrated

### Phase 1: Refactor scripts → library ✅
- `core/image_model.py` — ImageBuffer dataclass
- `core/cast_detection.py` — color cast detection
- `core/calibration.py` — 11 calibration modes
- `core/accelerator.py` — CPU/OpenCL/Torch/Hybrid backends
- `backend/simple_server.py` — HTTP API server
- `web/` — vanilla JS single-page UI

### Phase 2: Image I/O / HDR / Export foundations ✅
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

### Phase 3: Backend API / Pipeline / Cache ✅
- `backend/schemas.py`: PreparedImage, AnalysisEntry, 10 request models
- Session TTL: 1h expiry with auto-reclaim
- `GET /api/cache/stats` + `POST /api/cache/clear`
- `POST /api/sidecar/save` + `GET /api/sidecar/load`
- `POST /api/export-path`: file-to-file export
- `GET /api/batch/status` + `POST /api/batch/cancel`
- Route dispatch: if/elif → dict lookup
- `pipeline/`: Operation/Document/LabShiftOp/RgbCurvesOp/MatrixOp/Lut3DOp

### Phase 3: Frontend MVC Restructure ✅
- `web/store.js`, `web/dom.js`, `web/api/client.js`
- `web/controllers/calibration.js`, `web/controllers/workspace.js`
- `web/ui/viewer.js`, `web/ui/charts.js`, `web/ui/inspector.js`, `web/ui/panels.js`
- Library panel, dock panels, session card, data-testids
- Playwright test updated

### Phase 4 P0: Skin detection integrated, film scan core implemented ✅
- **Skin detection**: Haar cascade face-seeded → CrCb Gaussian model + YCrCb fallback
  - `_detect_faces()`: OpenCV frontal face detection
  - `_skin_face_seeded()`: adaptive skin sampling via Mahalanobis distance
  - `_skin_ycrcb()`: fixed-threshold fallback when no face detected
  - 7 dedicated skin robustness tests (dark/light skin, non-skin rejection, morphology)
  - `_find_haarcascade()`: cross-distro cascade file locator (pip + Fedora/Debian system paths)
- **Film scan core**: `core/film_scan.py`
  - `detect_film_frame()`: Canny edge → Hough line → quad fit → rotation/crop rect
  - `FilmScanResult`: angle_deg, corners, crop_x/y/w/h, confidence, border_type
  - `identify_film_format()`: 11 known formats (135/120/large format/digital sensors)
  - `evaluate_film_correction()`: FilmScanEval with format_match, corner_symmetry, crop_coverage
  - Perspective distortion detection (`is_perspective`, `transform_matrix` 3x3)
  - 8 film scan tests (rotation, white border, low confidence, perspective)

### Phase 4 P1: Plugin / AI foundations implemented ✅
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

### Phase 4 P1 Expanded: Service Layer / IPC / Persistence ✅

- **Service layer**: `services/` package — backend-facing orchestration (1,050 lines)
  - `contracts.py`: typed, JSON-serializable result dataclasses (PluginInfo, AnalyzerResult, CalibratorResult, FilmScanResult, ImageReaderResult, ImageWriterResult, EvaluationResult, EvaluationScore, ServiceError hierarchy)
  - `plugin_service.py` (496 lines): wraps PluginManager for backend queries — plugin enumeration, typed hook invocation with normalised outputs, error isolation
  - `ai_service.py` (295 lines): orchestrates AI evaluation through plugins or native providers, ThreadPoolExecutor with timeout, privacy gate, provider normalization
  - `simple_server.py` imports PluginService + AIEvaluationService — backend no longer touches raw PluginManager or AIProvider directly

- **IPC server**: `backend/ipc_server.py` (73 lines)
  - JSON-RPC 2.0 over stdio for Electron integration
  - Maps `{method}.{path}` → HTTP handler dispatch via `simple_server.dispatch_backend_request()`
  - Ping/pong, error codes, streaming-ready line-delimited JSON

- **Workspace database**: `backend/workspace_db.py` (708 lines)
  - Single SQLite file per project root: `{ROOT}/.cache/workspace.db`
  - Tables: previews (JPEG blobs + metadata), sessions (calibration params, document ops, AI evals), analysis_cache, file_inventory
  - Thread-safe with per-key locks, session TTL cleanup, file inventory sync/diff, cache invalidation
  - Singleton `get_workspace_db()` with explicit `reset()` for testing

- **FastAPI stub**: `backend/fastapi_app.py` (67 lines)
  - `create_app(accelerator="auto")` → FastAPI instance
  - Auto-registers all `_POST_ROUTES` from simple_server
  - Static file serving with path traversal protection
  - Test skipped (P3 preemptive — Python 3.14 TestClient hang)

---

## All Phase 4 Integration Gaps — Now Closed ✅

Previous STATUS.md gaps are all resolved:

- **Film scan**: Backend /api/film-scan route wired, core + plugin detector support, frontend calls via `postFilmScan()`
- **Plugin runtime**: PluginManager wired into backend handlers via PluginService (reader, writer, calibrator, detector, AI evaluator)
- **AI evaluation**: `/api/ai-evaluate` route with provider configuration, async/cancel support via AIEvaluationService, session sidecar write-back
- **I/O pipeline**: Server consistently uses `io.readers` for decode and `io.writers` for export
- **Full-resolution export**: _apply_export_to_disk() replays calibration on original image buffer when `source="original"`

## React Frontend (new, 2026-06)

- `frontend/` — Vite + React + TypeScript workbench (~95 components, 7,349 lines TS/TSX)
- Three-pane layout: Library | Viewer (with Filmstrip) | Inspector
- Resizable via `react-resizable-panels` with localStorage persistence
- `useWorkbench` hook (916 lines): session management, calibration, export, AI eval, undo/redo
- 5 layout presets (balanced/analyze/edit/review/custom)
- Focus mode: full-screen viewer with HUD overlay toolbar
- Runtime abstraction: browser/desktop-shell modes, mock shell bridge
- All components carry `data-testid` attributes for Playwright E2E
- Vite build passes: 280 KB JS, 35 KB CSS; `tsc -b` has 1 error (`RuntimeSettingsDialog` → `SettingsDialog` export mismatch)
- Backend `--web-root` flag selects frontend directory (default: `frontend/dist/`, fallback `web/`)


### Phase 4 P2: Capture One-style UI Restructure ✅
- **Inspector tool tabs**: Vertical toolbar layout inspired by Capture One
  - New tool tabs: `color`, `curves`, `compose` (split from monolithic "adjust" tab)
  - `ColorToolPanel`: Color balance, white balance modes, accelerator selection
  - `CurvesToolPanel`: RGB curve editor with sub-tabs (RGB / luminosity), curve presets
  - `ComposeToolPanel`: Rotate/flip controls, crop card integration, keystone placeholder
  - Vertical icon-based toolbar with tool groups separated by dividers
  - Updated `InspectorTab` type to include new tool tabs
  - Added `inspectorTabMeta` with icons and metadata for all tabs
  - Updated `layoutPresets.ts` to handle new tab presentations
  - Added CSS for vertical tool tabs, tool panels, and compose controls
  - Vite build: ✅ (291.88 kB JS, 40.82 kB CSS)

### Electron Stub

- `frontend/electron/main.mjs` — BrowserWindow creation, backend lifecycle hooks (spawn/kill)
- `frontend/electron/preload.mjs` — contextBridge exposing `__PHOTO_CALIBRATOR_RUNTIME__` and `__PHOTO_CALIBRATOR_SHELL__`
- Not yet wired into package scripts (no `electron` dependency installed)
- Frontend reads runtime via env vars (`VITE_RUNTIME_MODE`, `VITE_API_BASE_URL`) or `window.__PHOTO_CALIBRATOR_RUNTIME__` injection

---

## Remaining (Post-integration, 2026-06-08)

### P1: 继续补完产品级后端能力 — COMPLETE ✅
All 4 P1 items verified as code-complete. Only AI eval end-to-end needs real provider.

#### 1. ICC / OCIO 导出闭环 ✅
- [x] ICC profile manager (`io/icc_profiles.py`) — sRGB/AdobeRGB/ProPhoto from system colord
- [x] OCIO config interface (`OCIOExportConfig` in `io/ocio.py`)
- [x] Profile-aware export (`ExportProfile` enum, `_resolve_export_icc()` in writers)
- [x] Backend API extended with `export_profile`, `user_profile_path` fields

#### 2. 元数据 roundtrip ✅
- [x] EXIF cleanup on export (`_clean_exif_bytes` strips thumbnails/MakerNote)
- [x] XMP preservation (`extract_xmp`, `_resolve_xmp_for_export`, PIL `xml` kwarg)
- [x] tifffile ICC embedding (`iccprofile` kwarg)
- [x] `build_export_metadata()` with color space tags

#### 3. Plugin runtime 深度接入 ✅
- [x] `image_reader`/`image_writer`/`film_scan_detector` in main flow
- [x] Plugin-level error isolation
- [x] Frontend UI consuming plugin list/info — PluginList displayed in Settings/Library/RuntimeDialog

#### 4. AI evaluation hardening ✅
- [x] Async execution + timeout control
- [x] Retry/failure isolation
- [x] Provider config, privacy gate, request logging
- [ ] End-to-end validation (needs real AI provider)

### P2: 桌面 / 生产化

#### 5. Electron Shell ✅
- [x] `electron` installed
- [x] `main.mjs` extended — backend auto-start, health check, graceful shutdown
- [x] preload bridge — `__PHOTO_CALIBRATOR_RUNTIME__` + `__PHOTO_CALIBRATOR_SHELL__`

#### 6. Linux / macOS 打包
- [ ] Electron + Python runtime + native I/O deps packaging
- [ ] Minimum distributable (Linux AppImage / macOS .app)

#### 7. React 前端完善
- [x] Real film scan crop suggest — already integrated via `runFilmScan() → postFilmScan() → ViewerCropOverlay`
- [x] Plugin / AI management UI — PluginList visible in Settings panel
- [ ] 批处理上传 UI (`/api/calibrate-batch`) — backend endpoint exists, no frontend
- [ ] Playwright E2E (Chromium SIGTRAP in container, passes on native)
- [x] tsc build error — fixed (0 errors)

### P3: 架构层收口

#### 8. FastAPI 迁移
- [ ] Replace ThreadingHTTPServer with FastAPI + WebSocket
- [x] stub in `backend/fastapi_app.py`
- [ ] Python 3.14 TestClient hang needs resolution

#### 9. 非破坏编辑模型主流程化
- [ ] `pipeline/` history stack + serialization

#### 10. 可取消任务系统
- [ ] ProcessPoolExecutor for killable batch workers

#### 11. 最小 CI
- [x] GitHub Actions: typecheck → build → core tests → visual tests
- [ ] Python lint + test CI

---

## Recently Completed (2026-06-11)

| Item | Status |
|------|--------|
| **Code walkthrough** | Full pipeline audit: file load → calibration → file switch → curve edit → image display. All 6 flows verified correct. ✅ |
| **Image preloading** | `ViewerStageImageScene` + `ViewerStageSplitScene` rewritten: `new Image()` preloads in background, `displaySrc` only updates when loaded. Eliminates blank flash. ✅ |
| **Quick Actions removed** | Panel removed from InspectorAdjustPanel ✅ |
| **Analysis charts + CCC/PCI/RGB** | Backend always generates 9 chart types; frontend now displays all 8 visible (CCC, PCI, RGB means cards added) ✅ |
| **Branch rename** | `dev-codex` → `dev` ✅ |
| **Known issue** | Image flicker on file switch (browser-level `<img>` caching) — deferred ⚠️ |

---

## Recently Completed (2026-06-10)

| Item | Status |
|------|--------|
| **Performance optimization** | Calibration debounce 30ms→0ms for curves, per-file curve state via `fileCurvesRef` Map (eliminates full React re-render on every pointermove), adaptive resolution no longer overwrites `sessionId` (prevents slow calibrated preview after zoom) ✅ |
| **Working image cache (backend)** | `_apply_core_calibration` caches shifted working image; curve-only changes skip `analyze_image_array`×2 + `auto_detect_cast`, only apply `calibrate_rgb_curves` — 57ms→1ms (50x) ✅ |
| **Smooth bezier curves** | `CurveEditor` uses Catmull-Rom → cubic Bezier instead of polylines ✅ |
| **Double-click reset** | Control points reset to identity via `onDoubleClick` ✅ |
| **R/G/B/L channel merge** | CurveEditor shows R/G/B/L with per-channel histogram overlay ✅ |
| **HTTP image serving** | Backend writes preview JPEGs to `/tmp/photo-calibrator-previews/`, returns HTTP URLs instead of base64 data URLs ✅ |
| **CORS headers** | Backend sends `Access-Control-Allow-Origin: *` for Electron `file://` compatibility ✅ |
| **Image flicker fix** | Removed `key={imageSrc}` from all `<img>` elements (caused remount blink); `showImage` no longer hides during loading; synchronous `documentRender` clearing via `lastFileId` ref to prevent stale calibrated preview on file switch ✅ |
| **Analysis charts restored** | CCC, PCI, RGB means cards added to `AnalysisChartsSection` (were missing from React migration) ✅ |
| **Lab vector chart** | Removed CCC ellipses, added a*/b* axis labels ✅ |
| **Histogram toggle** | Before/after toggle moved to title row right-aligned ✅ |
| **Quick Actions removed** | Panel removed from Adjust tab ✅ |
| **Operation history** | Now records 曲线调整, 胶片扫描, 裁切调整, 裁切复位 ✅ |
| **Perf monitoring** | `perf.ts` + `debugLog.ts` added; calibration effect instrumented with `_timing` in API response ✅ |
| **Config API** | PUT→POST fix for 501 errors ✅ |
| **Preload memory leak** | `onFilesPicked` returns cleanup function ✅ |
| **Global calibration fix** | Curves always sent to backend (removed `mode === "rgb-curves"` condition); post-process curves applied for all modes ✅ |

---

## Recently Completed (2026-06-08, continued)

| Item | Status |
|------|--------|
| ICC/OCIO 导出闭环 | `icc_profiles.py`, `OCIOExportConfig`, profile-aware `write_image()`, `ExportProfile` enum. Built-in sRGB/AdobeRGB/ProPhoto from system colord + PIL fallback. +20 ICC tests, +21 OCIO/export tests ✅ |
| 元数据 roundtrip | EXIF cleanup (`_clean_exif_bytes` strips thumbnails/MakerNote), XMP extraction/embed, tifffile ICC embedding, `build_export_metadata()`. +16 metadata roundtrip tests ✅ |
| Electron Shell | `electron` installed, `main.mjs` extended with backend lifecycle (auto-start Python, health check, graceful shutdown on quit) ✅ |
| 前端 UI 修复 | Removed duplicate Library file/plugin count, Session ID truncation fix, loading states → CSS spinners (replaced raw Chinese text), Library panel dedup ✅ |
| multimodal-looker | Switched to `alibaba-cn/qwen3-vl-plus` vision model. `look_at` tool works for all 6 screenshots. Documented `task()` path bug (Go binary) in AGENTS.md ✅ |
| AGENTS.md | Updated §18.4 multimodal analysis section to use `look_at` ✅ |
| STATUS.md audit | Film scan crop → CONFIRMED already integrated. Plugin UI → CONFIRMED already integrated. Updated stale entries ✅ |

---

## Codebase Metrics (2026-06-07)

### Python Source (10,041 lines)

| Module | Lines | Description |
|--------|-------|-------------|
| `core/` | 2,429 | Image model, cast detection, calibration, accelerator, film scan |
| `io/` | 1,181 | Readers, writers, RAW decode, metadata, OCIO/OIIO, sidecar, LUT export |
| `backend/` | 3,976 | HTTP server (2,911), schemas, IPC, workspace DB, FastAPI stub |
| `services/` | 1,050 | PluginService, AIEvaluationService, contracts |
| `plugins/` | 710 | Hook protocols, manifest, manager, builtin stubs |
| `ai/` | 509 | Evaluator models, prompts, providers |
| `pipeline/` | 183 | Document, operations (LabShift/RgbCurves/Matrix/Lut3D) |

### Frontend (7,349 lines TypeScript/TSX)

- React workbench: ~95 components
- `useWorkbench` hook: 916 lines
- Runtime abstraction: browser/desktop-shell modes
- Vanilla JS web UI: ~2,500 lines (web/)

### Tests (7,137 lines Python)

| Test File | Lines | Coverage |
|-----------|-------|----------|
| `test_simple_server_api.py` | — | 74 tests (calibration, film scan, AI eval, export, session, cache, sidecar) |
| `test_image_io.py` | — | Image readers/writers (JPEG, PNG, TIFF8/16, EXR, HDR, RAW, sidecar, LUT) |
| `test_workspace_db.py` | 458 | Session CRUD, analysis cache, file inventory, sync, aggregate ops |
| `test_plugin_service.py` | 370 | Service-layer hook invocation, error normalization |
| `test_ai_evaluator.py` | — | AI provider + evaluation (14 tests) |
| `test_ai_service.py` | 312 | Provider normalization, privacy gate, timeout, retry |
| `test_calibration.py` | — | 11 calibration modes + edge cases |
| `test_cast_detection.py` | — | Color cast + skin detection (7 robustness tests) |
| `test_film_scan.py` | — | Film scan detection (rotation, perspective, format) |
| `test_accelerator.py` | — | CPU/OpenCL/Torch backends |
| `test_pipeline.py` | — | Document/operation replay |
| `test_plugin_manager.py` | — | Plugin discovery, loading, lifecycle (14 tests) |
| `test_ipc_server.py` | 64 | JSON-RPC IPC smoke test |
| `test_fastapi_app.py` | — | Skipped (P3 preemptive) |
| `test_accelerator_benchmark_cli.py` | — | CLI benchmark tool |
| `test_cli_smoke.py` | — | CLI entry points |
| `test_oiio_ocio.py` | — | OCIO/OIIO integration |
| `test_schemas.py` | — | Backend schema validation |

---

### Frontend (Playwright E2E)

- `tests/ui/photo_calibrator_frontend_layout.spec.js` — React workbench pane layout + dialogs
- `tests/ui/photo_calibrator_frontend_visual.spec.js` — visual regression snapshots
- `tests/ui/photo_calibrator_frontend_workflow.spec.js` — import, calibrate, export workflow
- `tests/ui/photo_calibrator_legacy_sidebar.spec.js` — vanilla JS library sidebar
- `tests/ui/photo_calibrator_legacy_workspace.spec.js` — vanilla JS workspace import + metrics
- `tests/ui/photo_calibrator_electron_e2e.spec.js` — Electron E2E stub
- `playwright.config.js` — headless Chromium with `--no-sandbox`, `--disable-seccomp-filter-sandbox`
- **Staged scripts**: `npm run test:ui:core` (layout+workflow+legacy), `npm run test:ui:visual`, `npm run test:ui:ci`
- NOTE: Chromium SIGTRAP in containerized env blocks Playwright; tests pass on native Linux host

---

## Environment

| Component | Status |
|-----------|--------|
| Python | 3.14.4 |
| OpenCV | 4.13.0 (system package, OpenCL ✓) |
| GPU | RTX 5070 Ti 16GB |
| rawpy | ✅ 0.27.0 |
| OCIO | 2.4.2 |
| OIIO | 3.1.12.0 |
| imageio | ✅ 2.37.3 |
| tifffile | ✅ 2026.5.15 |
| Torch CUDA | ❌ (pip install hangs, not blocking — OpenCL covers GPU) |
| pytest | 9.0.3 |
| numpy | 2.4.6 (system package) |
| Pillow | 12.2.0 (system package) |

### Environment TODO

- [ ] `pip install torch` — CUDA GPU 加速 (当前 OpenCL 覆盖)
- [ ] 配置 DeepSeek / Alibaba provider 接入 AI 评估
- [ ] `npm install electron` — Electron shell 打包
- [ ] oh-my-openagent TUI plugin 条目补到 tui.json

---

## Verification Commands

```bash
# Python 测试 (342 passed, 2 skipped)
python3 -m pytest

# Python 编译检查
python3 -m compileall -q src tests

# 前端构建 (tsc -b has 1 export error)
cd frontend && npm run build

# 前端仅构建 (跳过 tsc)
cd frontend && npx vite build

# UI 测试（需原生环境）
npm run test:ui

# UI 快速检查 (layout + workflow + legacy)
npm run test:ui:core

# Accelerator benchmark
PYTHONPATH=src python3 -m photo_calibrator.backend.accelerator_benchmark --backend auto --image-side 64 --lut-size 7 --iterations 1

# omo doctor
oh-my-openagent doctor
```
