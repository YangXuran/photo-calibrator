const { test, expect } = require("@playwright/test");
const {
  TINY_PNG_DATA_URL,
  createTempImageDir,
  expectInViewport,
  fulfillJsonAfterDelay,
  makeImage,
  removeTempDir,
  startServers,
  stopServer,
  stubCompactWorkflowRoutes,
} = require("./react_workbench_helpers");

test.describe("react workbench workflow", () => {
  test("keeps main calibration visible after import on compact viewport", async ({ page }) => {
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

      await expect(page.getByTestId("filmstrip-item")).toHaveCount(2);
      await expect(page.getByTestId("viewer-stage-shell")).toBeVisible();
      await expect(page.getByTestId("inspector-pane")).toBeVisible();
      await expect(page.getByTestId("main-calibration-section")).toBeVisible();
      await expect(page.getByTestId("mode-select")).toBeVisible();
      await expect(page.getByTestId("strength-input")).toBeVisible();
      await expect(page.getByTestId("filmstrip-pane")).toBeVisible();
      await expect(page.getByTestId("viewer-statusbar")).toBeVisible();
      await expect(page.getByTestId("viewer-status-state")).toContainText(/Imported|Prepared|Calibrated|Crop suggested|Crop adjusted/);
      await expect(page.getByTestId("viewer-status-export")).toContainText("Full-resolution export ready");
      await expect(page.getByTestId("viewer-status-zoom")).toContainText("Fit view");
      await expect(page.getByTestId("viewer-compare-controls")).toHaveClass(/pc-viewer-control-block-default/);
      await expect(page.getByTestId("viewer-stage-toolbar")).toHaveClass(/pc-viewer-control-block-default/);

      await page.getByTestId("compare-mode-calibrated").click();
      await expect(page.getByTestId("compare-mode-calibrated")).toHaveClass(/is-active/);
      await expect(page.getByTestId("split-position-field")).toHaveCount(0);

      await page.getByTestId("compare-mode-split").click();
      await expect(page.getByTestId("compare-mode-split")).toHaveClass(/is-active/);
      await expect(page.getByTestId("split-position-field")).toBeVisible();
      await page.getByTestId("split-position-input").fill("42");
      await expect(page.getByTestId("split-position-input")).toHaveValue("42");

      await page.getByTestId("viewer-zoom-fill").click();
      await expect(page.getByTestId("viewer-status-zoom")).toContainText("Fill view");
      await page.getByTestId("viewer-zoom-in").click();
      await expect(page.getByTestId("viewer-status-zoom")).toContainText("Manual");
      await expect(page.getByTestId("viewer-zoom-readout")).toContainText("%");
      await page.getByTestId("viewer-zoom-reset").click();
      await expect(page.getByTestId("viewer-status-zoom")).toContainText("Fit view");

      await page.getByTestId("toggle-analysis-pane").click();
      await expect(page.getByTestId("analysis-pane")).not.toBeVisible();
      await page.getByTestId("toggle-analysis-pane").click();
      await expect(page.getByTestId("analysis-pane")).toBeVisible();

      await page.getByTestId("toggle-viewer-focus").click();
      await expect(page.getByTestId("focus-overlay-toolbar")).toBeVisible();
      await expect(page.getByTestId("focus-overlay-left-dock")).toBeVisible();
      await expect(page.getByTestId("focus-overlay-right-dock")).toBeVisible();
      await expect(page.getByTestId("focus-action-dock")).toBeVisible();
      await expect(page.getByTestId("focus-context-hud")).toBeVisible();
      await expect(page.getByTestId("focus-compare-value")).toContainText("Split 42%");
      await expect(page.getByTestId("focus-zoom-value")).toContainText("Fit");
      await expect(page.getByTestId("focus-crop-value")).toContainText("None");
      await expect(page.getByTestId("runtime-banner")).toHaveCount(0);
      await expect(page.getByTestId("viewer-hud-overlay")).toHaveClass(/is-active/);
      await page.getByTestId("split-position-input").fill("35");
      await expect(page.getByTestId("focus-compare-value")).toContainText("35%");
      await page.getByTestId("focus-crop-detect").click();
      await expect(page.getByTestId("focus-crop-value")).toContainText(/Detecting|Suggested/);
      await page.getByTestId("focus-zoom-in").click();
      await expect(page.getByTestId("focus-zoom-value")).toContainText("%");
      await page.waitForTimeout(2400);
      await expect(page.getByTestId("viewer-hud-overlay")).toHaveClass(/is-dimmed/);
      await page.getByTestId("viewer-stage-shell").hover();
      await expect(page.getByTestId("viewer-hud-overlay")).toHaveClass(/is-active/);
      await page.getByTestId("toggle-viewer-focus").click();
      await expect(page.getByTestId("runtime-banner")).toBeVisible();

      await page.getByTestId("inspector-tab-export").click();
      await expect(page.getByTestId("export-settings-section")).toBeVisible();
      await page.getByTestId("export-run-button").click();
      await expect(page.getByTestId("export-status-chip")).toContainText("Running");
      await expect(page.getByTestId("export-result-summary")).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId("export-status-chip")).toContainText("Complete", { timeout: 15000 });
      await expect(page.getByTestId("export-result-path")).toContainText("/tmp/photo-calibrator-ui-export.jpeg");
      await expect(page.getByTestId("export-settings-section")).toContainText("sRGB");
      await expect(page.getByTestId("export-settings-section")).toContainText("camera_model, lens_model");

      await page.getByTestId("inspector-tab-session").click();
      await expect(page.getByTestId("document-context-section")).toBeVisible();
      await page.getByTestId("document-render-button").click();
      await expect(page.getByTestId("document-render-summary")).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId("document-render-status-chip")).toContainText(/Running|Complete/);
      await expect(page.getByTestId("document-render-status-chip")).toContainText("Complete", { timeout: 15000 });
      await expect(page.getByTestId("document-render-detail")).not.toHaveText("");
      await expect(page.getByTestId("document-preview-section")).toBeVisible();
      await page.getByTestId("document-operations-section").getByRole("button", { name: "展开" }).click();
      await expect(page.getByTestId("document-operations-section")).toContainText("calibration");
      await expect(page.getByTestId("document-operations-section")).toContainText("non-replayable");
      await page.getByTestId("session-save-button").click();
      await expect(page.getByTestId("session-save-status-chip")).toContainText("Running");
      await expect(page.getByTestId("session-save-summary")).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId("session-save-status-chip")).toContainText("Complete", { timeout: 15000 });
      await expect(page.getByTestId("session-save-path")).toContainText("/tmp/");
      await expect(page.getByTestId("document-context-section")).toContainText("8.0 KB");

      await page.getByTestId("inspector-tab-ai").click();
      await expect(page.getByTestId("ai-review-section")).toBeVisible();
      await page.getByTestId("ai-evaluator-select").selectOption("builtin.noopaievaluator");
      await page.getByTestId("ai-evaluate-button").click();
      await expect(page.getByTestId("ai-status-chip")).toContainText("Running");
      await expect(page.getByTestId("ai-result-summary")).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId("ai-status-chip")).toContainText("Complete", { timeout: 15000 });
      await expect(page.getByTestId("ai-result-detail")).not.toHaveText("", { timeout: 15000 });
      await expect(page.getByTestId("ai-review-section")).toContainText("Highlights still trend warm.");
      await expect(page.getByTestId("ai-review-section")).toContainText("lab_shift");

      await page.getByTestId("inspector-tab-adjust").click();
      await expectInViewport(page, page.getByTestId("main-calibration-section"), "main calibration section");
      await expectInViewport(page, page.getByTestId("mode-select"), "mode select");
      await expectInViewport(page, page.getByTestId("strength-input"), "strength input");
    } finally {
      stopServer(frontend);
      stopServer(backend);
      removeTempDir(sampleDir);
    }
  });

  test("exports all workspace files in batch with per-file output paths", async ({ page }) => {
    const sampleDir = createTempImageDir("photo-calibrator-batch-export-ui-");
    const one = `${sampleDir}/batch-a.png`;
    const two = `${sampleDir}/batch-b.tif`;
    makeImage(one, [160, 120, 90]);
    makeImage(two, [90, 120, 160]);

    const exportBodies = [];
    const { backend, frontend, frontendUrl } = await startServers();
    try {
      await page.setViewportSize({ width: 1280, height: 840 });
      await stubCompactWorkflowRoutes(page);
      await page.unroute("**/api/export");
      await page.route("**/api/export", async (route) => {
        const body = route.request().postDataJSON();
        exportBodies.push(body);
        await fulfillJsonAfterDelay(route, {
          ok: true,
          path: body.output_path,
          format: body.format,
          size: 20480,
          elapsed_ms: 44.2,
          export_settings: {
            color_space: "sRGB",
            bit_depth: 8,
            metadata_keys: ["camera_model"],
            icc_embedded: true,
          },
        }, 80);
      });
      await page.goto(frontendUrl);

      await page.getByTestId("topbar-file-input").setInputFiles([one, two]);
      await expect(page.getByTestId("filmstrip-item")).toHaveCount(2);

      await page.getByTestId("inspector-tab-export").click();
      await expect(page.getByTestId("batch-export-section")).toBeVisible();
      await page.getByTestId("batch-export-run-button").click();

      await expect(page.getByTestId("batch-export-results")).toContainText("batch-a.png", { timeout: 15000 });
      await expect(page.getByTestId("batch-export-results")).toContainText("batch-b.tif");
      await expect(page.getByTestId("batch-export-results")).toContainText("✅ 2 / ❌ 0");
      expect(exportBodies).toHaveLength(2);
      expect(exportBodies.map((item) => item.file_name)).toEqual(["batch-a.png", "batch-b.tif"]);
      expect(exportBodies[0].output_path).toContain("/batch-a-calibrated.jpg");
      expect(exportBodies[1].output_path).toContain("/batch-b-calibrated.jpg");
    } finally {
      stopServer(frontend);
      stopServer(backend);
      removeTempDir(sampleDir);
    }
  });

  test("manages saved sessions from the session inspector", async ({ page }) => {
    const sampleDir = createTempImageDir("photo-calibrator-library-ui-");
    const one = `${sampleDir}/local-a.png`;
    const two = `${sampleDir}/local-b.png`;
    makeImage(one, [168, 126, 96]);
    makeImage(two, [96, 126, 168]);

    let savedSessions = [
      {
        path: "/tmp/saved-session-001.json",
        session_id: "sess-managed-001",
        saved_at: 1710000000,
        size: 12288,
        analysis_width: 320,
        analysis_height: 220,
        preview_source: "cache",
      },
      {
        path: "/tmp/saved-session-002.json",
        session_id: "sess-managed-002",
        saved_at: 1710000300,
        size: 14336,
        analysis_width: 320,
        analysis_height: 220,
        preview_source: "cache",
      },
    ];

    const { backend, frontend, frontendUrl } = await startServers();
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.route("**/api/session/list", async (route) => {
        await fulfillJsonAfterDelay(route, { sessions: savedSessions }, 120);
      });
      await page.route("**/api/session/delete", async (route) => {
        const body = route.request().postDataJSON();
        savedSessions = savedSessions.filter((item) => item.path !== body.path);
        await fulfillJsonAfterDelay(route, { ok: true, path: body.path, deleted: true }, 180);
      });
      await page.route("**/api/session/load?*", async (route) => {
        const url = new URL(route.request().url());
        const requestedPath = url.searchParams.get("path");
        const item = savedSessions.find((entry) => entry.path === requestedPath);
        await fulfillJsonAfterDelay(route, {
          ok: true,
          path: item?.path ?? requestedPath,
          session_id: item?.session_id ?? "sess-managed-fallback",
          processing: {
            analysis_width: item?.analysis_width ?? 320,
            analysis_height: item?.analysis_height ?? 220,
            preview_source: item?.preview_source ?? "cache",
            color_space: "sRGB",
            data_range: [0, 255],
          },
          session_metadata: {
            session_id: item?.session_id ?? "sess-managed-fallback",
          },
        });
      });
      await page.route("**/api/calibrate-session", async (route) => {
        const body = route.request().postDataJSON();
        await fulfillJsonAfterDelay(route, {
          session_id: body.session_id,
          original_preview: TINY_PNG_DATA_URL,
          calibrated_image: TINY_PNG_DATA_URL,
          reduction_pct: 12,
          input: {
            direction: "neutral",
            lab: {
              strength: 82,
              a_mean: 0.4,
              b_star_mean: -0.3,
            },
          },
          output: {
            lab: {
              strength: 82,
              a_mean: 0.1,
              b_star_mean: -0.1,
            },
          },
          processing: {
            preview_source: "cache",
            color_space: "sRGB",
            original_width: 320,
            original_height: 220,
            analysis_width: 320,
            analysis_height: 220,
          },
        });
      });

      await page.goto(frontendUrl);
      await page.getByTestId("topbar-file-input").setInputFiles([one, two]);
      await page.getByTestId("inspector-tab-session").click();

      await expect(page.getByTestId("saved-sessions-section")).toBeVisible();
      await expect(page.getByTestId("saved-session-item")).toHaveCount(2);

      await page.getByTestId("saved-session-load").first().click();
      await expect(page.getByTestId("activity-item").first()).toContainText("Session loaded");
      await expect(page.getByTestId("filmstrip-item")).toHaveCount(3);

      await page.getByTestId("saved-session-delete").nth(1).click();
      await expect(page.getByTestId("saved-session-item")).toHaveCount(1);
      await expect(page.getByTestId("saved-session-id")).toHaveText(["sess-managed-001"]);
      await expect(page.getByTestId("activity-item").first()).toContainText("Session deleted");

      await page.getByTestId("saved-sessions-refresh").click();
      await expect(page.getByTestId("saved-session-item")).toHaveCount(1);
      await expect(page.getByTestId("saved-session-id")).toHaveText(["sess-managed-001"]);
    } finally {
      stopServer(frontend);
      stopServer(backend);
      removeTempDir(sampleDir);
    }
  });
});
