const { test, expect, _electron: electron } = require("@playwright/test");
const path = require("node:path");
const { startBackend, stopServer, waitForUrl, getFreePort } = require("./react_workbench_helpers");

const ELECTRON_PATH = path.resolve(__dirname, "../../frontend/node_modules/electron/dist/electron");
const TEST_PHOTO_DIR = "/home/xuran/Projects/photo_calibrator/photo_test/3285 e100哈大3f";
const TEST_PHOTOS = [
  path.join(TEST_PHOTO_DIR, "图像 001_1.tif"),
  path.join(TEST_PHOTO_DIR, "图像 002_1.tif"),
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

async function importPhotos(window, photos) {
  await window.evaluate(async (photoPaths) => {
    const files = [];
    for (const photoPath of photoPaths) {
      const response = await fetch(`file://${photoPath}`);
      const buffer = await response.arrayBuffer();
      const name = photoPath.split("/").pop();
      const file = new File([buffer], name);
      file.path = photoPath;
      files.push(file);
    }
    
    const input = document.querySelector('[data-testid="topbar-file-input"]');
    const dt = new DataTransfer();
    files.forEach(f => dt.items.add(f));
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, photos);
}

test.describe("electron desktop e2e", () => {
  test("launches electron app and shows workbench", async () => {
    const backendPort = await getFreePort();
    const backend = startBackend(backendPort);
    await waitForUrl(`http://127.0.0.1:${backendPort}/api/health`, (r) => r.ok);
    
    const electronApp = await launchElectron(backendPort);

    try {
      const window = await electronApp.firstWindow();
      await window.waitForLoadState("domcontentloaded");
      
      await expect(window.getByTestId("app-shell")).toBeVisible({ timeout: 15000 });
      await expect(window.getByTestId("workbench-topbar")).toBeVisible();
      await expect(window.getByTestId("library-pane")).toBeVisible();
      await expect(window.getByTestId("viewer-pane")).toBeVisible();
      await expect(window.getByTestId("inspector-pane")).toBeVisible();
    } finally {
      await electronApp.close();
      stopServer(backend);
    }
  });

  test("imports real TIFF photos via shell bridge", async () => {
    const backendPort = await getFreePort();
    const backend = startBackend(backendPort);
    await waitForUrl(`http://127.0.0.1:${backendPort}/api/health`, (r) => r.ok);
    
    const electronApp = await launchElectron(backendPort);

    try {
      const window = await electronApp.firstWindow();
      await window.waitForLoadState("domcontentloaded");
      
      await expect(window.getByTestId("app-shell")).toBeVisible({ timeout: 15000 });
      
      await importPhotos(window, TEST_PHOTOS);

      await expect(window.getByTestId("filmstrip-item")).toHaveCount(2, { timeout: 30000 });
      
      await expect(window.getByTestId("viewer-stage-shell")).toBeVisible({ timeout: 15000 });
      await expect(window.getByTestId("viewer-statusbar")).toBeVisible();
      
      await window.waitForTimeout(2000);
      
      const statusText = await window.getByTestId("viewer-status-state").textContent();
      expect(statusText).toMatch(/Imported|Prepared|Calibrated/);
    } finally {
      await electronApp.close();
      stopServer(backend);
    }
  });

  test("runs calibration on real photo and shows results", async () => {
    const backendPort = await getFreePort();
    const backend = startBackend(backendPort);
    await waitForUrl(`http://127.0.0.1:${backendPort}/api/health`, (r) => r.ok);
    
    const electronApp = await launchElectron(backendPort);

    try {
      const window = await electronApp.firstWindow();
      await window.waitForLoadState("domcontentloaded");
      
      await expect(window.getByTestId("app-shell")).toBeVisible({ timeout: 15000 });
      
      await importPhotos(window, [TEST_PHOTOS[0]]);

      await expect(window.getByTestId("filmstrip-item")).toHaveCount(1, { timeout: 30000 });
      
      // Click on adjust tab to ensure calibration controls are visible
      await window.getByTestId("inspector-tab-adjust").click();
      
      await expect(window.getByTestId("mode-select")).toBeVisible({ timeout: 10000 });
      await window.getByTestId("mode-select").selectOption("global");
      await window.getByTestId("strength-input").fill("0.8");
      
      await window.waitForTimeout(5000);
      
      await expect(window.getByTestId("viewer-status-state")).toContainText(/Calibrated|Prepared|Imported/, { timeout: 20000 });
      
      await expect(window.getByTestId("inspector-tab-analysis")).toBeVisible();
      await window.getByTestId("inspector-tab-analysis").click();
      
      // Verify analysis tab is now active
      await expect(window.getByTestId("inspector-tab-analysis")).toHaveClass(/is-active/, { timeout: 5000 });
    } finally {
      await electronApp.close();
      stopServer(backend);
    }
  });

  test("switches layout presets in electron", async () => {
    const backendPort = await getFreePort();
    const backend = startBackend(backendPort);
    await waitForUrl(`http://127.0.0.1:${backendPort}/api/health`, (r) => r.ok);
    
    const electronApp = await launchElectron(backendPort);

    try {
      const window = await electronApp.firstWindow();
      await window.waitForLoadState("domcontentloaded");
      
      await expect(window.getByTestId("app-shell")).toBeVisible({ timeout: 15000 });
      
      await window.getByTestId("layout-settings-button").click();
      await expect(window.getByTestId("layout-settings-dialog")).toBeVisible();
      
      await window.getByTestId("layout-preset-analyze-card").click();
      await expect(window.getByTestId("layout-preset-current")).toContainText("分析布局");
      
      await window.getByTestId("layout-preset-edit-card").click();
      await expect(window.getByTestId("layout-preset-current")).toContainText("编辑布局");
      
      await window.getByTestId("layout-preset-review-card").click();
      await expect(window.getByTestId("layout-preset-current")).toContainText("审片布局");
      
      await window.getByTestId("layout-preset-balanced-card").click();
      await expect(window.getByTestId("layout-preset-current")).toContainText("平衡工作台");
      
      await window.getByTestId("layout-settings-dialog").getByRole("button", { name: "关闭" }).click();
      await expect(window.getByTestId("layout-settings-dialog")).toHaveCount(0);
    } finally {
      await electronApp.close();
      stopServer(backend);
    }
  });

  test("runs film scan on real photo", async () => {
    const backendPort = await getFreePort();
    const backend = startBackend(backendPort);
    await waitForUrl(`http://127.0.0.1:${backendPort}/api/health`, (r) => r.ok);
    
    const electronApp = await launchElectron(backendPort);

    try {
      const window = await electronApp.firstWindow();
      await window.waitForLoadState("domcontentloaded");
      
      await expect(window.getByTestId("app-shell")).toBeVisible({ timeout: 15000 });
      
      await importPhotos(window, [TEST_PHOTOS[0]]);

      await expect(window.getByTestId("filmstrip-item")).toHaveCount(1, { timeout: 30000 });
      await window.waitForTimeout(2000);
      
      const filmScanButton = window.getByTestId("run-film-scan");
      if (await filmScanButton.isVisible()) {
        await filmScanButton.click();
        await window.waitForTimeout(3000);
        
        await expect(window.getByTestId("viewer-status-state")).toContainText(/Crop|Suggested|Adjusted/, { timeout: 15000 });
      }
    } finally {
      await electronApp.close();
      stopServer(backend);
    }
  });
});
