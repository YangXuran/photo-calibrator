# ChromaFrame Electron Runtime

This directory is the production desktop shell boundary, not a prototype stub.
Electron owns native dialogs, application menus, window lifecycle and the local
Python backend process. React remains renderer-only and accesses native features
through preload bridges.

## Runtime Components

- `main.mjs`: application/window lifecycle, native dialogs, menus and IPC.
- `backendSupervisor.mjs`: managed/external backend selection, port allocation,
  signed health handshake, process status and restart behavior.
- `preload.mjs`: context-isolated bridges exposed to the renderer.

## Backend Ownership

Without `PHOTO_CALIBRATOR_API_BASE_URL`, Electron starts and owns the packaged
backend (or the development Python module), chooses an available loopback port,
waits for `/api/health`, and terminates the process with the app.

When `PHOTO_CALIBRATOR_API_BASE_URL` is explicitly set, Electron treats that
backend as externally owned. It verifies the health response but never silently
starts a different process if the configured service is unavailable.

Health is accepted only when the JSON response identifies the service:

```json
{"ok": true, "service": "photo-calibrator", "api_version": 1}
```

## Preload Contracts

The renderer receives:

```js
window.__PHOTO_CALIBRATOR_RUNTIME__ // initial runtime snapshot
window.__PHOTO_CALIBRATOR_APP__     // runtime updates and backend reconnect
window.__PHOTO_CALIBRATOR_SHELL__   // native file/directory dialogs
window.__PHOTO_CALIBRATOR_MENU__    // native menu events
```

`__PHOTO_CALIBRATOR_APP__` exposes `getRuntime()`, `restartBackend()` and
`onRuntimeChanged(callback)`. Runtime updates include backend state
(`starting`, `ready`, `failed`, `stopped`), process ownership, current URL,
managed PID and the last lifecycle error.

The React API client resolves the current runtime URL per request. This is
important because a managed backend restart may select a different port.

## Validation

```bash
npm --prefix frontend run test:electron-runtime
npm --prefix frontend run typecheck
npm --prefix frontend run build
npm run test:ui
```
