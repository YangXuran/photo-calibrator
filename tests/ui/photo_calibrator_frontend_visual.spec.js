const { test, expect } = require("@playwright/test");
const {
  createTempImageDir,
  makeImage,
  removeTempDir,
  startServers,
  stopServer,
  stubWorkbenchBaseRoutes,
  stubCompactWorkflowRoutes,
} = require("./react_workbench_helpers");

test.describe("react workbench visual", () => {
  test("keeps full workbench stable on wide desktop viewport", async ({ page }) => {
    const sampleDir = createTempImageDir("photo-calibrator-wide-workbench-ui-");
    const one = `${sampleDir}/wide-shell-a.png`;
    makeImage(one, [172, 128, 98]);

    const { backend, frontend, frontendUrl } = await startServers();
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await stubWorkbenchBaseRoutes(page);
      await page.goto(frontendUrl);
      await page.getByTestId("topbar-file-input").setInputFiles([one]);
      await expect(page.locator(".pc-stage-busy")).toHaveCount(0, { timeout: 15000 });

      await expect(page.getByTestId("analysis-pane")).toBeVisible();
      await expect(page.getByTestId("viewer-pane")).toBeVisible();
      await expect(page.getByTestId("inspector-pane")).toBeVisible();
      await expect(page.getByTestId("workbench-filmstrip")).toBeVisible();
      await expect(page.getByTestId("filmstrip-pane")).toHaveScreenshot("wide-filmstrip-pane.png", {
        animations: "disabled",
        caret: "hide",
        maxDiffPixelRatio: 0.02,
      });
      await expect(page.getByTestId("workbench-topbar")).toHaveScreenshot("wide-topbar.png", {
        animations: "disabled",
        caret: "hide",
        maxDiffPixelRatio: 0.02,
      });
      await expect(page.getByTestId("analysis-pane")).toHaveScreenshot("wide-analysis-pane.png", {
        animations: "disabled",
        caret: "hide",
        maxDiffPixelRatio: 0.02,
      });
      await expect(page.getByTestId("inspector-pane")).toHaveScreenshot("wide-inspector-pane.png", {
        animations: "disabled",
        caret: "hide",
        maxDiffPixelRatio: 0.02,
      });
      await expect(page.getByTestId("app-shell")).toHaveScreenshot("wide-workbench-shell.png", {
        animations: "disabled",
        caret: "hide",
        maxDiffPixelRatio: 0.02,
      });
    } finally {
      stopServer(frontend);
      stopServer(backend);
      removeTempDir(sampleDir);
    }
  });

  test("keeps compact and focus viewer visuals stable after import", async ({ page }) => {
    const sampleDir = createTempImageDir("photo-calibrator-frontend-ui-");
    const one = `${sampleDir}/a-warm-01.png`;
    const two = `${sampleDir}/b-cool-02.tif`;
    makeImage(one, [170, 130, 95]);
    makeImage(two, [95, 130, 170]);

    const { backend, frontend, frontendUrl } = await startServers();
    try {
      await page.setViewportSize({ width: 1080, height: 720 });
      await stubCompactWorkflowRoutes(page);
      await page.goto(frontendUrl);

      await page.getByTestId("topbar-file-input").setInputFiles([one, two]);
      await expect(page.locator(".pc-stage-busy")).toHaveCount(0, { timeout: 15000 });

      await expect(page.getByTestId("filmstrip-item")).toHaveCount(2);
      await expect(page.getByTestId("viewer-stage-shell")).toBeVisible();
      await expect(page.getByTestId("inspector-pane")).toBeVisible();
      await expect(page.getByTestId("filmstrip-pane")).toBeVisible();
      await expect(page.getByTestId("viewer-statusbar")).toBeVisible();
      await expect(page.getByTestId("viewer-status-state")).toContainText(/Imported|Prepared|Calibrated|Crop suggested|Crop adjusted/);
      await expect(page.getByTestId("viewer-status-export")).toContainText("Full-resolution export ready");
      await expect(page.getByTestId("viewer-status-zoom")).toContainText("Fit view");
      await expect(page.getByTestId("app-shell")).toHaveScreenshot("compact-workbench-shell.png", {
        animations: "disabled",
        caret: "hide",
        maxDiffPixelRatio: 0.02,
      });
      await expect(page.getByTestId("viewer-pane")).toHaveScreenshot("compact-viewer-pane.png", {
        animations: "disabled",
        caret: "hide",
        maxDiffPixelRatio: 0.02,
      });

      await page.getByTestId("compare-mode-split").click();
      await page.getByTestId("split-position-input").fill("42");
      await page.getByTestId("toggle-viewer-focus").click();
      await expect(page.getByTestId("focus-overlay-toolbar")).toBeVisible();
      await expect(page.getByTestId("focus-action-dock")).toBeVisible();
      await expect(page.getByTestId("focus-context-hud")).toBeVisible();
      await expect(page.getByTestId("focus-compare-value")).toContainText("Split 42%");
      await expect(page.getByTestId("focus-zoom-value")).toContainText("Fit");
      await expect(page.getByTestId("focus-crop-value")).toContainText("None");
      await expect(page.getByTestId("viewer-hud-overlay")).toHaveScreenshot("focus-hud-overlay.png", {
        animations: "disabled",
        caret: "hide",
        maxDiffPixelRatio: 0.02,
      });
      await expect(page.getByTestId("viewer-pane")).toHaveScreenshot("focus-viewer-pane.png", {
        animations: "disabled",
        caret: "hide",
        maxDiffPixelRatio: 0.02,
      });
    } finally {
      stopServer(frontend);
      stopServer(backend);
      removeTempDir(sampleDir);
    }
  });
});
