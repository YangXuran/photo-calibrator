const { test, expect, _electron: electron } = require("@playwright/test");
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
const TEST_PHOTOS = [
  path.join(TEST_PHOTO_DIR, "图像 001_1.tif"),
  path.join(TEST_PHOTO_DIR, "图像 002_1.tif"),
];
const TEST_NEGATIVE_PHOTO = path.resolve(__dirname, "../../photo_test/Capture00183.NEF");

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

async function importPhotos(electronApp, photos) {
  const pickedFiles = photos.map((photoPath) => ({ name: path.basename(photoPath), path: photoPath, workspaceRoot: path.dirname(photoPath) }));
  await electronApp.evaluate(({ BrowserWindow }, files) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send("menu:files-picked", files);
  }, pickedFiles);
}

test.describe("electron desktop e2e", () => {
  test.describe.configure({ timeout: 60000 });
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
      await expect(window.getByTestId("analysis-pane")).toBeVisible();
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
      
      await importPhotos(electronApp, TEST_PHOTOS);

      await expect(window.getByTestId("filmstrip-item")).toHaveCount(2, { timeout: 30000 });
      
      await expect(window.getByTestId("viewer-stage-shell")).toBeVisible({ timeout: 15000 });
      await expect(window.getByTestId("viewer-statusbar")).toBeVisible();
      
      await expect(window.getByTestId("viewer-status-state")).toContainText(/Imported|Prepared|Calibrated/, { timeout: 30000 });
    } finally {
      await electronApp.close();
      stopServer(backend);
    }
  });

  test("chooses a native export directory and preserves the output file name", async () => {
    const backendPort = await getFreePort();
    const backend = startBackend(backendPort);
    await waitForUrl(`http://127.0.0.1:${backendPort}/api/health`, (r) => r.ok);
    const electronApp = await launchElectron(backendPort);
    const pickedDirectory = path.join(os.tmpdir(), "photo-calibrator-picked-export");

    try {
      const window = await electronApp.firstWindow();
      await window.waitForLoadState("domcontentloaded");
      await importPhotos(electronApp, [TEST_PHOTOS[0]]);
      await expect(window.getByTestId("filmstrip-item")).toHaveCount(1, { timeout: 30000 });

      await electronApp.evaluate(({ dialog }, directory) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
      }, pickedDirectory);

      await window.getByTestId("inspector-tab-export").click();
      await expect(window.getByTestId("export-output-directory-picker")).toBeVisible();
      const originalFileName = path.basename(await window.getByTestId("export-output-path").inputValue());
      await window.getByTestId("export-output-directory-picker").click();

      await expect(window.getByTestId("export-output-path")).toHaveValue(path.join(pickedDirectory, originalFileName));
    } finally {
      await electronApp.close().catch(() => {});
      stopServer(backend);
    }
  });

  test("loads an adaptive-resolution preview after switching TIFF photos", async () => {
    const backendPort = await getFreePort();
    const backend = startBackend(backendPort);
    await waitForUrl(`http://127.0.0.1:${backendPort}/api/health`, (r) => r.ok);
    const electronApp = await launchElectron(backendPort);

    try {
      const window = await electronApp.firstWindow();
      await window.waitForLoadState("domcontentloaded");
      await importPhotos(electronApp, TEST_PHOTOS);
      await expect(window.getByTestId("filmstrip-item")).toHaveCount(2, { timeout: 30000 });
      await expect(window.getByTestId("filmstrip-item").nth(1)).toContainText(path.basename(TEST_PHOTOS[1]));

      const adaptivePreview = window.waitForResponse(
        async (response) => {
          if (!response.url().endsWith("/api/preview") || !response.ok()) return false;
          const payload = await response.json().catch(() => null);
          return Math.max(payload?.processing?.analysis_width ?? 0, payload?.processing?.analysis_height ?? 0) > 320;
        },
        { timeout: 60000 },
      );
      await window.getByTestId("filmstrip-item").nth(1).click();
      const previewPayload = await (await adaptivePreview).json();
      const expectedMaxSide = Math.max(previewPayload.processing.analysis_width, previewPayload.processing.analysis_height);
      await expect.poll(async () => window.evaluate(() => {
        const image = Array.from(document.querySelectorAll(".pc-stage-image"))
          .find((node) => node.getAttribute("alt") === "Calibrated");
        return image instanceof HTMLImageElement ? Math.max(image.naturalWidth, image.naturalHeight) : 0;
      }), { timeout: 60000 }).toBeGreaterThanOrEqual(expectedMaxSide);
    } finally {
      await electronApp.close().catch(() => {});
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
      
      await importPhotos(electronApp, [TEST_PHOTOS[0]]);

      await expect(window.getByTestId("filmstrip-item")).toHaveCount(1, { timeout: 30000 });
      
      // Click on adjust tab to ensure calibration controls are visible
      await window.getByTestId("inspector-tab-adjust").click();
      
      await expect(window.getByTestId("mode-select")).toBeVisible({ timeout: 10000 });
      await window.getByTestId("mode-select").selectOption("global");
      await window.getByTestId("strength-input").fill("0.8");
      const toneResponse = window.waitForResponse(async (response) => {
        if (!/\/api\/calibrate(-session)?$/.test(new URL(response.url()).pathname) || !response.ok()) return false;
        const payload = await response.json().catch(() => null);
        return payload?.processing?.tone_recovery?.enabled === true;
      }, { timeout: 30000 });
      await expect(window.getByTestId("tone-recovery-section")).toBeVisible();
      await window.getByTestId("tone-recovery-toggle").check();
      await toneResponse;
      await expect(window.getByTestId("tone-recovery-analysis")).toBeVisible({ timeout: 10000 });
      
      await window.waitForTimeout(5000);
      
      await expect(window.getByTestId("viewer-status-state")).toContainText(/Calibrated|Prepared|Imported/, { timeout: 20000 });
      
      await expect(window.getByTestId("analysis-pane")).toBeVisible();
      await expect(window.getByTestId("inspector-tab-adjust")).toHaveClass(/is-active/, { timeout: 5000 });
      await expect(window.getByTestId("inspector-tab-color")).toHaveCount(0);
    } finally {
      await electronApp.close();
      stopServer(backend);
    }
  });

  test("switches inspector tools and focus layout in electron", async () => {
    const backendPort = await getFreePort();
    const backend = startBackend(backendPort);
    await waitForUrl(`http://127.0.0.1:${backendPort}/api/health`, (r) => r.ok);
    
    const electronApp = await launchElectron(backendPort);

    try {
      const window = await electronApp.firstWindow();
      await window.waitForLoadState("domcontentloaded");
      
      await expect(window.getByTestId("app-shell")).toBeVisible({ timeout: 15000 });
      
      await window.getByTestId("inspector-tab-curves").click();
      await expect(window.getByTestId("inspector-tab-curves")).toHaveClass(/is-active/);

      await window.getByTestId("inspector-tab-session").click();
      await expect(window.getByTestId("inspector-tab-session")).toHaveClass(/is-active/);

      await window.getByTestId("toggle-viewer-focus").click();
      await expect(window.getByTestId("toggle-viewer-focus")).toHaveClass(/is-active/);
      await window.getByTestId("toggle-viewer-focus").click();
      await expect(window.getByTestId("toggle-viewer-focus")).not.toHaveClass(/is-active/);
    } finally {
      await electronApp.close();
      stopServer(backend);
    }
  });

  test("updates preview while dragging look wheel and resets on double click", async () => {
    const backendPort = await getFreePort();
    const backend = startBackend(backendPort);
    await waitForUrl(`http://127.0.0.1:${backendPort}/api/health`, (r) => r.ok);
    const electronApp = await launchElectron(backendPort);

    try {
      const window = await electronApp.firstWindow();
      await window.waitForLoadState("domcontentloaded");
      await expect(window.getByTestId("app-shell")).toBeVisible({ timeout: 15000 });
      await importPhotos(electronApp, [TEST_PHOTOS[0]]);
      await expect(window.getByTestId("filmstrip-item")).toHaveCount(1, { timeout: 30000 });

      const initialSrc = await window.waitForFunction(() => {
        const img = Array.from(document.querySelectorAll("img"))
          .find((node) => node.getAttribute("alt") === "Calibrated");
        return img instanceof HTMLImageElement && img.src ? img.src : null;
      }, null, { timeout: 60000 });
      const beforeSrc = await initialSrc.jsonValue();
      await window.getByTestId("compare-mode-split").click();
      await expect(window.getByTestId("split-stage-divider")).toBeVisible();

      await window.getByTestId("inspector-tab-look").click();
      await expect(window.getByTestId("look-lab-section")).toBeVisible();
      const labPad = window.getByTestId("look-lab-pad");
      const labBox = await labPad.boundingBox();
      expect(labBox).toBeTruthy();
      await window.mouse.move(labBox.x + labBox.width / 2, labBox.y + labBox.height / 2);
      await window.mouse.down();
      await window.mouse.move(labBox.x + labBox.width - 12, labBox.y + 12, { steps: 4 });
      await expect(window.locator(".pc-stage-busy")).toHaveCount(0);
      await expect(window.locator(".pc-stage-split .pc-stage-image-frame .pc-stage-preview-overlay")).toBeVisible({ timeout: 5000 });
      await expect(window.locator(".pc-stage-split > .pc-stage-preview-overlay")).toHaveCount(0);
      await expect.poll(async () => window.evaluate(() => {
        const frame = document.querySelector(".pc-stage-split .pc-stage-image-frame");
        const overlay = document.querySelector(".pc-stage-split .pc-stage-image-frame .pc-stage-preview-overlay");
        const clip = document.querySelector(".pc-stage-split .pc-stage-clip");
        if (!(frame instanceof HTMLElement) || !(overlay instanceof HTMLElement) || !(clip instanceof HTMLElement)) return false;
        const frameRect = frame.getBoundingClientRect();
        const overlayRect = overlay.getBoundingClientRect();
        return Math.abs(frameRect.x - overlayRect.x) < 1
          && Math.abs(frameRect.y - overlayRect.y) < 1
          && Math.abs(frameRect.width - overlayRect.width) < 1
          && Math.abs(frameRect.height - overlayRect.height) < 1
          && Number(getComputedStyle(overlay).zIndex) < Number(getComputedStyle(clip).zIndex);
      }), { timeout: 5000 }).toBeTruthy();
      await window.mouse.up();

      await expect(window.getByTestId("look-wheels-section")).toBeVisible();
      const wheel = window.getByTestId("look-wheel-global").locator("svg");
      const box = await wheel.boundingBox();
      expect(box).toBeTruthy();
      await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await window.mouse.down();
      await window.mouse.move(box.x + box.width - 8, box.y + box.height / 2, { steps: 5 });
      await expect(window.locator(".pc-stage-busy")).toHaveCount(0);
      await window.waitForFunction((previous) => {
        const img = Array.from(document.querySelectorAll("img"))
          .find((node) => node.getAttribute("alt") === "Calibrated");
        return img instanceof HTMLImageElement && img.src && img.src !== previous;
      }, beforeSrc, { timeout: 10000 });
      await window.mouse.up();

      await wheel.dblclick({ position: { x: box.width / 2, y: box.height / 2 } });
      await expect(window.getByTestId("look-wheel-global")).toContainText(/0\.00/, { timeout: 10000 });
    } finally {
      await electronApp.close();
      stopServer(backend);
    }
  });

  test("keeps inspector panels uniquely assigned to their tabs", async () => {
    const backendPort = await getFreePort();
    const backend = startBackend(backendPort);
    await waitForUrl(`http://127.0.0.1:${backendPort}/api/health`, (r) => r.ok);
    const electronApp = await launchElectron(backendPort);

    try {
      const window = await electronApp.firstWindow();
      await window.waitForLoadState("domcontentloaded");
      await expect(window.getByTestId("app-shell")).toBeVisible({ timeout: 15000 });

      await expect(window.getByTestId("analysis-pane")).toHaveCount(1);
      await expect(window.getByTestId("analysis-charts-section")).toHaveCount(1);
      await expect(window.getByTestId("inspector-tab-color")).toHaveCount(0);
      await expect(window.getByTestId("inspector-tab-analysis")).toHaveCount(0);
      await expect(window.getByTestId("crop-section")).toHaveCount(0);
      await expect(window.getByTestId("history-section")).toHaveCount(0);

      await window.getByTestId("inspector-tab-compose").click();
      await expect(window.getByTestId("crop-section")).toHaveCount(1);

      await window.getByTestId("inspector-tab-curves").click();
      await expect(window.getByTestId("curves-lut-section")).toHaveCount(0);

      await window.getByTestId("inspector-tab-session").click();
      await expect(window.getByTestId("history-section")).toHaveCount(1);
      await expect(window.getByTestId("saved-sessions-section")).toHaveCount(1);
      await expect(window.getByTestId("activity-section")).toHaveCount(1);
      await expect(window.getByTestId("workflow-feed-section")).toHaveCount(0);

      await window.getByTestId("inspector-tab-settings").click();
      await expect(window.getByTestId("ai-provider-section")).toHaveCount(1);
    } finally {
      await electronApp.close().catch(() => {});
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
      
      await importPhotos(electronApp, [TEST_PHOTOS[0]]);

      await expect(window.getByTestId("filmstrip-item")).toHaveCount(1, { timeout: 30000 });
      await window.waitForTimeout(2000);
      
      const filmScanButton = window.getByTestId("focus-crop-detect");
      await expect(filmScanButton).toBeVisible({ timeout: 15000 });
      const filmScanResponse = window.waitForResponse((response) => response.url().endsWith("/api/film-scan") && response.ok(), { timeout: 30000 });
      await filmScanButton.click();
      const filmScanPayload = await (await filmScanResponse).json();
      expect(filmScanPayload.film_scan.confidence).toBeGreaterThan(0.5);
      expect(filmScanPayload.crop_rect.width).toBeLessThan(0.95);
      expect(filmScanPayload.crop_rect.height).toBeLessThan(0.95);
      await expect(window.locator(".pc-crop-overlay")).toBeVisible({ timeout: 30000 });
      await expect.poll(async () => window.evaluate(() => document.querySelectorAll(".pc-crop-debug-band").length), { timeout: 15000 }).toBeGreaterThan(0);
      await expect.poll(async () => window.evaluate(() => document.querySelectorAll(".pc-crop-debug-weighted").length), { timeout: 15000 }).toBeGreaterThan(0);
      const debugCounts = await window.evaluate(() => ({
        bands: document.querySelectorAll(".pc-crop-debug-band").length,
        merged: document.querySelectorAll(".pc-crop-debug-candidate").length,
        weighted: document.querySelectorAll(".pc-crop-debug-weighted").length,
      }));
      expect(debugCounts.bands).toBeGreaterThan(0);
      expect(debugCounts.weighted).toBeGreaterThan(0);
      const geometry = await window.evaluate(() => {
        const overlay = document.querySelector(".pc-crop-overlay");
        const stage = overlay?.closest(".pc-stage");
        if (!stage || !overlay) return null;
        const stageRect = stage.getBoundingClientRect();
        const overlayRect = overlay.getBoundingClientRect();
        return {
          stage: { left: stageRect.left, top: stageRect.top, width: stageRect.width, height: stageRect.height },
          overlay: { left: overlayRect.left, top: overlayRect.top, width: overlayRect.width, height: overlayRect.height },
        };
      });
      expect(geometry).not.toBeNull();
      expect(geometry.overlay.left).toBeGreaterThanOrEqual(geometry.stage.left - 2);
      expect(geometry.overlay.top).toBeGreaterThanOrEqual(geometry.stage.top - 2);
      expect(geometry.overlay.left + geometry.overlay.width).toBeLessThanOrEqual(geometry.stage.left + geometry.stage.width + 2);
      expect(geometry.overlay.top + geometry.overlay.height).toBeLessThanOrEqual(geometry.stage.top + geometry.stage.height + 2);
      await expect(window.getByTestId("viewer-status-state")).toContainText(/Crop|Suggested|Adjusted|Calibrated/, { timeout: 15000 });
    } finally {
      await electronApp.close();
      stopServer(backend);
    }
  });

  test("keeps detected crop overlay aligned to the displayed image frame", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "photo-calibrator-crop-ui-"));
    const photoPath = path.join(tempDir, "framed.png");
    const makeImageScript = `
import cv2
import numpy as np
path = r"${photoPath}"
img = np.full((220, 320, 3), 245, dtype=np.uint8)
cv2.rectangle(img, (35, 25), (285, 195), (12, 12, 12), thickness=10)
img[50:180, 55:265] = (178, 132, 104)
img = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
cv2.imwrite(path, img)
`;
    const makeResult = require("node:child_process").spawnSync(path.join(process.cwd(), ".venv", "bin", "python"), ["-c", makeImageScript], { encoding: "utf8" });
    expect(makeResult.status).toBe(0);

    const backendPort = await getFreePort();
    const backend = startBackend(backendPort);
    await waitForUrl(`http://127.0.0.1:${backendPort}/api/health`, (r) => r.ok);
    const electronApp = await launchElectron(backendPort);

    try {
      const window = await electronApp.firstWindow();
      await window.waitForLoadState("domcontentloaded");
      await importPhotos(electronApp, [photoPath]);
      await expect(window.getByTestId("filmstrip-item")).toHaveCount(1, { timeout: 30000 });

      await window.getByTestId("focus-crop-detect").click();
      await expect(window.locator(".pc-crop-overlay")).toBeVisible({ timeout: 30000 });
      const geometry = await window.evaluate(() => {
        const overlay = document.querySelector(".pc-crop-overlay");
        const frame = overlay?.closest(".pc-stage-image-frame");
        if (!frame || !overlay) return null;
        const frameRect = frame.getBoundingClientRect();
        const overlayRect = overlay.getBoundingClientRect();
        return {
          frame: { left: frameRect.left, top: frameRect.top, width: frameRect.width, height: frameRect.height },
          overlay: { left: overlayRect.left, top: overlayRect.top, width: overlayRect.width, height: overlayRect.height },
        };
      });

      expect(geometry).not.toBeNull();
      expect(geometry.overlay.left).toBeGreaterThan(geometry.frame.left + 10);
      expect(geometry.overlay.top).toBeGreaterThan(geometry.frame.top + 10);
      expect(geometry.overlay.width).toBeLessThan(geometry.frame.width - 20);
      expect(geometry.overlay.height).toBeLessThan(geometry.frame.height - 20);

      await window.getByTestId("inspector-tab-compose").click();
      const cropApplyResponse = window.waitForResponse(
        async (response) => {
          if (!/\/api\/calibrate(-session)?$/.test(new URL(response.url()).pathname) || !response.ok()) return false;
          const payload = await response.json().catch(() => null);
          return payload?.processing?.crop_applied === true;
        },
        { timeout: 60000 },
      );
      await window.getByTestId("crop-apply-button").click();
      await cropApplyResponse;
      await expect(window.locator(".pc-crop-overlay")).toHaveCount(0);
      await expect.poll(async () => window.evaluate(() => {
        const images = Array.from(document.querySelectorAll(".pc-stage-image"));
        const original = images.find((node) => node.getAttribute("alt") === "Original");
        const calibrated = images.find((node) => node.getAttribute("alt") === "Calibrated");
        if (!(original instanceof HTMLImageElement) || !(calibrated instanceof HTMLImageElement)) return false;
        return original.naturalWidth > 0
          && original.naturalWidth === calibrated.naturalWidth
          && original.naturalHeight === calibrated.naturalHeight;
      }), { timeout: 30000 }).toBeTruthy();

      await window.getByTestId("compare-mode-split").click();
      await expect(window.getByTestId("split-position-input")).toBeVisible();
      await expect(window.getByTestId("split-stage-divider")).toBeVisible();
      const readSplitGeometry = () => window.evaluate(() => {
        const original = document.querySelector('.pc-stage-image[alt="Original"]');
        const calibrated = document.querySelector('.pc-stage-image[alt="Calibrated"]');
        const clip = document.querySelector(".pc-stage-clip");
        const divider = document.querySelector('[data-testid="split-stage-divider"]');
        const frame = document.querySelector(".pc-stage-image-frame");
        const media = document.querySelector(".pc-stage-media");
        if (!original || !calibrated || !clip || !divider || !frame || !media) return null;
        const toGeometry = (element) => {
          const rect = element.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        };
        return {
          original: toGeometry(original),
          calibrated: toGeometry(calibrated),
          clip: toGeometry(clip),
          clipPath: getComputedStyle(clip).clipPath,
          divider: toGeometry(divider),
          frame: toGeometry(frame),
          mediaTransitionProperty: getComputedStyle(media).transitionProperty,
        };
      });
      await window.getByTestId("split-position-input").fill("20");
      const atTwenty = await readSplitGeometry();
      await window.getByTestId("split-position-input").fill("80");
      const atEighty = await readSplitGeometry();

      expect(atTwenty).not.toBeNull();
      expect(atEighty).not.toBeNull();
      expect(atTwenty.original).toEqual(atTwenty.calibrated);
      expect(atEighty.original).toEqual(atEighty.calibrated);
      expect(atEighty.original).toEqual(atTwenty.original);
      expect(atEighty.clip).toEqual(atTwenty.clip);
      expect(atEighty.clipPath).not.toBe(atTwenty.clipPath);
      expect(Math.abs((atTwenty.divider.x + atTwenty.divider.width / 2) - (atTwenty.frame.x + atTwenty.frame.width * 0.2))).toBeLessThan(2);
      expect(Math.abs((atEighty.divider.x + atEighty.divider.width / 2) - (atEighty.frame.x + atEighty.frame.width * 0.8))).toBeLessThan(2);
      expect(atEighty.divider.height).toBeGreaterThan(40);
      expect(atEighty.mediaTransitionProperty.split(",").map((value) => value.trim())).not.toContain("transform");

      await window.getByTestId("split-stage-divider").focus();
      await window.getByTestId("split-stage-divider").press("ArrowLeft");
      await expect(window.getByTestId("split-position-input")).toHaveValue("79");

      const dividerBox = await window.getByTestId("split-stage-divider").boundingBox();
      const frameBox = await window.locator(".pc-stage-image-frame").boundingBox();
      expect(dividerBox).not.toBeNull();
      expect(frameBox).not.toBeNull();
      await window.mouse.move(dividerBox.x + dividerBox.width / 2, dividerBox.y + dividerBox.height / 2);
      await window.mouse.down();
      await window.mouse.move(frameBox.x + frameBox.width * 0.55, dividerBox.y + dividerBox.height / 2, { steps: 5 });
      await window.mouse.up();
      await expect(window.getByTestId("split-position-input")).toHaveValue("55");
    } finally {
      await electronApp.close().catch(() => {});
      stopServer(backend);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("applies compose rotate and flip to backend preview", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "photo-calibrator-compose-"));
    const photoPath = path.join(tempDir, "compose-transform.png");
    const makeImageScript = `
import cv2
import numpy as np
path = r"${photoPath}"
img = np.zeros((180, 320, 3), dtype=np.uint8)
img[:, :] = (120, 130, 160)
img[40:140, 70:250] = (178, 132, 104)
cv2.rectangle(img, (55, 25), (265, 155), (10, 10, 10), thickness=8)
img = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
cv2.imwrite(path, img)
`;
    const makeResult = require("node:child_process").spawnSync(path.join(process.cwd(), ".venv", "bin", "python"), ["-c", makeImageScript], { encoding: "utf8" });
    expect(makeResult.status).toBe(0);

    const backendPort = await getFreePort();
    const backend = startBackend(backendPort);
    await waitForUrl(`http://127.0.0.1:${backendPort}/api/health`, (r) => r.ok);
    const electronApp = await launchElectron(backendPort);

    try {
      const window = await electronApp.firstWindow();
      await window.waitForLoadState("domcontentloaded");
      await importPhotos(electronApp, [photoPath]);
      await expect(window.getByTestId("filmstrip-item")).toHaveCount(1, { timeout: 30000 });
      await window.getByTestId("inspector-tab-compose").click();
      await expect(window.getByTestId("compose-tool-panel")).toBeVisible({ timeout: 15000 });
      await window.getByTestId("focus-crop-detect").click();
      await expect(window.locator(".pc-crop-overlay")).toBeVisible({ timeout: 30000 });
      const cropApplyResponse = window.waitForResponse(
        async (response) => {
          if (!/\/api\/calibrate(-session)?$/.test(new URL(response.url()).pathname) || !response.ok()) return false;
          const payload = await response.json().catch(() => null);
          return payload?.processing?.crop_applied === true;
        },
        { timeout: 60000 },
      );
      await window.getByTestId("crop-apply-button").click();
      await cropApplyResponse;
      await expect(window.locator(".pc-crop-overlay")).toHaveCount(0);

      const rotateResponse = window.waitForResponse(
        async (response) => {
          if (!/\/api\/calibrate(-session)?$/.test(new URL(response.url()).pathname) || !response.ok()) return false;
          const payload = await response.json().catch(() => null);
          return payload?.processing?.image_transform?.rotation === 90;
        },
        { timeout: 60000 },
      );
      await window.getByTestId("compose-rotate-right").click();
      const rotatePayload = await (await rotateResponse).json();
      expect(rotatePayload.processing.image_transform_applied).toBeTruthy();
      expect(rotatePayload.processing.crop_applied).toBeTruthy();
      expect(rotatePayload.processing.image_transform.rotation).toBe(90);
      expect(rotatePayload.output.height).toBeGreaterThan(rotatePayload.output.width);
      await expect(window.getByTestId("compose-rotation-input")).toHaveValue("90");

      const flipResponse = window.waitForResponse(
        async (response) => {
          if (!/\/api\/calibrate(-session)?$/.test(new URL(response.url()).pathname) || !response.ok()) return false;
          const payload = await response.json().catch(() => null);
          return payload?.processing?.image_transform?.flip_h === true;
        },
        { timeout: 60000 },
      );
      await window.getByTestId("compose-flip-horizontal").click();
      const flipPayload = await (await flipResponse).json();
      expect(flipPayload.processing.image_transform_applied).toBeTruthy();
      expect(flipPayload.processing.image_transform.flip_h).toBeTruthy();
      await expect(window.getByTestId("compose-flip-horizontal")).toHaveClass(/is-active/);
    } finally {
      await electronApp.close().catch(() => {});
      stopServer(backend);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("completes negative import, crop, calibrate, and export workflow", async () => {
    test.setTimeout(120000);
    const exportPath = path.join(os.tmpdir(), "photo-calibrator-negative-flow-export.png");
    const expectedExportPath = fs.realpathSync.native(path.dirname(exportPath))
      ? path.join(fs.realpathSync.native(path.dirname(exportPath)), path.basename(exportPath))
      : exportPath;
    fs.rmSync(exportPath, { force: true });
    const backendPort = await getFreePort();
    const backend = startBackend(backendPort);
    await waitForUrl(`http://127.0.0.1:${backendPort}/api/health`, (r) => r.ok);

    const electronApp = await launchElectron(backendPort);

    try {
      const window = await electronApp.firstWindow();
      await window.waitForLoadState("domcontentloaded");
      await expect(window.getByTestId("app-shell")).toBeVisible({ timeout: 15000 });
      await importPhotos(electronApp, [TEST_NEGATIVE_PHOTO]);

      await expect(window.getByTestId("filmstrip-item")).toHaveCount(1, { timeout: 30000 });
      await expect(window.getByTestId("viewer-stage-shell")).toBeVisible({ timeout: 15000 });

      await window.getByTestId("focus-crop-detect").click();
      await expect(window.locator(".pc-crop-overlay")).toBeVisible({ timeout: 30000 });
      await window.getByTestId("inspector-tab-compose").click();
      const cropApplyButton = window.getByTestId("crop-apply-button");
      if ((await cropApplyButton.textContent()) !== "已应用") {
        await cropApplyButton.click();
        await expect(cropApplyButton).toHaveText("已应用", { timeout: 15000 });
      }
      await expect(window.locator(".pc-crop-overlay")).toHaveCount(0);

      await window.getByTestId("inspector-tab-adjust").click();
      await window.getByTestId("mode-select").selectOption("global");
      await window.waitForTimeout(500);
      const negativeBaseResponse = window.waitForResponse(
        async (response) => {
          if (!/\/api\/calibrate(?:-session)?$/.test(response.url()) || !response.ok()) return false;
          const payload = await response.json().catch(() => null);
          return payload?.processing?.negative_base_enabled === true;
        },
        { timeout: 60000 },
      );
      await window.getByTestId("negative-base-toggle").check();
      await negativeBaseResponse;
      const autoBestResponse = window.waitForResponse(
        async (response) => {
          if (!/\/api\/calibrate(?:-session)?$/.test(response.url()) || !response.ok()) return false;
          const payload = await response.json().catch(() => null);
          return payload?.processing?.negative_base_enabled === true && payload?.processing?.auto_best_selected_mode;
        },
        { timeout: 60000 },
      );
      await window.getByTestId("mode-select").selectOption("auto-best");
      await autoBestResponse;
      await expect(window.getByTestId("auto-best-result")).toBeVisible({ timeout: 15000 });
      await window.getByTestId("inspector-tab-compose").click();
      await expect(window.getByTestId("crop-apply-button")).toHaveText("已应用");
      await expect(window.locator(".pc-crop-overlay")).toHaveCount(0);
      await window.getByTestId("inspector-tab-adjust").click();
      await expect.poll(async () => window.evaluate(() => document.querySelectorAll(".pc-stage-crop-preview").length), { timeout: 15000 }).toBe(0);
      const calibratedPreviewStyles = await window.evaluate(() =>
        Array.from(document.querySelectorAll(".pc-stage-image"))
          .filter((node) => node.getAttribute("alt") === "Calibrated")
          .map((node) => node.getAttribute("style") || ""),
      );
      expect(calibratedPreviewStyles.length).toBeGreaterThan(0);
      expect(calibratedPreviewStyles.every((style) => !style.includes("width:") && !style.includes("left:"))).toBeTruthy();

      await window.getByTestId("inspector-tab-export").click();
      await expect(window.locator(".pc-crop-overlay")).toHaveCount(0);
      const exportSection = window.getByTestId("export-settings-section");
      await expect(exportSection).toBeVisible({ timeout: 15000 });
      await exportSection.locator("select").first().selectOption("png");
      await exportSection.locator('input[type="text"]').fill(exportPath);

      const exportResponse = window.waitForResponse(
        (response) => response.url().endsWith("/api/export") && response.ok(),
        { timeout: 60000 },
      );
      await window.getByTestId("export-run-button").click();
      const exportPayload = await (await exportResponse).json();

      await expect(window.getByTestId("export-status-chip")).toContainText("Complete", { timeout: 60000 });
      expect(fs.existsSync(exportPath)).toBeTruthy();
      expect(fs.statSync(exportPath).size).toBeGreaterThan(1024);
      expect(exportPayload.format).toBe("png");
      expect(exportPayload.path).toBe(expectedExportPath);
      await expect(window.getByTestId("export-result-path")).toContainText(expectedExportPath);
      await window.getByTestId("inspector-tab-compose").click();
      await expect(window.getByTestId("crop-apply-button")).toHaveText("已应用");
      await expect(window.locator(".pc-crop-overlay")).toHaveCount(0);
    } finally {
      await electronApp.close().catch(() => {});
      stopServer(backend);
      fs.rmSync(exportPath, { force: true });
    }
  });

  test("commits one slider action on release and restores it after relaunch", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "photo-calibrator-history-"));
    const photoPath = path.join(tempDir, "history-test.tif");
    fs.copyFileSync(TEST_PHOTOS[0], photoPath);
    const backendPort = await getFreePort();
    const backend = startBackend(backendPort);
    await waitForUrl(`http://127.0.0.1:${backendPort}/api/health`, (r) => r.ok);

    let electronApp = await launchElectron(backendPort);
    try {
      let window = await electronApp.firstWindow();
      await window.waitForLoadState("domcontentloaded");
      await importPhotos(electronApp, [photoPath]);
      await expect(window.getByTestId("filmstrip-item")).toHaveCount(1, { timeout: 30000 });
      await window.getByTestId("inspector-tab-adjust").click();
      const slider = window.getByTestId("strength-input");
      await expect(slider).toBeVisible();
      await expect.poll(async () => window.evaluate(() => {
        const records = window.__PHOTO_CALIBRATOR_CALIBRATION_TIMINGS__ ?? [];
        return records.some((item) => item.accepted);
      }), { timeout: 30000 }).toBeTruthy();
      await window.evaluate(() => {
        window.__PHOTO_CALIBRATOR_CALIBRATION_TIMINGS__ = [];
      });

      let commitRequests = 0;
      const calibrationRequests = [];
      window.on("request", (request) => {
        if (request.url().endsWith("/api/history/commit")) commitRequests += 1;
        if (/\/api\/calibrate(-session)?$/.test(new URL(request.url()).pathname)) {
          const body = request.postDataJSON();
          calibrationRequests.push({
            endpoint: new URL(request.url()).pathname,
            fast: body.fast,
            hasPath: Boolean(body.path),
            sessionId: body.session_id,
          });
        }
      });
      const box = await slider.boundingBox();
      expect(box).not.toBeNull();
      const commitResponse = window.waitForResponse((response) => response.url().endsWith("/api/history/commit") && response.ok(), { timeout: 30000 });
      await window.mouse.move(box.x + box.width * 0.67, box.y + box.height / 2);
      await window.mouse.down();
      await window.mouse.move(box.x + box.width * 0.46, box.y + box.height / 2, { steps: 12 });
      await expect.poll(async () => window.evaluate(() => {
        const records = window.__PHOTO_CALIBRATOR_CALIBRATION_TIMINGS__ ?? [];
        return records.some((item) => item.fast && item.accepted);
      }), { timeout: 5000 }).toBeTruthy();
      const dragTimings = await window.evaluate(() => window.__PHOTO_CALIBRATOR_CALIBRATION_TIMINGS__ ?? []);
      expect(dragTimings.some((item) => item.fast && item.accepted && item.analysisWidth <= 640 && item.analysisHeight <= 640)).toBeTruthy();
      expect(calibrationRequests.some((item) => item.endpoint === "/api/calibrate-session" && item.fast === true && item.sessionId)).toBeTruthy();
      expect(calibrationRequests.some((item) => item.endpoint === "/api/calibrate" && item.hasPath)).toBeFalsy();
      await window.mouse.up();
      const committedStrength = await slider.inputValue();
      const commitBody = await (await commitResponse).json();
      expect(commitRequests).toBe(1);
      expect(commitBody.history.at(-1).after_state.strength).toBe(Number(committedStrength));
      await electronApp.close();

      electronApp = await launchElectron(backendPort);
      window = await electronApp.firstWindow();
      await window.waitForLoadState("domcontentloaded");
      const restoreResponse = window.waitForResponse((response) => response.url().endsWith("/api/workspace/open") && response.ok());
      await importPhotos(electronApp, [photoPath]);
      const restoreBody = await (await restoreResponse).json();
      expect(restoreBody.files[0].state.strength).toBe(Number(committedStrength));
      await expect(window.getByTestId("filmstrip-item")).toHaveCount(1, { timeout: 30000 });
      await window.getByTestId("inspector-tab-adjust").click();
      await expect(window.getByTestId("strength-input")).toHaveValue(committedStrength, { timeout: 15000 });
      await window.getByTestId("inspector-tab-session").click();
      await expect(window.getByTestId("history-panel")).toContainText("强度调整");
    } finally {
      await electronApp.close().catch(() => {});
      stopServer(backend);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("commits one curve action after pointer release", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "photo-calibrator-curve-history-"));
    const photoPath = path.join(tempDir, "curve-history.tif");
    fs.copyFileSync(TEST_PHOTOS[0], photoPath);
    const backendPort = await getFreePort();
    const backend = startBackend(backendPort);
    await waitForUrl(`http://127.0.0.1:${backendPort}/api/health`, (r) => r.ok);
    const electronApp = await launchElectron(backendPort);
    try {
      const window = await electronApp.firstWindow();
      await window.waitForLoadState("domcontentloaded");
      await importPhotos(electronApp, [photoPath]);
      await expect(window.getByTestId("filmstrip-item")).toHaveCount(1, { timeout: 30000 });
      await window.getByTestId("inspector-tab-curves").click();
      const point = window.getByTestId("curve-point-r-2");
      await expect(point).toBeVisible();
      let commitRequests = 0;
      window.on("request", (request) => {
        if (request.url().endsWith("/api/history/commit")) commitRequests += 1;
      });
      const box = await point.boundingBox();
      expect(box).not.toBeNull();
      await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await window.mouse.down();
      await window.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2 - 15, { steps: 10 });
      const overlay = window.locator(".pc-stage-preview-overlay").first();
      await expect(overlay).toBeVisible({ timeout: 10000 });
      const overlayBox = await overlay.boundingBox();
      const stageBox = await window.getByTestId("viewer-stage-shell").boundingBox();
      expect(overlayBox).not.toBeNull();
      expect(stageBox).not.toBeNull();
      expect(overlayBox.width).toBeGreaterThan(100);
      expect(overlayBox.height).toBeGreaterThan(100);
      expect(overlayBox.x + overlayBox.width).toBeGreaterThan(stageBox.x);
      expect(overlayBox.y + overlayBox.height).toBeGreaterThan(stageBox.y);
      expect(overlayBox.x).toBeLessThan(stageBox.x + stageBox.width);
      expect(overlayBox.y).toBeLessThan(stageBox.y + stageBox.height);
      const paintedCanvas = await overlay.locator("canvas").first().evaluate((canvas) => ({
        width: canvas.width,
        height: canvas.height,
      }));
      expect(paintedCanvas.width).toBeGreaterThan(100);
      expect(paintedCanvas.height).toBeGreaterThan(100);
      const committed = window.waitForResponse((response) => response.url().endsWith("/api/history/commit") && response.ok(), { timeout: 30000 });
      await window.mouse.up();
      await committed;
      expect(commitRequests).toBe(1);
      await expect(window.getByTestId("viewer-stage-shell")).toBeVisible();
      await expect(window.getByTestId("viewer-pane")).toBeVisible();
    } finally {
      await electronApp.close();
      stopServer(backend);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
