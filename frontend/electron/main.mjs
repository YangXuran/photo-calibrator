import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const distIndex = path.join(projectRoot, "dist", "index.html");
const preloadPath = path.join(__dirname, "preload.mjs");

const rendererUrl = process.env.PHOTO_CALIBRATOR_RENDERER_URL || "http://127.0.0.1:5173";
const apiBaseUrl = process.env.PHOTO_CALIBRATOR_API_BASE_URL || "http://127.0.0.1:8766";
const isDev = process.env.PHOTO_CALIBRATOR_RENDERER_MODE === "dev";

async function listFilesRecursively(rootDir) {
  const output = [];
  const queue = [rootDir];

  while (queue.length) {
    const current = queue.pop();
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const resolved = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(resolved);
      } else {
        output.push(resolved);
      }
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

  if (isDev) {
    win.loadURL(rendererUrl);
  } else {
    win.loadFile(distIndex);
  }
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

ipcMain.handle("photo-calibrator:list-directory-files", async (_event, directoryPath) => {
  if (!directoryPath) return [];
  return listFilesRecursively(directoryPath);
});

ipcMain.handle("photo-calibrator:get-runtime", async () => ({
  mode: "desktop-shell",
  shellName: "Photo Calibrator Desktop",
  apiBaseUrl,
  supportsNativeDialogs: true,
  supportsShellBridge: true,
  enableMockShellBridge: false,
}));

// Disable Chromium sandbox for containerized/dev environments
app.commandLine.appendSwitch("no-sandbox");
app.commandLine.appendSwitch("disable-gpu-sandbox");
app.commandLine.appendSwitch("disable-seccomp-filter-sandbox");

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
