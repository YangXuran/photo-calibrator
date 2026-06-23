# Photo Calibrator - Development Status

> Last updated: 2026-06-22
> Branch: `dev`
> Product runtime: Electron + React/Vite/TypeScript + Python HTTP backend
> Local API: `http://127.0.0.1:8766`

## Current Summary

Photo Calibrator is a runnable macOS Electron desktop application, not a script or browser-only prototype. The primary UI is `frontend/`; `web/` is retained as a legacy/lightweight interface and is not the product shell.

The main local workflow is integrated end to end:

1. Open a photo or folder through the Electron bridge.
2. Decode JPEG/PNG/TIFF/RAW/HDR/EXR through the Python I/O layer.
3. Prepare cached previews and adaptive-resolution renderer images.
4. Analyze color cast and render histogram/Lab/CCC/PCI metrics.
5. Apply deterministic calibration, curves, crop, rotation and flip operations.
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
- Adaptive previews upgrade 320 px preparation images to the Retina/display resolution required by the viewer.
- Split comparison uses two fixed-size image layers in one frame; the divider changes only `clip-path`, so cropped images do not resize while sliding.

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
- Detection uses edge/band candidates, weighted fitting, confidence diagnostics and GPU-capable accelerator paths where available.
- Detect creates an editable suggestion only; `Apply crop` explicitly commits it.
- Applying crop makes Original and Calibrated use the same cropped geometry in dual, split and calibrated-only views.
- The processing order is calibration -> source-space crop -> flip/rotation, so the crop region rotates with the image.
- Detect cancels stale adaptive-preview work and clears an older suggestion before showing the new result.
- Export and batch export use the same crop/transform ordering as the preview.

### Calibration, Curves And Analysis

- Global, zone-aware, skin/highlight protection, negative-film and other calibration modes are wired into session preview and full-resolution export.
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
- Benchmark coverage includes resize, RGB/Lab, Lab/RGB, curve LUT, matrix and 3D LUT operations.

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
    ├── Compose: rotate, flip, crop application, keystone placeholder
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
- Finish keystone/perspective editing in the Compose panel.
- Add a preview pyramid and disk cache governance for very large folders.

### P3 - Architecture

- Replace the MVP `ThreadingHTTPServer` with FastAPI/WebSocket or local IPC when streaming jobs require it.
- Move long-running work to a genuinely cancellable process/job model.
- Promote `pipeline.Document` operations to the canonical backend edit graph rather than maintaining parallel session fields.
- Add plugin permission boundaries beyond trusted local Python plugins.

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

Recent targeted verification on 2026-06-22 includes:

- Crop suggestion -> explicit apply -> Original/Calibrated geometry alignment.
- Crop application combined with rotation/flip and negative-film export.
- Adaptive-resolution preview after switching real TIFF files.
- Split comparison at 20% and 80% with invariant image geometry.
- Manual Computer Use inspection of a cropped negative in Electron.

Full Python suite result on 2026-06-23: `315 passed`. The stale accelerator capability assertion has been replaced with a required-subset assertion. On `Capture00183.NEF`, a cached 1600px fast calibration measured about 101ms versus about 4.8s for the previous 3200px full-analysis path. Frozen MPS 3D LUT measured about 48ms after warm-up versus about 301ms on CPU.

Code and current test output take precedence over historical numbers.
