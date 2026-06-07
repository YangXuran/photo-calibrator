const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { makeImage, startLegacyServer, stopServer, waitForServer } = require("./legacy_ui_helpers");

test("loads a folder, shows bottom thumbnails, and displays calibration metrics", async ({ page }) => {
  const port = 8876;
  const url = `http://127.0.0.1:${port}`;
  await page.setViewportSize({ width: 1080, height: 720 });
  const sampleDir = fs.mkdtempSync(path.join(os.tmpdir(), "photo-calibrator-ui-"));
  const one = path.join(sampleDir, "a-warm-01.png");
  const two = path.join(sampleDir, "b-cool-02.tif");
  makeImage(one, [170, 130, 95]);
  makeImage(two, [95, 130, 170]);
  let uploadCalibrations = 0;
  let sessionCalibrations = 0;
  let filmScanRequests = 0;

  const server = startLegacyServer(port);

  try {
    await waitForServer(url);
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname === "/api/calibrate") uploadCalibrations += 1;
      if (pathname === "/api/calibrate-session") sessionCalibrations += 1;
      if (pathname === "/api/film-scan") filmScanRequests += 1;
    });
    await page.goto(url);
    await page.getByTestId("file-input").setInputFiles([one, two]);

    await expect(page.getByTestId("thumbnail")).toHaveCount(2);
    await expect(page.getByTestId("image-grid")).toBeVisible();
    await expect(page.getByTestId("library-source")).not.toHaveText("Not loaded");
    await expect(page.getByTestId("library-count")).toHaveText("2");
    await expect(page.getByTestId("viewer-file-label")).toContainText("a-warm-01.png");
    await expect(page.locator('[data-testid="thumbnail"]').filter({ hasText: "b-cool-02.tif" }).locator("img")).toHaveAttribute("src", /data:image\/jpeg/);
    await expect(page.getByTestId("original-image")).toHaveAttribute("src", /(blob:|data:image\/jpeg)/);
    await expect(page.getByTestId("calibrated-image")).toHaveAttribute("src", /data:image\/jpeg/);
    await expect(page.getByTestId("before-strength")).not.toHaveText("-");
    await expect(page.getByTestId("after-strength")).not.toHaveText("-");
    await expect(page.getByTestId("analysis-size")).not.toHaveText("-");
    await expect(page.getByTestId("cast-source")).not.toHaveText("-");
    await expect(page.getByTestId("preview-source")).not.toHaveText("-");
    await expect(page.getByTestId("mode-select")).toBeVisible();
    await expect(page.getByTestId("strength-input")).toBeVisible();
    await expect(page.getByTestId("accelerator-backend")).not.toHaveText("-");
    await expect(page.getByTestId("accelerator-requested")).not.toHaveText("-");
    await expect(page.getByTestId("accelerated-ops")).not.toHaveText("-");
    await expect(page.getByTestId("fallback-ops")).not.toHaveText("-");
    await expect(page.getByTestId("fallback-reason")).not.toHaveText("-");
    await expect(page.getByTestId("opencl-status")).not.toHaveText("-");
    await expect(page.getByTestId("lut-path")).not.toHaveText("-");
    await expect(page.getByTestId("ccc-value")).not.toHaveText("-");
    await expect(page.getByTestId("pci-value")).not.toHaveText("-");
    await expect(page.getByTestId("compare-mode")).toBeVisible();
    await expect(page.getByTestId("workspace-status-extension")).toBeVisible();

    await page.getByTestId("compare-split").click();
    await expect(page.getByTestId("split-control")).toBeVisible();
    await expect(page.getByTestId("split-compare")).toBeVisible();
    await page.getByTestId("split-position-input").fill("35");
    await expect
      .poll(() => page.getByTestId("split-divider").evaluate((node) => node.style.left))
      .toBe("35%");

    await page.getByTestId("compare-side-by-side").click();
    await page.getByTestId("inspector-tab-analysis").click();
    await expect(page.getByTestId("rgb-histogram")).toBeVisible();
    await expect(page.getByTestId("lab-vector")).toBeVisible();
    await expect(page.getByTestId("strength-chart")).toBeVisible();
    await expect(page.getByTestId("zone-chart")).toBeVisible();
    await expect(page.getByTestId("zone-rows").locator("tr").first()).toBeVisible();
    await expect(page.getByTestId("skin-status")).toHaveText("Detected");
    await expect(page.getByTestId("skin-pixels")).not.toHaveText("-");
    await expect(page.getByTestId("skin-a")).not.toHaveText("-");

    await page.getByTestId("inspector-tab-crop").click();
    await expect(page.getByTestId("crop-card")).toBeVisible();
    await page.getByTestId("suggest-crop-button").click();
    await expect.poll(() => filmScanRequests, { timeout: 3000 }).toBeGreaterThan(0);
    await expect(page.getByTestId("crop-overlay")).toBeVisible();
    await expect(page.getByTestId("crop-status")).toHaveText("Auto");
    await expect(page.getByTestId("crop-width")).not.toHaveText("-");
    await expect(page.getByTestId("crop-height")).not.toHaveText("-");
    await page.getByTestId("thumbnail").filter({ hasText: "b-cool-02.tif" }).click();
    await expect(page.getByTestId("file-title")).toContainText("b-cool-02.tif");
    await expect(page.getByTestId("crop-overlay")).toBeHidden();
    await expect(page.getByTestId("crop-status")).toHaveText("Disabled");
    await page.getByTestId("thumbnail").filter({ hasText: "a-warm-01.png" }).click();
    await expect(page.getByTestId("file-title")).toContainText("a-warm-01.png");
    await expect(page.getByTestId("crop-overlay")).toBeVisible();
    await expect(page.getByTestId("crop-status")).toHaveText("Auto");
    await page.getByTestId("toggle-crop-overlay").click();
    await expect(page.getByTestId("crop-status")).toHaveText("Disabled");
    await page.getByTestId("toggle-crop-overlay").click();
    await expect(page.getByTestId("crop-status")).toHaveText("Auto");
    await page.getByTestId("reset-crop-button").click();
    await expect(page.getByTestId("crop-overlay")).toBeHidden();
    await expect(page.getByTestId("crop-status")).toHaveText("Disabled");

    await page.getByTestId("inspector-tab-adjust").click();
    await page.getByTestId("accelerator-select").selectOption("cpu-opencv");
    await expect(page.getByTestId("accelerator-requested")).toHaveText("cpu-opencv");
    await expect(page.getByTestId("accelerator-backend")).toHaveText("cpu-opencv");
    await expect(page.getByTestId("accelerated-ops")).toHaveText("None");
    await expect(page.getByTestId("lut-path")).toHaveText("CPU");
    await expect(page.getByTestId("calibrated-image")).toHaveAttribute("src", /data:image\/jpeg/);

    uploadCalibrations = 0;
    sessionCalibrations = 0;
    await page.getByTestId("strength-input").evaluate((input) => {
      input.value = "0.35";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await expect.poll(() => sessionCalibrations, { timeout: 3000 }).toBeGreaterThan(0);
    expect(uploadCalibrations).toBe(0);
    await expect(page.getByTestId("strength-input")).toHaveValue("0.35");
    await expect(page.getByTestId("after-strength")).not.toHaveText("...");

    await page.getByTestId("benchmark-button").evaluate((button) => button.click());
    await expect(page.getByTestId("benchmark-rows").locator("tr")).toHaveCount(6);
    await expect(page.getByTestId("benchmark-rows")).toContainText("lab-rgb");
    await expect(page.getByTestId("benchmark-rows")).toContainText("3d-lut");
    await expect(page.getByTestId("benchmark-rows")).toContainText("cpu");

    await page.getByTestId("thumbnail").filter({ hasText: "b-cool-02.tif" }).click();
    await expect(page.getByTestId("file-title")).toContainText("b-cool-02.tif");
    await expect(page.getByTestId("original-image")).toHaveAttribute("src", /data:image\/jpeg/);
    await expect(page.getByTestId("calibrated-image")).toHaveAttribute("src", /data:image\/jpeg/);
  } finally {
    stopServer(server);
    fs.rmSync(sampleDir, { recursive: true, force: true });
  }
});
