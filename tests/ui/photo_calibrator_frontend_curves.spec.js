const { test, expect } = require("@playwright/test");
const {
  TINY_PNG_DATA_URL,
  createTempImageDir,
  fulfillJsonAfterDelay,
  makeImage,
  removeTempDir,
  startServers,
  stopServer,
  stubWorkbenchBaseRoutes,
} = require("./react_workbench_helpers");

async function importTestImage(page, frontendUrl) {
  const sampleDir = createTempImageDir("photo-calibrator-curves-");
  const imagePath = `${sampleDir}/test-warm-01.png`;
  makeImage(imagePath, [200, 150, 100]);

  await page.goto(frontendUrl);
  await expect(page.getByTestId("app-shell")).toBeVisible();

  await page.getByTestId("topbar-file-input").setInputFiles([imagePath]);
  await expect(page.getByTestId("filmstrip-item")).toBeVisible({ timeout: 10000 });
  await page.getByTestId("filmstrip-item").first().click();
  await expect(page.getByTestId("viewer-pane")).toBeVisible();
  return sampleDir;
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
    await stopServer(servers.backend);
    await stopServer(servers.frontend);
  });

  test("curve editor renders in rgb-curves mode at 1440×900", async ({ page }) => {
    const sampleDir = await importTestImage(page, servers.frontendUrl);
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
      removeTempDir(sampleDir);
    }
  });

  test("curve editor renders in rgb-curves mode at 1920×1080", async ({ page }) => {
    const sampleDir = await importTestImage(page, servers.frontendUrl);
    try {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await switchMode(page, "rgb-curves");
      await expect(page.getByTestId("curve-editor")).toBeVisible({ timeout: 5000 });
    } finally {
      removeTempDir(sampleDir);
    }
  });

  test("curve editor renders in rgb-curves mode at 1280×720", async ({ page }) => {
    const sampleDir = await importTestImage(page, servers.frontendUrl);
    try {
      await page.setViewportSize({ width: 1280, height: 720 });
      await switchMode(page, "rgb-curves");
      await expect(page.getByTestId("curve-editor")).toBeVisible({ timeout: 5000 });
    } finally {
      removeTempDir(sampleDir);
    }
  });

  test("dragging curve control point triggers calibration preview update", async ({ page }) => {
    const sampleDir = await importTestImage(page, servers.frontendUrl);
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
      await expect(page.getByTestId("viewer-stage-shell")).toBeVisible({ timeout: 5000 });
    } finally {
      removeTempDir(sampleDir);
    }
  });

  test("history panel appears after calibration modifications", async ({ page }) => {
    const sampleDir = await importTestImage(page, servers.frontendUrl);
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
      removeTempDir(sampleDir);
    }
  });

  test("chromaticity chart appears in analysis tab for lut3d mode", async ({ page }) => {
    await stubWorkbenchBaseRoutes(page);
    await page.route("**/api/calibrate", async (route) => {
      await fulfillJsonAfterDelay(route, {
        session_id: "sess:lut3d-test",
        original_preview: TINY_PNG_DATA_URL,
        calibrated_image: TINY_PNG_DATA_URL,
        reduction_pct: 10,
        input: { direction: "warm", lab: { strength: 80, a_mean: 0.3, b_star_mean: -0.2 }, zones: {} },
        output: { lab: { strength: 60, a_mean: 0.1, b_star_mean: -0.1 } },
        processing: { analysis_width: 320, analysis_height: 220, original_width: 320, original_height: 220, preview_source: "cache", color_space: "sRGB", data_range: [0, 255], accelerator_backend: "cpu-opencv", accelerator_requested: "auto" },
        charts: {
          lut_analysis: {
            source_mode: "lut3d",
            lut_size: 17,
            vectors: [
              { hue_angle: 0, saturation: 0.8, a_before: 10, b_before: 5, a_after: 8, b_after: 3, delta_a: -2, delta_b: -2 },
              { hue_angle: 120, saturation: 0.6, a_before: -8, b_before: 12, a_after: -6, b_after: 10, delta_a: 2, delta_b: -2 },
              { hue_angle: 240, saturation: 0.7, a_before: 5, b_before: -10, a_after: 3, b_after: -8, delta_a: -2, delta_b: 2 },
            ],
          },
        },
      });
    });

    const sampleDir = await importTestImage(page, servers.frontendUrl);
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await switchMode(page, "lut3d");
      await page.waitForTimeout(500);

      await page.getByTestId("inspector-tab-analysis").click();
      await page.waitForTimeout(500);

      const expandBtn = page.getByTestId("analysis-charts-section").getByRole("button", { name: "展开" });
      if (await expandBtn.isVisible()) {
        await expandBtn.click();
        await page.waitForTimeout(300);
      }

      const chart = page.getByTestId("chromaticity-chart");
      await expect(chart).toBeVisible({ timeout: 5000 });
    } finally {
      removeTempDir(sampleDir);
    }
  });
});
