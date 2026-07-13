# Photo Calibrator - Development Status

> Last updated: 2026-07-13
> Branch: `main`
> Product runtime: Electron + React/Vite/TypeScript + Python HTTP backend
> Local API: `http://127.0.0.1:8766`

## Current Summary

Photo Calibrator is a runnable macOS Electron desktop application, not a script or browser-only prototype. The primary UI is `frontend/`; `web/` is retained as a legacy/lightweight interface and is not the product shell.

The main local workflow is integrated end to end:

1. Open a photo or folder through the Electron bridge.
2. Decode JPEG/PNG/TIFF/RAW/HDR/EXR through the Python I/O layer.
3. Prepare cached previews and adaptive-resolution renderer images.
4. Analyze color cast and render histogram/Lab/CCC/PCI metrics.
5. Apply deterministic calibration, visual auto-style controls, curves, film-scan crop, perspective correction, rotation and flip operations.
6. Persist per-folder state and history in `photo-calibrator.db`.
7. Replay the selected operations against the original file for export.

## Integrated Product Capabilities

### Desktop And Frontend

- Electron starts and stops the Python backend and loads the Vite renderer in development.
- `npm run dev` is the single local debug command.
- Inspector tabs are `Adjust`, `Curves`, `Compose`, `AI`, `Export`, `Session`, and `Settings`.
- The left pane is the persistent `Analysis` pane; duplicate Color/Analysis/Library panels were removed.
- The filmstrip maintains independent edit state and history for each file.
- Range and curve drags update previews continuously but commit one history action on release.
- Adaptive previews upgrade 320 px preparation images to the Retina/display resolution required by the viewer. Editing uses `InteractivePreviewController` for session gating, coalesced fast calibration requests, stale-frame guards and timing telemetry, then settles to a 640-2400 px high-resolution preview after interaction.
- Local path-backed thumbnails can be hydrated through `/api/preview-batch`, so folder imports do not need one backend preview request per file.
- Split comparison uses two fixed-size image layers in one frame; the divider changes only `clip-path`, so cropped images do not resize while sliding.
- Viewer-stage HUDs and split controls are independent of the image zoom/pan transform layer. Loading badges stay screen-sized, split dividers stay aligned during zoom, and live drag previews in split mode are constrained to the calibrated layer only.
- A concise project `README.md` now documents the project intent, local-first calibration goal, current architecture and basic run/test commands.

### Workspace Database And History

- Each writable photo folder uses `<folder>/photo-calibrator.db`.
- `WorkspaceDB` instances are registered by normalized database path and isolated across folders.
- File identity uses normalized path, size, mtime and partial content hash.
- Folder open returns `fresh`, `restored`, or `modified`; changed/deleted files invalidate stale sessions, previews and history.
- Sessions persist calibration parameters, curves, crop/application state, image transforms, document operations, preview BLOB and history cursor.
- Undo/redo is persistent, redo branches are truncated after a new action, and history is limited to the latest 50 actions per file.
- Read-only folders continue with in-memory editing and expose a visible “history not persisted” status.

### Film Scan, Crop And Geometry

- `/api/film-scan` is integrated with the core detector and plugin detector hook.
- Detection uses edge/band candidates, weighted fitting, sprocket exclusion, confidence diagnostics and GPU-capable accelerator paths where available.
- Detect creates an editable suggestion only; `Apply crop` explicitly commits it.
- When a detected frame has perspective distortion, `/api/film-scan` returns `perspective_correction` with normalized corners. Applying the crop submits crop and perspective together.
- Applying crop makes Original and Calibrated use the same cropped geometry in dual, split and calibrated-only views.
- The processing order is calibration -> perspective correction if present -> projected source-space crop -> flip/rotation, so preview and export use the same geometry.
- Detect cancels stale adaptive-preview work and clears an older suggestion before showing the new result.
- Export and batch export use the same crop/transform ordering as the preview.
- The Compose panel shows perspective status (`not detected`, `pending apply`, `applied`) instead of a placeholder.

### Calibration, Curves And Analysis

- Global, zone-aware, skin/highlight protection, negative-film and other calibration modes are wired into session preview and full-resolution export.
- Auto calibration now has a visual `auto_style` layer: preset chips, a restore/film vs soft/contrast style map, and a Lab color compass. The style expands to neutralization strength, look preservation, warm/cool and green/magenta bias, tone policy, highlight protection and skin priority while keeping old `strength` requests compatible.
- Negative film calibration is supported without filename-based classification.
- R/G/B/L Catmull-Rom curve editing provides local drag previews and commits on pointer release.
- A committed curve refreshes the real backend histogram after release.
- Analysis includes RGB histograms, Lab vectors, CCC, PCI, RGB means, zone metrics and LUT radar data where available.

### I/O, Export, Plugins And AI

- RAW decode uses rawpy/LibRaw; TIFF/EXR/HDR use the dtype-aware readers with optional OIIO/OCIO paths.
- JPEG, PNG, TIFF16, EXR/HDR, sidecar JSON and `.cube` export paths are available.
- Original-resolution export replay, metadata policy and ICC/OCIO export configuration are integrated.
- Plugin reader/writer/analyzer/calibrator/film-scan/AI hooks are exposed through `PluginService` with error isolation.
- AI evaluation has provider configuration, privacy gating, timeout/retry handling and session write-back; real-provider validation remains environment-dependent.

### Accelerator

- Available backends include `cpu-opencv`, `opencl-umat`, Torch CUDA/MPS and hybrid selection.
- macOS `auto` uses `hybrid-cpu-mps`: optimized 10-thread OpenCV handles the faster image/color kernels and MPS handles 3D LUTs.
- Torch `2.12.1` is bundled in the arm64 backend; MPS initializes after HTTP startup so the UI is not blocked by Torch loading.
- Interactive previews are capped at 1600px and `fast` session requests reuse cached input analysis instead of recalculating input/output reports.
- Unsupported GPU operations fall back to CPU rather than failing the edit.
- Backend capabilities cover resize, RGB grayscale, Gaussian blur, Sobel profile, RGB/Lab, Lab/RGB, curve LUT, matrix, histogram and 3D LUT, with backend-specific fallback subsets.
- The synthetic benchmark currently measures resize, RGB/Lab, Lab/RGB, curve LUT, matrix and 3D LUT operations. Capability reporting and benchmark execution are intentionally distinct contracts.

### Performance Diagnostics

- All JSON API routes now pass through one `dispatch_backend_request()` instrumentation point used by both direct dispatch and the HTTP handler.
- `PerformanceMonitor` keeps thread-safe per-route counts, errors, average/max/latest latency and a bounded list of requests above the anomaly threshold. It stores no request body, image path or image data.
- `GET /api/performance` returns the current diagnostic window; `POST /api/performance/reset` clears it.
- Monitoring is enabled by default with a 750 ms anomaly threshold. `PHOTO_CALIBRATOR_PERF_MONITOR=0` disables it; `PHOTO_CALIBRATOR_PERF_THRESHOLD_MS` and `PHOTO_CALIBRATOR_PERF_BUFFER_LIMIT` configure the window.

### Unified Desktop Runtime

- Electron now owns backend lifecycle through `BackendSupervisor` instead of scattered start/stop functions.
- The supervisor distinguishes externally configured and Electron-managed backends, allocates a free loopback port for managed processes, publishes lifecycle failures and supports explicit reconnect/restart.
- `/api/health` carries a service identity and API version. Electron will not accept an unrelated HTTP service merely because it returns status 200.
- The context-isolated `__PHOTO_CALIBRATOR_APP__` bridge streams runtime changes to React. The frontend API client resolves the current backend URL per request, so a restart can safely move to another port.
- Settings displays ownership/state/URL/error details and exposes a reconnect action. Browser mode retains the existing direct-HTTP fallback.
- The development-only runtime banner (`Desktop Shell / ChromaFrame Desktop / API URL`) has been removed from the main workspace; detailed runtime diagnostics remain available in Settings.

## Packaging

- macOS arm64 packaging scripts exist:
  - `npm --prefix frontend run package:backend:mac`
  - `npm --prefix frontend run package:dmg:arm64`
- Electron Builder includes the PyInstaller backend as an application resource.
- A local unsigned DMG can be produced for testing.
- The Torch-enabled arm64 build is approximately 849MB installed / 288MB DMG; signing and notarization are still required.
- Distribution hardening still requires signing, notarization, minimum-macOS validation and repeatable native dependency checks.
- Linux AppImage packaging remains outstanding.

## Current UI Structure

```text
Top bar
├── undo / redo
├── Analysis / Filmstrip / Inspector / Focus toggles
└── open photo / open folder / help

Workbench
├── Analysis pane: histogram, Lab, CCC, PCI, zones, LUT analysis
├── Viewer
│   ├── dual / split / calibrated-only comparison
│   ├── adaptive-resolution image stage and crop HUD
│   └── filmstrip
└── Inspector
    ├── Adjust: calibration mode and strength
    ├── Curves: R/G/B/L curves
    ├── Compose: rotate, flip, crop application, perspective correction status
    ├── AI
    ├── Export: single and batch export
    ├── Session: history, saved sessions and activity
    └── Settings: runtime, accelerator, plugins and AI provider
```

## Remaining Priorities

### P1 - Release Quality

- Sign and notarize the macOS DMG; test on a clean Apple Silicon machine.
- Define supported macOS versions and verify native rawpy/OIIO/OCIO library lookup inside the packaged app.
- Add Linux packaging and CI packaging smoke tests.
- Complete license inventory for Electron, OpenCV, LibRaw/rawpy, OIIO, OCIO and bundled profiles.

### P2 - Image Pipeline Quality

- Formalize the internal working color space and display transform instead of relying on mixed preview-era assumptions.
- Add camera profiles/DCP and explicit RAW white-balance contracts.
- Persist a separate cropped original preview so restored workspaces retain a true before/after comparison instead of a calibrated fallback.
- Add a manual four-corner perspective editor and persist perspective as a first-class `pipeline.Document` operation. Automatic film-scan perspective replay is already wired through preview/export.
- Add a preview pyramid and disk cache governance for very large folders.

### P3 - Architecture

- Replace the MVP `ThreadingHTTPServer` with FastAPI/WebSocket or local IPC when streaming jobs require it.
- Move long-running work to a genuinely cancellable process/job model.
- Promote `pipeline.Document` operations to the canonical backend edit graph rather than maintaining parallel session fields.
- Add plugin permission boundaries beyond trusted local Python plugins.
- Retire or merge completed multi-agent workstreams once their functionality is stable, tested and no longer needs file-ownership isolation.

## Code Walk Findings (2026-07-13)

- Removed a duplicate `PREVIEW_CACHE_DIR` assignment whose first value was always overwritten; disposable previews remain in the host temporary directory, while saved sessions remain under the repository cache directory.
- The HTTP POST handler previously bypassed the existing shared dispatcher. POST and GET JSON APIs now use the same dispatch contract, which is also the single performance instrumentation boundary.
- Calibrator plugin compatibility previously caught any `TypeError` and retried the plugin, which could hide an internal plugin bug and execute it twice. Hook context is now filtered from the callable signature, preserving legacy `(image, params)` plugins without swallowing plugin exceptions.
- Preview/static file containment previously used string-prefix checks, which are not a valid directory boundary for same-prefix sibling paths. The shared check now uses resolved `Path.relative_to()` semantics.
- Optional OpenImageIO reads now consume OIIO's global error state before returning `None` on open failure, avoiding misleading pending-error output at process shutdown.
- Pillow access for trusted local photos now scopes out the expected large-scan warning and malformed TIFF tag-count warning while retaining Pillow's hard decompression-bomb error limit. The dev launcher filters only the known macOS IMK mach-port diagnostic from Electron stderr.
- `backend/schemas.py` currently contains dataclasses, not Pydantic models; project documentation now describes the implementation accurately. Pydantic remains a possible future API migration choice rather than a current dependency.
- The package currently declares Python `>=3.10` in `pyproject.toml`. Python 3.12 remains the recommended development/package target, but code must not claim it is the enforced minimum until the package metadata changes.

## Verification

Use the project virtual environment on macOS:

```bash
# Complete Python suite
.venv/bin/python -m pytest -q

# Python syntax/import compilation
.venv/bin/python -m compileall -q src tests

# Frontend typecheck and production build
npm --prefix frontend run typecheck
npm --prefix frontend run build

# Real Electron E2E suite
npm run test:ui

# Local development application
npm run dev

# Accelerator smoke benchmark
PYTHONPATH=src .venv/bin/python -m photo_calibrator.backend.accelerator_benchmark \
  --backend auto --image-side 64 --lut-size 7 --iterations 1

# macOS arm64 DMG
npm --prefix frontend run package:dmg:arm64
```

Latest verification on 2026-07-13:

- Full Python suite: `.venv/bin/python -m pytest -q` -> `353 passed`.
- Electron runtime and log-filter unit suite -> `5 passed`.
- Python compileall, frontend typecheck and production build passed.
- Accelerator smoke selected `hybrid-cpu-mps`; CPU handled the regular kernels and MPS handled 3D LUT as intended.
- Full Electron E2E suite -> `15 passed`, including the unified App bridge and external-backend reconnect path.
- A real `npm run dev` managed-mode smoke started Vite, Electron and the Python backend without a pre-launched API, reached `hybrid-cpu-mps`, and left no listener on port 8766 after shutdown.

Earlier UI/geometry verification through 2026-07-04 includes:

- Crop suggestion -> explicit apply -> Original/Calibrated geometry alignment.
- Film-scan perspective detection returns normalized `perspective_correction`; crop and perspective are replayed together in preview and export.
- Crop application combined with rotation/flip and negative-film export.
- Folder thumbnail hydration uses `/api/preview-batch` for local path-backed files with single-image fallback for uploads.
- Adaptive-resolution preview after switching real TIFF files.
- Split comparison at 20% and 80% with invariant image geometry.
- Split comparison divider remains visible and aligned during manual zoom; the image transform layer intentionally has no `transform` transition.
- Curve and look-wheel drag previews in split comparison render only inside the calibrated image layer and do not cover the original side.
- Manual Computer Use inspection of a cropped negative in Electron.
- Full Python suite on 2026-07-04: `.venv/bin/python -m pytest -q` -> `341 passed, 1 warning`.
- Targeted API and film-scan suites on 2026-07-04: `tests/test_simple_server_api.py` -> `104 passed`; `tests/test_film_scan.py` -> `20 passed`.

The stale accelerator capability assertion has been replaced with a required-subset assertion. On `Capture00183.NEF`, a cached 1600px fast calibration measured about 101ms versus about 4.8s for the previous 3200px full-analysis path. Frozen MPS 3D LUT measured about 48ms after warm-up versus about 301ms on CPU.

Code and current test output take precedence over historical numbers.
