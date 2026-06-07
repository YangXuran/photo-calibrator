const { test, expect } = require("@playwright/test");
const {
  createTempImageDir,
  getBox,
  makeImage,
  removeTempDir,
  startServers,
  stopServer,
  stubWorkbenchBaseRoutes,
} = require("./react_workbench_helpers");

async function importTestImage(page, frontendUrl) {
  await page.goto(frontendUrl);
  await expect(page.getByTestId("app-shell")).toBeVisible();

  const fileChooser = page.waitForEvent("filechooser");
  await page.getByTestId("topbar-import-files").click();
  const chooser = await fileChooser;
  const { dir, paths } = createTempImageDir();
  makeImage(paths[0], 128, 128, [200, 150, 100]);
  await chooser.setFiles(paths);
  await expect(page.getByTestId("library-item")).toBeVisible({ timeout: 10000 });
  await page.getByTestId("library-item").first().click();
  await expect(page.getByTestId("viewer-pane")).toBeVisible();
  return { dir, paths };
}

async function switchMode(page, mode) {
  await page.getByTestId("mode-select").selectOption(mode);
  await page.waitForTimeout(500);
}

test.describe("curve editor controls", () => {
  let servers;

  test.beforeEach(async () => {
    servers = await startServers();
  });

  test.afterEach(async () => {
    for (const server of Object.values(servers)) {
      await stopServer(server);
    }
    removeTempDir();
  });

  test("curve editor renders in rgb-curves mode at 1440×900", async ({ page }) => {
    const { dir } = await importTestImage(page, servers.frontendUrl);
    try {
      await page.setViewportSize({ width: 1440, height: 900 });

      await switchMode(page, "rgb-curves");
      await expect(page.getByTestId("curve-editor")).toBeVisible({ timeout: 5000 });
      await expect(page.getByTestId("inspector-pane")).toBeVisible();

      const editorBox = await page.getByTestId("curve-editor").boundingBox();
      expect(editorBox).not.toBeNull();
      expect(editorBox.width).toBeGreaterThan(100);
      expect(editorBox.height).toBeGreaterThan(100);

      for (const ch of ["r", "g", "b"]) {
        for (let i = 0; i < 5; i++) {
          await expect(page.getByTestId(`curve-point-${ch}-${i}`)).toBeVisible();
        }
      }
    } finally {
      removeTempDir(dir);
    }
  });

  test("curve editor renders in rgb-curves mode at 1920×1080", async ({ page }) => {
    const { dir } = await importTestImage(page, servers.frontendUrl);
    try {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await switchMode(page, "rgb-curves");
      await expect(page.getByTestId("curve-editor")).toBeVisible({ timeout: 5000 });
    } finally {
      removeTempDir(dir);
    }
  });

  test("curve editor renders in rgb-curves mode at 1280×720", async ({ page }) => {
    const { dir } = await importTestImage(page, servers.frontendUrl);
    try {
      await page.setViewportSize({ width: 1280, height: 720 });
      await switchMode(page, "rgb-curves");
      await expect(page.getByTestId("curve-editor")).toBeVisible({ timeout: 5000 });
    } finally {
      removeTempDir(dir);
    }
  });

  test("dragging curve control point triggers calibration preview update", async ({ page }) => {
    const { dir } = await importTestImage(page, servers.frontendUrl);
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await switchMode(page, "rgb-curves");
      await expect(page.getByTestId("curve-editor")).toBeVisible({ timeout: 5000 });

      const point = page.getByTestId("curve-point-r-2");
      await expect(point).toBeVisible();
      const box = await point.boundingBox();
      expect(box).not.toBeNull();

      await page.mouse.move(box.x + 5, box.y + 5);
      await page.mouse.down();
      await page.mouse.move(box.x + 5, box.y - 30, { steps: 5 });
      await page.mouse.up();

      await page.waitForTimeout(500);
      await expect(page.getByTestId("viewer-calibrated-image")).toBeVisible({ timeout: 5000 });
    } finally {
      removeTempDir(dir);
    }
  });

  test("history panel appears after calibration modifications", async ({ page }) => {
    const { dir } = await importTestImage(page, servers.frontendUrl);
    try {
      await page.setViewportSize({ width: 1440, height: 900 });

      await page.getByTestId("mode-select").selectOption("global");
      await page.waitForTimeout(400);
      await switchMode(page, "rgb-curves");
      await page.waitForTimeout(400);

      await expect(page.getByTestId("history-panel")).toBeVisible({ timeout: 5000 });
      await expect(page.getByTestId("history-undo-btn")).toBeVisible();
      await expect(page.getByTestId("history-redo-btn")).toBeVisible();
    } finally {
      removeTempDir(dir);
    }
  });

  test("chromaticity chart appears in analysis tab for lut3d mode", async ({ page }) => {
    const { dir } = await importTestImage(page, servers.frontendUrl);
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await switchMode(page, "lut3d");
      await page.waitForTimeout(500);

      await page.getByTestId("inspector-tab-analysis").click();
      await page.waitForTimeout(500);

      const chart = page.getByTestId("chromaticity-chart");
      await expect(chart).toBeVisible({ timeout: 5000 });
    } finally {
      removeTempDir(dir);
    }
  });
});
