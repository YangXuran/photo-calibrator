# Performance Analysis - 2026-07-02

## Scope

This pass measured the current Electron/React frontend and Python backend paths, then applied low-risk optimizations where the measurements showed real cost.

Test machine context is the local macOS development environment. Treat these numbers as relative evidence for this code state, not portable guarantees.

## Backend Findings

### Accelerator

Command:

```bash
PYTHONPATH=src .venv/bin/python -m photo_calibrator.backend.accelerator_benchmark \
  --backend auto --image-side 512 --lut-size 17 --iterations 5
```

Result summary:

| Operation | Median-ish elapsed | Device |
| --- | ---: | --- |
| resize | 0.02 ms | OpenCV CPU |
| rgb-lab | 4.10 ms | OpenCV CPU |
| lab-rgb | 2.48 ms | OpenCV CPU |
| curve-lut | 0.51 ms | OpenCV CPU |
| matrix | 0.33 ms | OpenCV CPU |
| 3d-lut | 12.57 ms | MPS GPU |

Conclusion: this machine should keep the existing hybrid policy. MPS is useful for 3D LUT, while OpenCV CPU is faster and simpler for resize, color conversion, curve LUT, matrix, histograms, blur and Sobel profile work.

### Interactive Calibration

Direct payload probe on `Capture00183.NEF`, `20260629103226_3_50.jpg`, and `ns025.tif`:

| Path | Baseline observation |
| --- | --- |
| `calibrate-session fast` | about 4 ms |
| `calibrate-session full` | about 74-96 ms |
| `preview` after cache warmup | sub-ms cache hit |
| `film-scan` | about 190-430 ms median before this pass |

Conclusion: live slider/curve preview is already on the right architecture: cached session input plus fast preview. The expensive interactive backend path was film scan.

### Batch Calibration

Direct payload probe on three mixed image paths:

| Workers | Observation |
| ---: | --- |
| 1 | cold run dominated by decode/cache creation |
| 2 | much faster once analysis entries are cacheable |
| 4 | fastest warm path in this probe |

Conclusion: batch path/upload calibration is already structured correctly with `ThreadPoolExecutor` and per-key analysis locks. Further work should focus on process-level cancellable jobs and batch export, not more threads inside single fast calibration.

## Frontend Findings

### Build

Command:

```bash
time npm --prefix frontend run build
```

Result: Vite build itself completed in about 639 ms; total command was about 3.1 s wall clock including TypeScript and npm startup.

Conclusion: frontend build time is not the current product bottleneck.

### Runtime Logging

`frontend/src/lib/perf.ts` and `frontend/src/lib/debugLog.ts` were always enabled. During slider, curve, adaptive preview and calibration effects this adds buffer writes and synchronous console logging on the main renderer thread.

Change applied: both are now disabled by default and can be enabled explicitly:

```js
localStorage.setItem("photo-calibrator:perf", "1")
localStorage.setItem("photo-calibrator:debug", "1")
```

or by setting `window.__PHOTO_CALIBRATOR_PERF__ = true` / `window.__PHOTO_CALIBRATOR_DEBUG__ = true` before use.

## Implemented Optimizations

### Film Scan Candidate Scan

Problem: `_scan_edge_candidates()` recomputed the same `np.percentile(seq_grads[:search], 90)` inside the candidate loop. A single film scan could call this thousands of times.

Change: compute `gradient_scale` once per edge scan and reuse it.

### Film Scan Candidate Scoring

Problem: `_score_crop_rect()` repeatedly sliced center and edge strips and called `mean/std` for every candidate rectangle. On real images this became the hottest part after the percentile fix.

Change: build `_ImageRegionStats` once with integral images and use O(1) region mean/std during candidate scoring.

## After-Change Probe

Same direct API-style probe:

| Image | Before median | After median | Crop stable |
| --- | ---: | ---: | --- |
| `Capture00183.NEF` | about 345 ms original / 275 ms after percentile fix | about 160 ms | yes |
| `20260629103226_3_50.jpg` | about 192 ms | about 131 ms | yes |
| `ns025.tif` | about 406 ms | about 155 ms | yes |

`Capture00183.NEF` cProfile improved from about 0.447 s before this pass to about 0.239 s after both changes.

## Optimization Direction

Recommended next candidates:

1. Add a backend batch export job with worker concurrency. The frontend currently drives export item-by-item, so the backend cannot schedule export work as well as it does calibration batches.
2. Add a dedicated film-scan batch endpoint for folders. Single-image film scan is now CPU-leaner; folder-wide scan can use worker-level parallelism.
3. Keep GPU acceleration selective. Promote only operations with measured GPU wins, primarily 3D LUT and any future large, uniform per-pixel kernels.
4. Avoid internal Python thread fan-out inside one film scan unless profiling shows a new hotspot that releases the GIL. Current remaining cost is mixed NumPy/OpenCV and small candidate control flow.
5. Keep production frontend diagnostics opt-in. Main-thread logging should stay disabled unless debugging a specific interaction.
