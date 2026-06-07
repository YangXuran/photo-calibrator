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

async function dragHandle(page, locator, deltaX = 0, deltaY = 0) {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error("resize handle has no bounding box");
  }
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY + deltaY, { steps: 8 });
  await page.mouse.up();
}

test.describe("react workbench layout", () => {
  test("renders workbench panes and runtime dialog", async ({ page }) => {
    const { backend, frontend, frontendUrl } = await startServers();
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await stubWorkbenchBaseRoutes(page);
      await page.goto(frontendUrl);

      await expect(page.getByTestId("app-shell")).toBeVisible();
      await expect(page.getByTestId("workbench-topbar")).toBeVisible();
      await expect(page.getByTestId("workbench-layout")).toBeVisible();
      await expect(page.getByTestId("library-pane")).toBeVisible();
      await expect(page.getByTestId("viewer-pane")).toBeVisible();
      await expect(page.getByTestId("inspector-pane")).toBeVisible();
      await expect(page.getByTestId("workbench-filmstrip")).toBeVisible();
      await expect(page.getByTestId("filmstrip-pane")).toHaveClass(/pc-filmstrip-pane-default/);
      await expect(page.getByTestId("viewer-pane-header")).toHaveClass(/pc-viewer-pane-header-default/);
      await expect(page.getByTestId("viewer-pane-controls")).toHaveClass(/pc-viewer-pane-controls-default/);
      await expect(page.getByTestId("viewer-statusbar")).toHaveClass(/pc-viewer-statusbar-default/);
      await expect(page.getByTestId("layout-quick-controls")).toBeVisible();

      await page.getByTestId("toggle-viewer-focus").click();
      await expect(page.getByTestId("viewer-pane")).toBeVisible();
      await expect(page.getByTestId("library-pane")).toHaveCount(0);
      await expect(page.getByTestId("inspector-pane")).toHaveCount(0);
      await expect(page.getByTestId("workbench-filmstrip")).toHaveCount(0);
      await expect(page.getByTestId("runtime-banner")).toHaveCount(0);

      await page.getByTestId("toggle-viewer-focus").click();
      await expect(page.getByTestId("library-pane")).toBeVisible();
      await expect(page.getByTestId("inspector-pane")).toBeVisible();
      await expect(page.getByTestId("workbench-filmstrip")).toBeVisible();
      await expect(page.getByTestId("runtime-banner")).toBeVisible();

      await page.getByTestId("runtime-settings-button").click();
      await expect(page.getByTestId("runtime-settings-dialog")).toBeVisible();
      await expect(page.getByTestId("runtime-settings-dialog")).toContainText("Runtime Settings");
      await expect(page.getByTestId("runtime-settings-dialog")).toContainText("Runtime mode");
      await expect(page.getByTestId("runtime-settings-dialog")).toContainText("browser");
    } finally {
      stopServer(frontend);
      stopServer(backend);
    }
  });

  test("persists layout preferences and exposes runtime/help state through dialogs", async ({ page }) => {
    const { backend, frontend, frontendUrl } = await startServers();
    try {
      await page.addInitScript(() => {
        if (!window.sessionStorage.getItem("photo-calibrator-test-storage-cleared")) {
          window.localStorage.clear();
          window.sessionStorage.setItem("photo-calibrator-test-storage-cleared", "1");
        }
      });
      await page.setViewportSize({ width: 1440, height: 900 });
      await stubWorkbenchBaseRoutes(page);
      await page.goto(frontendUrl);

      await expect(page.getByTestId("library-pane")).toBeVisible();
      await expect(page.getByTestId("inspector-pane")).toBeVisible();
      await expect(page.getByTestId("workbench-filmstrip")).toBeVisible();

      await page.getByTestId("runtime-settings-button").click();
      await expect(page.getByTestId("runtime-settings-dialog")).toBeVisible();
      await expect(page.getByTestId("runtime-settings-dialog")).toContainText("Runtime mode");
      await expect(page.getByTestId("runtime-settings-dialog")).toContainText("browser");
      await expect(page.getByTestId("runtime-settings-dialog")).toContainText("File open strategy");
      await expect(page.getByTestId("runtime-settings-dialog")).toContainText("browser-input");
      await page.getByTestId("runtime-settings-dialog").getByRole("button", { name: "关闭" }).click();
      await expect(page.getByTestId("runtime-settings-dialog")).toHaveCount(0);

      await page.getByTestId("shortcut-help-button").click();
      await expect(page.getByTestId("shortcut-help-dialog")).toBeVisible();
      await expect(page.getByTestId("shortcut-help-dialog")).toContainText("Workspace Layout");
      await expect(page.getByTestId("shortcut-help-dialog")).toContainText("Desktop Runtime");
      await expect(page.getByTestId("shortcut-help-dialog")).toContainText("browser-input");
      await page.getByTestId("shortcut-help-dialog").getByRole("button", { name: "关闭" }).click();
      await expect(page.getByTestId("shortcut-help-dialog")).toHaveCount(0);

      await page.getByTestId("layout-settings-button").click();
      await expect(page.getByTestId("layout-settings-dialog")).toBeVisible();
      await expect(page.getByTestId("layout-preset-current")).toContainText("平衡工作台");
      await expect(page.getByTestId("layout-pref-showFilmstrip")).toBeChecked();
      await expect(page.getByTestId("layout-pref-showActivityPanel")).toBeChecked();
      await expect(page.getByTestId("layout-pref-showLibraryPane")).toBeChecked();
      await expect(page.getByTestId("library-workspace-group")).toHaveClass(/pc-pane-group-default/);
      await expect(page.getByTestId("library-context-group")).toHaveClass(/pc-pane-group-default/);
      await expect(page.getByTestId("library-tools-group")).toHaveClass(/pc-pane-group-compact/);
      await expect(page.getByTestId("quick-actions-section")).toHaveClass(/pc-card-compact/);
      await expect(page.getByTestId("quick-actions-section")).toHaveClass(/pc-card-muted/);
      await expect(page.getByTestId("action-status-section")).toHaveClass(/pc-card-compact/);
      await expect(page.getByTestId("action-status-section")).toHaveClass(/pc-card-muted/);

      await page.getByTestId("layout-preset-analyze-card").click();
      await expect(page.getByTestId("layout-preset-current")).toContainText("分析布局");
      await expect(page.getByTestId("layout-pref-showLibraryPane")).not.toBeChecked();
      await expect(page.getByTestId("layout-pref-showAdjustQuickActions")).not.toBeChecked();
      await expect(page.getByTestId("library-pane")).toHaveCount(0);
      await expect(page.getByTestId("inspector-pane")).toBeVisible();
      await expect(page.getByTestId("workbench-filmstrip")).toBeVisible();
      await expect(page.getByTestId("inspector-pane-group")).toHaveClass(/pc-pane-group-compact/);
      await expect(page.getByTestId("inspector-pane-group")).toHaveClass(/pc-pane-group-primary/);
      await expect(page.getByTestId("viewer-pane-header")).toHaveClass(/pc-viewer-pane-header-muted/);
      await expect(page.getByTestId("viewer-pane-header")).toHaveClass(/pc-viewer-pane-header-compact/);
      await expect(page.getByTestId("viewer-pane-controls")).toHaveClass(/pc-viewer-pane-controls-compact/);
      await expect(page.getByTestId("viewer-pane-controls")).toHaveClass(/pc-viewer-pane-controls-muted/);
      await expect(page.getByTestId("viewer-statusbar")).toHaveClass(/pc-viewer-statusbar-compact/);
      await expect(page.getByTestId("viewer-statusbar")).toHaveClass(/pc-viewer-statusbar-muted/);
      await expect(page.getByTestId("compare-mode-dual")).toHaveCount(0);
      await expect(page.getByTestId("compare-mode-split")).toBeVisible();
      await expect(page.getByTestId("compare-mode-calibrated")).toBeVisible();
      await expect(page.getByTestId("inspector-tab-analysis")).toHaveClass(/is-active/);
      await expect(page.getByTestId("compare-mode-calibrated")).toHaveClass(/is-active/);
      await expect(page.getByTestId("viewer-status-zoom")).toContainText("Fill view");
      await expect(page.getByTestId("quick-actions-section")).toHaveCount(0);
      await page.getByTestId("layout-settings-dialog").getByRole("button", { name: "关闭" }).click();
      await expect(page.getByTestId("layout-settings-dialog")).toHaveCount(0);
      await expect(page.getByTestId("analysis-charts-section").getByRole("button", { name: "展开" })).toBeVisible();
      await page.getByTestId("analysis-charts-section").getByRole("button", { name: "展开" }).click();
      await expect(page.getByTestId("analysis-charts-section").getByRole("button", { name: "收起" })).toBeVisible();

      await page.getByTestId("compare-mode-split").click();
      await page.getByTestId("split-position-input").fill("37");
      await page.getByTestId("viewer-zoom-fit").click();
      await expect(page.getByTestId("viewer-status-zoom")).toContainText("Fit view");

      await page.getByTestId("inspector-tab-export").click();
      await expect(page.getByTestId("inspector-tab-export")).toHaveClass(/is-active/);
      await page.getByTestId("layout-settings-button").click();
      await page.getByTestId("layout-preset-edit-card").click();
      await expect(page.getByTestId("inspector-pane-group")).toHaveClass(/pc-pane-group-primary/);
      await expect(page.getByTestId("quick-actions-section")).toHaveClass(/pc-card-primary/);
      await expect(page.getByTestId("quick-actions-section")).toHaveClass(/pc-card-default/);
      await expect(page.getByTestId("action-status-section")).toHaveClass(/pc-card-default/);
      await expect(page.getByTestId("action-status-section")).toHaveClass(/pc-card-compact/);
      await expect(page.getByTestId("viewer-pane-header")).toHaveClass(/pc-viewer-pane-header-primary/);
      await expect(page.getByTestId("viewer-pane-controls")).toHaveClass(/pc-viewer-pane-controls-primary/);
      await expect(page.getByTestId("viewer-statusbar")).toHaveClass(/pc-viewer-statusbar-compact/);
      await expect(page.getByTestId("compare-mode-dual")).toHaveCount(0);
      await expect(page.getByTestId("compare-mode-split")).toBeVisible();
      await expect(page.getByTestId("compare-mode-calibrated")).toBeVisible();
      await page.getByTestId("layout-preset-review-card").click();
      await expect(page.getByTestId("layout-preset-current")).toContainText("审片布局");
      await expect(page.getByTestId("library-workspace-group")).toHaveClass(/pc-pane-group-primary/);
      await expect(page.getByTestId("library-tools-group")).toHaveClass(/pc-pane-group-default/);
      await expect(page.getByTestId("library-tools-group")).toHaveClass(/pc-pane-group-compact/);
      await expect(page.getByTestId("library-context-group")).toHaveClass(/pc-pane-group-muted/);
      await expect(page.getByTestId("library-context-group")).toHaveClass(/pc-pane-group-compact/);
      await expect(page.getByTestId("filmstrip-pane")).toHaveClass(/pc-filmstrip-pane-primary/);
      await expect(page.getByTestId("viewer-pane-header")).toHaveClass(/pc-viewer-pane-header-primary/);
      await expect(page.getByTestId("viewer-pane-controls")).toHaveClass(/pc-viewer-pane-controls-primary/);
      await expect(page.getByTestId("viewer-statusbar")).toHaveClass(/pc-viewer-statusbar-default/);
      await expect(page.getByTestId("compare-mode-dual")).toBeVisible();
      await expect(page.getByTestId("compare-mode-split")).toBeVisible();
      await expect(page.getByTestId("compare-mode-calibrated")).toHaveCount(0);
      const reviewLibraryWorkspaceBox = await getBox(page.getByTestId("library-workspace-group"), "review library workspace");
      const reviewLibraryToolsBox = await getBox(page.getByTestId("library-tools-group"), "review library tools");
      const reviewLibraryContextBox = await getBox(page.getByTestId("library-context-group"), "review library context");
      expect(reviewLibraryWorkspaceBox.y).toBeLessThan(reviewLibraryToolsBox.y);
      expect(reviewLibraryToolsBox.y).toBeLessThan(reviewLibraryContextBox.y);
      await page.getByTestId("layout-preset-balanced-card").click();
      await expect(page.getByTestId("layout-preset-current")).toContainText("平衡工作台");
      await expect(page.getByTestId("library-workspace-group")).toHaveClass(/pc-pane-group-default/);
      await expect(page.getByTestId("library-context-group")).toHaveClass(/pc-pane-group-default/);
      await expect(page.getByTestId("library-tools-group")).toHaveClass(/pc-pane-group-default/);
      await expect(page.getByTestId("filmstrip-pane")).toHaveClass(/pc-filmstrip-pane-default/);
      await expect(page.getByTestId("viewer-pane-header")).toHaveClass(/pc-viewer-pane-header-default/);
      await expect(page.getByTestId("viewer-pane-controls")).toHaveClass(/pc-viewer-pane-controls-default/);
      await expect(page.getByTestId("viewer-statusbar")).toHaveClass(/pc-viewer-statusbar-default/);
      await expect(page.getByTestId("compare-mode-dual")).toBeVisible();
      await expect(page.getByTestId("compare-mode-split")).toBeVisible();
      await expect(page.getByTestId("compare-mode-calibrated")).toBeVisible();
      const balancedLibraryWorkspaceBox = await getBox(page.getByTestId("library-workspace-group"), "balanced library workspace");
      const balancedLibraryContextBox = await getBox(page.getByTestId("library-context-group"), "balanced library context");
      const balancedLibraryToolsBox = await getBox(page.getByTestId("library-tools-group"), "balanced library tools");
      expect(balancedLibraryWorkspaceBox.y).toBeLessThan(balancedLibraryContextBox.y);
      expect(balancedLibraryContextBox.y).toBeLessThan(balancedLibraryToolsBox.y);
      await expect(page.getByTestId("inspector-tab-adjust")).toHaveClass(/is-active/);
      await expect(page.getByTestId("compare-mode-dual")).toHaveClass(/is-active/);
      await expect(page.getByTestId("viewer-status-zoom")).toContainText("Fit view");
      await page.getByTestId("layout-settings-dialog").getByRole("button", { name: "关闭" }).click();
      await expect(page.getByTestId("layout-settings-dialog")).toHaveCount(0);
      await page.getByTestId("inspector-tab-analysis").click();
      await expect(page.getByTestId("analysis-charts-section").getByRole("button", { name: "展开" })).toBeVisible();
      await page.getByTestId("layout-settings-button").click();
      await page.getByTestId("layout-preset-analyze-card").click();
      await expect(page.getByTestId("inspector-tab-export")).toHaveClass(/is-active/);
      await expect(page.getByTestId("compare-mode-split")).toHaveClass(/is-active/);
      await expect(page.getByTestId("split-position-input")).toHaveValue("37");
      await expect(page.getByTestId("viewer-status-zoom")).toContainText("Fit view");
      await page.getByTestId("layout-settings-dialog").getByRole("button", { name: "关闭" }).click();
      await expect(page.getByTestId("layout-settings-dialog")).toHaveCount(0);
      await page.getByTestId("inspector-tab-session").click();
      const analyzeWorkflowBox = await getBox(page.getByTestId("workflow-feed-section"), "analyze workflow feed");
      const analyzeDocumentBox = await getBox(page.getByTestId("document-context-section"), "analyze session card");
      expect(analyzeWorkflowBox.y).toBeLessThan(analyzeDocumentBox.y);
      await expect(page.getByTestId("filmstrip-pane")).toHaveClass(/pc-filmstrip-pane-muted/);
      await expect(page.getByTestId("filmstrip-item-detail")).toHaveCount(0);
      await page.getByTestId("inspector-tab-analysis").click();
      await expect(page.getByTestId("analysis-charts-section").getByRole("button", { name: "收起" })).toBeVisible();

      await page.getByTestId("layout-settings-button").click();
      await expect(page.getByTestId("layout-preset-current")).toContainText("分析布局");
      await expect(page.getByTestId("layout-pref-showLibraryPane")).not.toBeChecked();
      await expect(page.getByTestId("layout-pref-showAdjustQuickActions")).not.toBeChecked();
      await page.getByTestId("layout-settings-dialog").getByRole("button", { name: "关闭" }).click();

      await page.reload();
      await expect(page.getByTestId("library-pane")).toHaveCount(0);
      await expect(page.getByTestId("workbench-filmstrip")).toBeVisible();
      await expect(page.getByTestId("activity-section")).toHaveCount(0);
      await page.getByTestId("inspector-tab-session").click();
      await expect(page.getByTestId("workflow-feed-section")).toHaveClass(/pc-card-muted/);

      await page.getByTestId("layout-settings-button").click();
      await expect(page.getByTestId("layout-preset-current")).toContainText("分析布局");
      await page.getByTestId("layout-preset-balanced-card").click();
      await page.getByTestId("layout-settings-dialog").getByRole("button", { name: "关闭" }).click();
      await expect(page.getByTestId("layout-settings-dialog")).toHaveCount(0);
      await expect(page.getByTestId("inspector-pane-group")).toHaveClass(/pc-pane-group-default/);
      await page.getByTestId("inspector-tab-session").click();
      await expect(page.getByTestId("workflow-feed-section")).toHaveClass(/pc-card-default/);
      const balancedDocumentBox = await getBox(page.getByTestId("document-context-section"), "balanced session card");
      const balancedWorkflowBox = await getBox(page.getByTestId("workflow-feed-section"), "balanced workflow feed");
      expect(balancedDocumentBox.y).toBeLessThan(balancedWorkflowBox.y);

      await page.getByTestId("layout-settings-button").click();
      await page.getByTestId("layout-preset-analyze-card").click();
      await expect(page.getByTestId("inspector-pane-group")).toHaveClass(/pc-pane-group-compact/);
      await page.getByTestId("layout-pref-showFilmstrip").uncheck();
      await expect(page.getByTestId("workbench-filmstrip")).toHaveCount(0);
      await expect(page.getByTestId("layout-preset-current")).toContainText("自定义布局");
      await expect(page.getByTestId("layout-preset-custom-pill")).toContainText("自定义");
      await page.getByTestId("layout-settings-dialog").getByRole("button", { name: "关闭" }).click();
      await expect(page.getByTestId("layout-settings-dialog")).toHaveCount(0);

      await page.getByTestId("layout-settings-button").click();
      await page.getByTestId("layout-settings-focus-toggle").click();
      await expect(page.getByTestId("library-pane")).toHaveCount(0);
      await expect(page.getByTestId("inspector-pane")).toHaveCount(0);
      await expect(page.getByTestId("runtime-banner")).toHaveCount(0);

      await page.getByTestId("layout-settings-focus-toggle").click();
      await expect(page.getByTestId("library-pane")).toHaveCount(0);
      await expect(page.getByTestId("inspector-pane")).toBeVisible();

      await page.getByTestId("layout-settings-reset").click();
      await expect(page.getByTestId("layout-preset-current")).toContainText("平衡工作台");
      await expect(page.getByTestId("layout-pref-showFilmstrip")).toBeChecked();
      await expect(page.getByTestId("layout-pref-showActivityPanel")).toBeChecked();
      await expect(page.getByTestId("workbench-filmstrip")).toBeVisible();
      await expect(page.getByTestId("activity-section")).toBeVisible();
      await expect(page.getByTestId("library-pane")).toBeVisible();
      await expect(page.getByTestId("inspector-tab-adjust")).toHaveClass(/is-active/);
      await page.getByTestId("layout-settings-dialog").getByRole("button", { name: "关闭" }).click();
    } finally {
      stopServer(frontend);
      stopServer(backend);
    }
  });

  test("keeps pane geometry coherent across layout toggles and focus mode", async ({ page }) => {
    const sampleDir = createTempImageDir("photo-calibrator-layout-geometry-");
    const one = `${sampleDir}/geometry-a.png`;
    makeImage(one, [168, 126, 96]);

    const { backend, frontend, frontendUrl } = await startServers();
    try {
      await page.setViewportSize({ width: 1366, height: 840 });
      await stubWorkbenchBaseRoutes(page);
      await page.goto(frontendUrl);
      await page.getByTestId("topbar-file-input").setInputFiles([one]);

      const topbar = page.getByTestId("workbench-topbar");
      const layout = page.getByTestId("workbench-layout");
      const libraryPane = page.getByTestId("library-pane");
      const viewerPane = page.getByTestId("viewer-pane");
      const inspectorPane = page.getByTestId("inspector-pane");
      const stageShell = page.getByTestId("viewer-stage-shell");
      const filmstripPane = page.getByTestId("filmstrip-pane");

      await expect(libraryPane).toBeVisible();
      await expect(viewerPane).toBeVisible();
      await expect(inspectorPane).toBeVisible();
      await expect(filmstripPane).toBeVisible();

      const topbarBox = await getBox(topbar, "topbar");
      const layoutBox = await getBox(layout, "layout");
      const libraryBox = await getBox(libraryPane, "library pane");
      const viewerBox = await getBox(viewerPane, "viewer pane");
      const inspectorBox = await getBox(inspectorPane, "inspector pane");
      const stageBox = await getBox(stageShell, "viewer stage");
      const filmstripBox = await getBox(filmstripPane, "filmstrip pane");

      expect(layoutBox.y).toBeGreaterThan(topbarBox.y + topbarBox.height - 1);
      expect(libraryBox.x).toBeLessThan(viewerBox.x);
      expect(viewerBox.x + viewerBox.width).toBeLessThan(inspectorBox.x + 1);
      expect(Math.abs(filmstripBox.x - viewerBox.x)).toBeLessThan(4);
      expect(Math.abs(filmstripBox.width - viewerBox.width)).toBeLessThan(8);
      expect(filmstripBox.y).toBeGreaterThan(viewerBox.y + 120);
      expect(stageBox.width).toBeGreaterThan(300);
      expect(stageBox.height).toBeGreaterThan(200);

      const initialViewerWidth = viewerBox.width;
      const initialStageHeight = stageBox.height;
      const initialFilmstripHeight = filmstripBox.height;

      await dragHandle(page, page.getByTestId("workbench-left-resize-handle"), 80, 0);
      const widenedLibraryBox = await getBox(libraryPane, "widened library pane");
      expect(widenedLibraryBox.width).toBeGreaterThan(libraryBox.width + 40);

      await dragHandle(page, page.getByTestId("viewer-stack-resize-handle"), 0, 40);
      const resizedFilmstripBox = await getBox(filmstripPane, "resized filmstrip pane");
      expect(resizedFilmstripBox.height).toBeLessThan(initialFilmstripHeight - 20);

      await page.getByTestId("layout-settings-button").click();
      await page.getByTestId("layout-preset-review-card").click();
      await expect(page.getByTestId("library-pane")).toBeVisible();
      await expect(page.getByTestId("inspector-pane")).toHaveCount(0);
      await page.getByTestId("layout-preset-balanced-card").click();
      await page.getByTestId("layout-settings-dialog").getByRole("button", { name: "关闭" }).click();

      const restoredLibraryBox = await getBox(libraryPane, "restored library pane");
      const restoredFilmstripBox = await getBox(filmstripPane, "restored filmstrip pane");
      expect(restoredLibraryBox.width).toBeGreaterThan(widenedLibraryBox.width - 8);
      expect(restoredFilmstripBox.height).toBeLessThanOrEqual(initialFilmstripHeight);
      expect(restoredFilmstripBox.height).toBeLessThan(resizedFilmstripBox.height + 8);

      await page.getByTestId("toggle-library-pane").click();
      await expect(libraryPane).toHaveCount(0);
      const viewerWithoutLibrary = await getBox(viewerPane, "viewer pane without library");
      expect(viewerWithoutLibrary.width).toBeGreaterThan(initialViewerWidth + 40);

      await page.getByTestId("toggle-inspector-pane").click();
      await expect(inspectorPane).toHaveCount(0);
      const viewerOnlyBox = await getBox(viewerPane, "viewer pane without side panes");
      expect(viewerOnlyBox.width).toBeGreaterThan(viewerWithoutLibrary.width + 80);

      await page.getByTestId("toggle-filmstrip-pane").click();
      await expect(filmstripPane).toHaveCount(0);
      const expandedStageBox = await getBox(stageShell, "expanded viewer stage");
      expect(expandedStageBox.height).toBeGreaterThan(initialStageHeight + 40);

      await page.getByTestId("toggle-viewer-focus").click();
      await expect(page.getByTestId("runtime-banner")).toHaveCount(0);
      const focusViewerBox = await getBox(viewerPane, "focus viewer pane");
      const focusLayoutBox = await getBox(layout, "focus layout");
      expect(focusViewerBox.width).toBeGreaterThan(focusLayoutBox.width * 0.9);
      expect(focusViewerBox.height).toBeGreaterThan(focusLayoutBox.height * 0.9);
      await expect(page.getByTestId("focus-overlay-toolbar")).toBeVisible();
      await expect(page.getByTestId("focus-context-hud")).toBeVisible();
      await expect(page.getByTestId("focus-action-dock")).toBeVisible();
    } finally {
      stopServer(frontend);
      stopServer(backend);
      removeTempDir(sampleDir);
    }
  });
});
