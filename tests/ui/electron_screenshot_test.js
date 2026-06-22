const { _electron: electron } = require("@playwright/test");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { startBackend, stopServer, waitForUrl, getFreePort } = require("./react_workbench_helpers");

function resolveElectronPath() {
  const distDir = path.resolve(__dirname, "../../frontend/node_modules/electron/dist");
  if (process.platform === "darwin") {
    return path.join(distDir, "Electron.app", "Contents", "MacOS", "Electron");
  }
  return path.join(distDir, "electron");
}

const ELECTRON_PATH = resolveElectronPath();
const TEST_PHOTO_DIR = path.resolve(__dirname, "../../photo_test/3285 e100哈大3f");
const SCREENSHOT_DIR = path.join(os.tmpdir(), "electron-screenshots");

const VIEWPORTS = [
  { name: "1280x720", width: 1280, height: 720 },
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1920x1080", width: 1920, height: 1080 },
];

async function launchElectron(backendPort) {
  return electron.launch({
    executablePath: ELECTRON_PATH,
    args: ["frontend/electron/main.mjs"],
    cwd: path.resolve(__dirname, "../.."),
    env: {
      ...process.env,
      PHOTO_CALIBRATOR_API_BASE_URL: `http://127.0.0.1:${backendPort}`,
    },
  });
}

function getTestPhotoPaths() {
  return fs.readdirSync(TEST_PHOTO_DIR)
    .filter(f => /\.(tif|tiff|jpg|jpeg|png|dng|cr2|nef|arw)$/i.test(f))
    .map(f => path.join(TEST_PHOTO_DIR, f));
}

async function importFolderPhotos(window, photoPaths) {
  await window.evaluate(async (paths) => {
    const files = [];
    for (const p of paths) {
      try {
        const response = await fetch(`file://${p}`);
        const buffer = await response.arrayBuffer();
        const name = p.split(/[\\/]/).pop();
        const file = new File([buffer], name);
        file.path = p;
        files.push(file);
      } catch (e) {
        console.warn("skip", p, e.message);
      }
    }
    const input = document.querySelector('[data-testid="topbar-file-input"]');
    const dt = new DataTransfer();
    files.forEach(f => dt.items.add(f));
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, photoPaths);
}

async function main() {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const backendPort = await getFreePort();
  const backend = startBackend(backendPort);
  await waitForUrl(`http://127.0.0.1:${backendPort}/api/health`, (r) => r.ok);
  console.log(`Backend on port ${backendPort}`);

  const photoPaths = getTestPhotoPaths();
  console.log(`Found ${photoPaths.length} test photos in ${TEST_PHOTO_DIR}`);

  const electronApp = await launchElectron(backendPort);
  const window = await electronApp.firstWindow();
  await window.waitForLoadState("domcontentloaded");

  // Wait for app shell
  await window.waitForSelector('[data-testid="app-shell"]', { timeout: 20000 });
  console.log("App shell visible");

  // Import entire folder
  await importFolderPhotos(window, photoPaths);
  console.log(`Imported ${photoPaths.length} photos`);

  // Wait for filmstrip items
  await window.waitForSelector('[data-testid="filmstrip-item"]', { timeout: 30000 });
  const itemCount = await window.locator('[data-testid="filmstrip-item"]').count();
  console.log(`Filmstrip shows ${itemCount} items`);

  // Click first item to load in viewer
  await window.locator('[data-testid="filmstrip-item"]').first().click();
  await window.waitForTimeout(3000);

  // Wait for calibration to complete
  try {
    await window.waitForSelector('[data-testid="viewer-status-state"]', { timeout: 15000 });
    const state = await window.locator('[data-testid="viewer-status-state"]').textContent();
    console.log(`Viewer state: ${state}`);
  } catch (e) {
    console.log("No viewer status found, continuing...");
  }

  // Take screenshots at each viewport size
  for (const vp of VIEWPORTS) {
    await window.setViewportSize({ width: vp.width, height: vp.height });
    await window.waitForTimeout(1000);

    const filePath = path.join(SCREENSHOT_DIR, `workbench-${vp.name}.png`);
    await window.screenshot({ path: filePath, fullPage: false });
    console.log(`Screenshot: ${filePath}`);
  }

  // Switch to settings tab and screenshot
  try {
    await window.locator('[data-testid="inspector-tab-settings"]').click();
    await window.waitForTimeout(500);
    await window.setViewportSize({ width: 1440, height: 900 });
    await window.waitForTimeout(500);
    await window.screenshot({ path: path.join(SCREENSHOT_DIR, "settings-tab-1440x900.png") });
    console.log("Screenshot: settings-tab-1440x900.png");
  } catch (e) {
    console.log("Settings tab screenshot failed:", e.message);
  }

  // Capture the persistent analysis pane.
  try {
    await window.waitForTimeout(500);
    await window.screenshot({ path: path.join(SCREENSHOT_DIR, "analysis-pane-1440x900.png") });
    console.log("Screenshot: analysis-pane-1440x900.png");
  } catch (e) {
    console.log("Analysis pane screenshot failed:", e.message);
  }

  // Switch to adjust tab, select rgb-curves mode
  try {
    await window.locator('[data-testid="inspector-tab-adjust"]').click();
    await window.waitForTimeout(500);
    await window.locator('[data-testid="mode-select"]').selectOption("rgb-curves");
    await window.waitForTimeout(2000);
    await window.screenshot({ path: path.join(SCREENSHOT_DIR, "curve-editor-1440x900.png") });
    console.log("Screenshot: curve-editor-1440x900.png");
  } catch (e) {
    console.log("Curve editor screenshot failed:", e.message);
  }

  await electronApp.close();
  stopServer(backend);

  // List all screenshots
  const files = fs.readdirSync(SCREENSHOT_DIR).filter(f => f.endsWith(".png"));
  console.log(`\nDone! ${files.length} screenshots in ${SCREENSHOT_DIR}:`);
  files.forEach(f => console.log(`  ${f}`));
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
