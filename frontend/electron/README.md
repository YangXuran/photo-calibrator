# Electron Stub

This folder is the minimal shell stub for the React workbench.

Files:

- `main.mjs`
- `preload.mjs`

The stub is intentionally small. Its job is to prove the contract boundary:

1. renderer gets `window.__PHOTO_CALIBRATOR_RUNTIME__`
2. renderer gets `window.__PHOTO_CALIBRATOR_SHELL__`
3. renderer keeps using the same frontend runtime modules

## Current IPC Contract

Main handles:

- `photo-calibrator:get-runtime`
- `photo-calibrator:pick-files`
- `photo-calibrator:pick-directory`

Preload exposes:

```js
window.__PHOTO_CALIBRATOR_RUNTIME__
window.__PHOTO_CALIBRATOR_SHELL__
```

## Notes

- This stub is not yet wired into `frontend/package.json` scripts because `electron` is not added as a dependency in the current validated frontend setup.
- It is meant as the next integration handoff, not as a claimed finished Electron packaging flow.
