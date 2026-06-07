# Frontend Runtime Notes

This frontend can run in two modes:

- `browser`
- `desktop-shell`

The current workbench uses the same React app for both. Desktop integration is driven by runtime config and an optional shell bridge instead of hard-coding Electron behavior into components.

## Launch Modes

Browser mode:

```bash
npm run dev
```

Desktop mock mode:

```bash
npm run dev:desktop-mock
```

The desktop mock script sets:

- `VITE_RUNTIME_MODE=desktop-shell`
- `VITE_SHELL_NAME=Photo Calibrator Desktop`
- `VITE_API_BASE_URL=http://127.0.0.1:8766`
- `VITE_SUPPORTS_NATIVE_DIALOGS=true`
- `VITE_SUPPORTS_SHELL_BRIDGE=true`
- `VITE_ENABLE_MOCK_SHELL_BRIDGE=true`

This does not provide a real Electron bridge. It only lets the UI render desktop-oriented state and capability labels.

## Runtime Contract

The frontend reads runtime config from either Vite env vars or injected globals.

Env-backed fields:

- `VITE_API_BASE_URL`
- `VITE_RUNTIME_MODE`
- `VITE_SHELL_NAME`
- `VITE_SUPPORTS_NATIVE_DIALOGS`
- `VITE_SUPPORTS_SHELL_BRIDGE`
- `VITE_ENABLE_MOCK_SHELL_BRIDGE`

Injected runtime object:

```js
window.__PHOTO_CALIBRATOR_RUNTIME__ = {
  mode: "desktop-shell",
  shellName: "Photo Calibrator Desktop",
  apiBaseUrl: "http://127.0.0.1:8766",
  supportsNativeDialogs: true,
  supportsShellBridge: true,
};
```

## Shell Bridge Contract

Optional shell bridge:

```js
window.__PHOTO_CALIBRATOR_SHELL__ = {
  source: "electron-preload",
  pickFiles: async () => File[],
  pickDirectory: async () => File[],
};
```

If the bridge is unavailable, file open actions fall back to browser file inputs.

In desktop mock mode, the frontend can install a browser-backed mock bridge automatically. That mock reports:

```js
window.__PHOTO_CALIBRATOR_SHELL__ = {
  source: "mock-browser",
  pickFiles: async () => File[],
  pickDirectory: async () => File[],
};
```

The runtime access strategy is resolved in:

- `src/runtime/fileAccess.ts`

The topbar only consumes that strategy. It should not grow shell-specific branching beyond that module.

## Electron Direction

For Electron integration, the intended layering is:

1. preload injects `__PHOTO_CALIBRATOR_RUNTIME__`
2. preload injects `__PHOTO_CALIBRATOR_SHELL__`
3. frontend stays unchanged and consumes those contracts
4. backend remains reachable via configured `apiBaseUrl`

This keeps the workbench UI web-testable while still allowing desktop-specific behavior. 

## Electron Stub

A minimal Electron-facing stub now lives under:

- `electron/main.mjs`
- `electron/preload.mjs`
- `electron/README.md`

The stub defines the first concrete IPC channel names and preload contract for the existing runtime modules. It is intentionally not yet wired into package scripts because the current verified frontend setup does not add `electron` as an installed dependency.

## UI Test Entry Points

From the repo root, the current Playwright entry points are split by responsibility:

- `npm run test:ui`
- `npm run test:ui:frontend`
- `npm run test:ui:frontend:layout`
- `npm run test:ui:frontend:workflow`
- `npm run test:ui:frontend:visual`
- `npm run test:ui:legacy`

This keeps fast layout or workflow checks available without always rerunning the full frontend and legacy suites together.

Recommended staged usage:

- `npm run test:ui:core`
  - quick interaction and layout coverage
  - runs frontend `layout + workflow` and legacy suites
- `npm run test:ui:visual`
  - screenshot baselines only
- `npm run test:ui:ci`
  - staged aggregate entry intended for CI-style execution

The repo also includes a matching GitHub Actions workflow:

- `.github/workflows/frontend-ui.yml`

It runs the same order:

1. `frontend:typecheck`
2. `frontend:build`
3. `test:ui:core`
4. `test:ui:visual`

The workflow also adds a few operational defaults:

- cancels superseded runs on the same ref
- uses `pip` and `npm` dependency caches
- uploads `test-results` / `playwright-report` artifacts
