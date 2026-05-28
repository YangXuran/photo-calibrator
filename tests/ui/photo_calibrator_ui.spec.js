const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

function makeImage(filePath, rgb) {
  const script = `
import cv2
import numpy as np
path = r"${filePath}"
if path.lower().endswith((".tif", ".tiff")):
    img = np.zeros((80, 100, 3), dtype=np.uint16)
    img[:, :] = (${rgb[2]} * 256, ${rgb[1]} * 256, ${rgb[0]} * 256)
else:
    img = np.zeros((80, 100, 3), dtype=np.uint8)
    img[:, :] = (${rgb[0]}, ${rgb[1]}, ${rgb[2]})
    img[10:70, 20:80] = (178, 132, 104)
    img = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
cv2.imwrite(path, img)
`;
  const result = require("node:child_process").spawnSync("python3", ["-c", script], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr);
  }
}

async function waitForServer(url) {
  for (let i = 0; i < 60; i += 1) {
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return;
    } catch (_) {
      // Retry while the Python server starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Server did not start");
}

test("loads a folder, shows bottom thumbnails, and displays calibration metrics", async ({ page }) => {
  const port = 8876;
  const url = `http://127.0.0.1:${port}`;
  const sampleDir = fs.mkdtempSync(path.join(os.tmpdir(), "photo-calibrator-ui-"));
  const one = path.join(sampleDir, "a-warm-01.png");
  const two = path.join(sampleDir, "b-cool-02.tif");
  makeImage(one, [170, 130, 95]);
  makeImage(two, [95, 130, 170]);
  let uploadCalibrations = 0;
  let sessionCalibrations = 0;

  const server = spawn("python3", ["-m", "photo_calibrator.backend.simple_server", "--port", String(port)], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONPATH: path.join(process.cwd(), "src") },
    stdio: "pipe",
  });

  try {
    await waitForServer(url);
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname === "/api/calibrate") uploadCalibrations += 1;
      if (pathname === "/api/calibrate-session") sessionCalibrations += 1;
    });
    await page.goto(url);
    await page.getByTestId("file-input").setInputFiles([one, two]);

    await expect(page.getByTestId("thumbnail")).toHaveCount(2);
    await expect(page.getByTestId("image-grid")).toBeVisible();
    await expect(page.getByTestId("library-source")).not.toHaveText("未加载");
    await expect(page.getByTestId("library-count")).toHaveText("2");
    await expect(page.getByTestId("viewer-file-label")).toContainText("a-warm-01.png");
    await expect(page.getByTestId("original-image")).toHaveAttribute("src", /blob:/);
    await expect(page.getByTestId("calibrated-image")).toHaveAttribute("src", /data:image\/jpeg/);
    await expect(page.getByTestId("before-strength")).not.toHaveText("-");
    await expect(page.getByTestId("after-strength")).not.toHaveText("-");
    await expect(page.getByTestId("analysis-size")).not.toHaveText("-");
    await expect(page.getByTestId("cast-source")).not.toHaveText("-");
    await expect(page.getByTestId("preview-source")).not.toHaveText("-");
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
    await expect(page.getByTestId("tool-grid")).toBeVisible();
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
    await expect(page.getByTestId("skin-status")).toHaveText("已检测");
    await expect(page.getByTestId("skin-pixels")).not.toHaveText("-");
    await expect(page.getByTestId("skin-a")).not.toHaveText("-");

    await page.getByTestId("inspector-tab-crop").click();
    await expect(page.getByTestId("crop-card")).toBeVisible();
    await page.getByTestId("toggle-crop-overlay").click();
    await expect(page.getByTestId("crop-overlay")).toBeVisible();
    await expect(page.getByTestId("crop-status")).toHaveText("手动调整");
    await page.getByTestId("thumbnail").filter({ hasText: "b-cool-02.tif" }).click();
    await expect(page.getByTestId("file-title")).toContainText("b-cool-02.tif");
    await expect(page.getByTestId("crop-overlay")).toBeHidden();
    await expect(page.getByTestId("crop-status")).toHaveText("未启用");
    await page.getByTestId("thumbnail").filter({ hasText: "a-warm-01.png" }).click();
    await expect(page.getByTestId("file-title")).toContainText("a-warm-01.png");
    await expect(page.getByTestId("crop-overlay")).toBeVisible();
    await expect(page.getByTestId("crop-status")).toHaveText("手动调整");
    await page.getByTestId("reset-crop-button").click();
    await expect(page.getByTestId("crop-overlay")).toBeHidden();
    await expect(page.getByTestId("crop-status")).toHaveText("未启用");

    await page.getByTestId("inspector-tab-adjust").click();
    await page.getByTestId("accelerator-select").selectOption("cpu-opencv");
    await expect(page.getByTestId("accelerator-requested")).toHaveText("cpu-opencv");
    await expect(page.getByTestId("accelerator-backend")).toHaveText("cpu-opencv");
    await expect(page.getByTestId("accelerated-ops")).toHaveText("无");
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

    await page.getByTestId("benchmark-button").click();
    await expect(page.getByTestId("benchmark-rows").locator("tr")).toHaveCount(6);
    await expect(page.getByTestId("benchmark-rows")).toContainText("lab-rgb");
    await expect(page.getByTestId("benchmark-rows")).toContainText("3d-lut");
    await expect(page.getByTestId("benchmark-rows")).toContainText("cpu");

    await page.getByTestId("thumbnail").filter({ hasText: "b-cool-02.tif" }).click();
    await expect(page.getByTestId("file-title")).toContainText("b-cool-02.tif");
    await expect(page.getByTestId("original-image")).toHaveAttribute("src", /data:image\/jpeg/);
    await expect(page.getByTestId("calibrated-image")).toHaveAttribute("src", /data:image\/jpeg/);
  } finally {
    server.kill();
    fs.rmSync(sampleDir, { recursive: true, force: true });
  }
});
