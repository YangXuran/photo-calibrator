const { test, expect } = require("@playwright/test");
const { startLegacyServer, stopServer, waitForServer } = require("./legacy_ui_helpers");

test("renders plugin list and AI evaluator list in library sidebar", async ({ page }) => {
  const port = 8877;
  const url = `http://127.0.0.1:${port}`;
  await page.setViewportSize({ width: 1440, height: 900 });

  const server = startLegacyServer(port);

  try {
    await waitForServer(url);

    await page.goto(url);

    await expect(page.getByTestId("plugin-list")).toBeVisible();
    await expect(page.getByTestId("plugin-list-empty")).not.toBeAttached();
    await expect(page.getByTestId("plugin-item-builtin-noopanalyzer")).toBeVisible();
    await expect(page.getByTestId("plugin-item-builtin-noopcalibrator")).toBeVisible();
    await expect(page.getByTestId("plugin-item-builtin-noopaievaluator")).toBeVisible();
    await expect(page.getByTestId("plugin-item-builtin-noopfilmscandetector")).toBeVisible();
    await expect(page.getByTestId("library-resize-handle")).toBeVisible();
    await expect(page.getByTestId("inspector-resize-handle")).toBeVisible();

    await expect(page.getByTestId("ai-evaluator-list")).toBeVisible();
    await expect(page.getByTestId("ai-evaluator-list-empty")).not.toBeAttached();
    await expect(page.getByTestId("ai-evaluator-builtin-noopaievaluator")).toBeVisible();
    await expect(page.getByTestId("ai-evaluator-__default__")).toBeVisible();

    const before = await page.locator(".inspector").boundingBox();
    const handle = page.getByTestId("inspector-resize-handle");
    const box = await handle.boundingBox();
    if (!before || !box) throw new Error("Resize handle not measurable");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 120, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    const after = await page.locator(".inspector").boundingBox();
    if (!after) throw new Error("Inspector not measurable after resize");
    expect(Math.abs(after.width - before.width)).toBeGreaterThan(40);
  } finally {
    stopServer(server);
  }
});

test("shows not-available placeholders when plugin routes return 404", async ({ page }) => {
  const port = 8878;
  const url = `http://127.0.0.1:${port}`;

  const server = startLegacyServer(port);

  try {
    await waitForServer(url);
    await page.route("**/api/plugins", (route) => route.fulfill({ status: 404, body: "missing" }));
    await page.route("**/api/ai-evaluators", (route) => route.fulfill({ status: 404, body: "missing" }));

    await page.goto(url);

    await expect(page.getByTestId("plugin-list-not-available")).toBeVisible();
    await expect(page.getByTestId("ai-evaluator-list-not-available")).toBeVisible();
  } finally {
    stopServer(server);
  }
});
