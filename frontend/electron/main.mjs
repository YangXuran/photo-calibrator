import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(projectRoot, "..");
const distIndex = path.join(projectRoot, "dist", "index.html");
const preloadPath = path.join(__dirname, "preload.mjs");

const rendererUrl = process.env.PHOTO_CALIBRATOR_RENDERER_URL || "http://127.0.0.1:3000";
const configuredApiBaseUrl = process.env.PHOTO_CALIBRATOR_API_BASE_URL;
const apiBaseUrl = configuredApiBaseUrl || "http://127.0.0.1:8766";
const isDev = process.env.PHOTO_CALIBRATOR_RENDERER_MODE === "dev";
const isMac = process.platform === "darwin";
const isLinux = process.platform === "linux";
const backendPort = Number(process.env.PHOTO_CALIBRATOR_BACKEND_PORT || 8766);
const backendHost = process.env.PHOTO_CALIBRATOR_BACKEND_HOST || "127.0.0.1";

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------
const APP_NAME = "Photo Calibrator";
const venvPython = path.join(repoRoot, ".venv", "bin", "python");
const PYTHON_CMD = process.env.PHOTO_CALIBRATOR_PYTHON || (existsSync(venvPython) ? venvPython : "python3");

// ---------------------------------------------------------------------------
// Backend lifecycle
// ---------------------------------------------------------------------------
let backendProcess = null;

function findAvailablePort(startPort) {
  const tryPort = (port) => new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.on("error", () => resolve(null));
    server.listen(port, backendHost, () => {
      server.close(() => resolve(port));
    });
  });

  return (async () => {
    for (let port = startPort; port < startPort + 20; port += 1) {
      const available = await tryPort(port);
      if (available !== null) return available;
    }
    throw new Error(`No available backend port in range ${startPort}-${startPort + 19}`);
  })();
}

async function waitForBackend(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return true;
    } catch {
      // backend not ready yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function startBackend() {
  if (configuredApiBaseUrl && await waitForBackend(apiBaseUrl, 1200)) {
    return apiBaseUrl;
  }
  const port = await findAvailablePort(backendPort);
  const healthUrl = `http://${backendHost}:${port}`;

  const packagedBackend = path.join(process.resourcesPath, "backend", "photo-calibrator-backend");
  const pythonPath = app.isPackaged ? packagedBackend : (process.env.PHOTO_CALIBRATOR_PYTHON || PYTHON_CMD);
  const args = app.isPackaged
    ? ["--port", String(port), "--accelerator", "auto"]
    : ["-m", "photo_calibrator.backend.simple_server", "--port", String(port), "--accelerator", "auto"];

  const devWebRoot = path.join(projectRoot, "public");
  if (isDev && existsSync(devWebRoot)) {
    args.push("--web-root", devWebRoot);
  }

  const env = { ...process.env, PYTHONUNBUFFERED: "1" };
  if (!app.isPackaged) env.PYTHONPATH = path.join(repoRoot, "src");

  backendProcess = spawn(pythonPath, args, {
    cwd: app.isPackaged ? path.dirname(packagedBackend) : repoRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  backendProcess.stdout?.on("data", (chunk) => {
    process.stdout.write(`[backend] ${chunk}`);
  });
  backendProcess.stderr?.on("data", (chunk) => {
    process.stderr.write(`[backend:err] ${chunk}`);
  });
  backendProcess.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`Backend exited with code ${code}`);
    }
    backendProcess = null;
  });

  const ready = await waitForBackend(healthUrl);
  if (!ready) {
    console.error("Backend failed to start within timeout");
    stopBackend();
    throw new Error("Backend startup timeout");
  }

  return healthUrl;
}

function stopBackend() {
  if (backendProcess) {
    backendProcess.kill("SIGTERM");
    backendProcess = null;
  }
}

// ---------------------------------------------------------------------------
// Window management
// ---------------------------------------------------------------------------

async function listFilesRecursively(rootDir) {
  const output = [];
  const queue = [rootDir];

  while (queue.length) {
    const current = queue.pop();
    try {
      const entries = await readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        const resolved = path.join(current, entry.name);
        if (entry.isDirectory()) {
          queue.push(resolved);
        } else {
          output.push(resolved);
        }
      }
    } catch {
      // Skip unreadable directories (permission errors, broken symlinks, etc.)
    }
  }

  return output;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1560,
    height: 980,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: "#0b1016",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const loadPromise = isDev ? win.loadURL(rendererUrl) : win.loadFile(distIndex);
  loadPromise.catch((error) => {
    console.error("[electron] failed to load renderer:", error);
  });

  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    console.error("[electron] did-fail-load", { errorCode, errorDescription, validatedURL, isMainFrame });
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    console.error("[electron] render-process-gone", details);
  });
  win.on("unresponsive", () => {
    console.error("[electron] window-unresponsive");
  });

  // Forward renderer console to terminal for debugging
  win.webContents.on("console-message", (details) => {
    const message = details?.message ?? "";
    if (message.includes("[curve-preview]") || message.includes("curve.preview") || message.includes("setCurves") || message.includes("CANVAS PAINT") || message.includes("[perf]")) {
      console.log("[renderer]", message);
    }
  });

}

ipcMain.handle("photo-calibrator:pick-files", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "tif", "tiff", "dng", "cr2", "nef", "arw", "hdr", "exr"] }],
  });
  if (result.canceled) return [];
  return result.filePaths;
});

ipcMain.handle("photo-calibrator:pick-directory", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
  });
  if (result.canceled) return [];
  return result.filePaths;
});

ipcMain.handle("photo-calibrator:pick-output-directory", async (event, currentOutputPath) => {
  const owner = BrowserWindow.fromWebContents(event.sender);
  const currentPath = typeof currentOutputPath === "string" ? currentOutputPath.trim() : "";
  const options = {
    title: "选择导出文件夹",
    buttonLabel: "选择",
    properties: ["openDirectory", "createDirectory"],
    ...(currentPath ? { defaultPath: path.dirname(currentPath) } : {}),
  };
  const result = owner
    ? await dialog.showOpenDialog(owner, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("photo-calibrator:list-directory-files", async (_event, directoryPath) => {
  if (!directoryPath) return [];
  const resolved = path.resolve(directoryPath);
  try {
    const stats = await stat(resolved);
    if (!stats.isDirectory()) return [];
  } catch {
    return [];
  }
  return listFilesRecursively(resolved);
});

ipcMain.handle("photo-calibrator:get-runtime", async () => ({
  mode: "desktop-shell",
  shellName: "Photo Calibrator Desktop",
  apiBaseUrl: currentBackendUrl || apiBaseUrl,
  supportsNativeDialogs: true,
  supportsShellBridge: true,
  enableMockShellBridge: false,
  tempDir: os.tmpdir(),
}));

// ---------------------------------------------------------------------------
// macOS: native menu bar
// ---------------------------------------------------------------------------
if (isMac) {
  const template = [
    {
      label: APP_NAME,
      submenu: [
        { label: `About ${APP_NAME}`, role: "about" },
        { type: "separator" },
        { label: "Quit", accelerator: "Cmd+Q", click: () => app.quit() },
      ],
    },
    {
      label: "File",
      submenu: [
        { label: "Open Photos...", accelerator: "Cmd+O", click: async () => {
          const win = BrowserWindow.getFocusedWindow();
          if (!win) return;
          const { canceled, filePaths } = await dialog.showOpenDialog(win, {
            properties: ["openFile", "multiSelections"],
            filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "tif", "tiff", "dng", "cr2", "nef", "arw", "hdr", "exr"] }],
          });
          if (!canceled && filePaths.length > 0) {
            win.webContents.send("menu:files-picked", filePaths.map((p) => ({ name: path.basename(p), path: p, workspaceRoot: path.dirname(p) })));
          }
        } },
        { label: "Open Folder...", accelerator: "Cmd+Shift+O", click: async () => {
          const win = BrowserWindow.getFocusedWindow();
          if (!win) return;
          const { canceled, filePaths } = await dialog.showOpenDialog(win, {
            properties: ["openDirectory"],
          });
          if (!canceled && filePaths.length > 0) {
            const dir = filePaths[0];
            try {
              const entries = await listFilesRecursively(dir);
              win.webContents.send("menu:files-picked", entries.map((p) => ({ name: path.basename(p), path: p, workspaceRoot: dir })));
            } catch {
              // Silently fail if directory listing fails
            }
          }
        } },
      ],
    },
    { label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }] },
    { label: "View", submenu: [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "togglefullscreen" }] },
    {
      label: "Help",
      submenu: [
        { label: "GitHub Repository", click: () => shell.openExternal("https://github.com") },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
} else {
  // Linux/Windows: no menu bar (use in-window toolbar)
  Menu.setApplicationMenu(null);
}

// ---------------------------------------------------------------------------
// Sandbox / Linux rendering strategy
// Prefer the platform default (typically X11/XWayland in desktop terminals).
// Only force Wayland when explicitly requested, because some drivers/compositors
// present a blank client surface even though the renderer has painted content.
// ---------------------------------------------------------------------------
if (isLinux) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-gpu-compositing");
  app.commandLine.appendSwitch("use-gl", "swiftshader");
  if (process.env.PHOTO_CALIBRATOR_FORCE_WAYLAND === "1") {
    app.commandLine.appendSwitch("enable-features", "UseOzonePlatform");
    app.commandLine.appendSwitch("ozone-platform", "wayland");
    app.commandLine.appendSwitch("disable-features", "WaylandLinuxDrmSyncobj,Vulkan");
  }
}

if (isLinux && (process.env.CI || process.env.PHOTO_CALIBRATOR_DISABLE_SANDBOX)) {
  app.commandLine.appendSwitch("no-sandbox");
}

// ---------------------------------------------------------------------------
// App lifecycle (cross-platform)
// ---------------------------------------------------------------------------
let currentBackendUrl = null;

app.whenReady().then(async () => {
  try {
    currentBackendUrl = await startBackend();
    console.log(`Backend ready at ${currentBackendUrl}`);
  } catch (err) {
    console.error("Backend startup failed, using external backend:", err.message);
    currentBackendUrl = apiBaseUrl;
  }
  createWindow();
});

// macOS: re-create window when dock icon clicked
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// macOS: keep app running when all windows closed
app.on("window-all-closed", () => {
  if (!isMac) {
    stopBackend();
    app.quit();
  }
});

app.on("before-quit", () => stopBackend());
app.on("will-quit", () => stopBackend());
