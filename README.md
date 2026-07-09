# ChromaFrame

ChromaFrame is a local-first desktop workbench for photo color analysis, calibration, film-frame correction and scan cleanup.

## Why This Project Exists

Digital photo correction tools are often split between two extremes: simple filters that hide the color problem, and professional suites that are powerful but heavy, opaque and hard to automate. This project started from a more practical goal: build a transparent tool that can tell a photographer what is wrong with a photo's color, show the evidence, make deterministic corrections, and still leave room for personal color taste.

The goal is not to replace a full raw editor. The goal is to provide a focused calibration workspace for color cast analysis, negative-film conversion, film-frame crop cleanup, repeatable export and batch workflows.

## What It Does

- Opens photos and folders in an Electron desktop app.
- Supports JPEG, PNG, TIFF, RAW and HDR/EXR-oriented workflows through a Python backend.
- Analyzes color cast with RGB histograms, Lab vectors, CCC/PCI metrics and zone statistics.
- Applies calibration modes, negative-film base processing, RGB/L curves and look adjustments.
- Detects film-scan borders, suggests crop, and applies crop explicitly.
- Supports rotate, flip, split comparison, dual comparison and calibrated-only preview.
- Saves per-folder sessions, previews, undo/redo history and file fingerprints in `photo-calibrator.db`.
- Exports calibrated images and batch results by replaying edits against the source file.
- Includes accelerator backends with CPU fallback and optional GPU paths.

## Current Shape

The main product UI is `frontend/`: React + Vite + TypeScript inside Electron.

The backend is Python under `src/photo_calibrator/`, currently exposed through a local HTTP server. The older `web/` directory is kept as a lightweight legacy interface and is not the main product shell.

## Run Locally

```bash
npm run dev
```

This starts Vite, Electron and the local Python backend. The default backend API is:

```text
http://127.0.0.1:8766
```

Useful checks:

```bash
.venv/bin/python -m pytest -q
npm --prefix frontend run typecheck
npm --prefix frontend run build
npm run test:ui
```

Build a local macOS arm64 DMG:

```bash
npm --prefix frontend run package:dmg:arm64
```

## GitHub Packaging

The repository has two GitHub Actions workflows:

- `Generated Smoke`: runs on push, pull request and manual dispatch. It generates synthetic test images, runs the backend smoke path, typechecks the frontend and builds the renderer.
- `Package macOS`: runs manually for packaging checks, and on `v*` tags for release builds. Manual runs upload a short-lived Actions artifact. Tag runs also create or update a GitHub Release with the macOS arm64 DMG.

Create a release build by pushing a version tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

## Architecture

```text
frontend/                 Electron product UI
src/photo_calibrator/core  color analysis, calibration, film scan, accelerator
src/photo_calibrator/io    image readers, writers, RAW, metadata, LUT export
src/photo_calibrator/pipeline
                           non-destructive edit graph experiments
src/photo_calibrator/backend
                           local API, preview/session/export orchestration
src/photo_calibrator/plugins
                           plugin hook system
src/photo_calibrator/ai    optional AI evaluation providers
tests/                     Python and Electron E2E tests
```

## Design Principles

- Local first: editing should not require cloud services.
- Evidence first: show analysis data, not just a magic correction button.
- Non-destructive by default: detect and preview before committing changes.
- Deterministic core: AI can evaluate or suggest, but should not silently overwrite edits.
- Cross-platform intent: macOS is the current packaging target, with Linux kept in scope.
- Extensible pipeline: readers, analyzers, calibrators, exporters and evaluators should be replaceable over time.

## Roadmap

- Sign and notarize the macOS DMG.
- Harden native dependency packaging on clean machines.
- Improve the working color-space and camera-profile pipeline.
- Promote the non-destructive `pipeline.Document` model into the single source of truth.
- Add preview-pyramid cache governance for large folders.
- Finish Linux packaging and release smoke tests.

See `STATUS.md` for the detailed development state and `AGENTS.md` for agent collaboration rules.
