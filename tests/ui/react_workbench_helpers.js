const { expect } = require("@playwright/test");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const TINY_PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9sZqDbgAAAAASUVORK5CYII=";
const VENV_PYTHON = path.join(process.cwd(), ".venv", "bin", "python");

function pythonCommand() {
  return fs.existsSync(VENV_PYTHON) ? VENV_PYTHON : "python3";
}

function makeImage(filePath, rgb) {
  const script = `
import cv2
import numpy as np
path = r"${filePath}"
if path.lower().endswith((".tif", ".tiff")):
    img = np.zeros((80, 100, 3), dtype=np.uint16)
    img[:, :] = (${rgb[2]} * 256, ${rgb[1]} * 256, ${rgb[0]} * 256)
else:
    img = np.full((220, 320, 3), 245, dtype=np.uint8)
    cv2.rectangle(img, (35, 25), (285, 195), (12, 12, 12), thickness=10)
    img[50:180, 55:265] = (178, 132, 104)
    img = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
cv2.imwrite(path, img)
`;
  const result = spawnSync(pythonCommand(), ["-c", script], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr);
  }
}

async function waitForUrl(url, predicate) {
  for (let i = 0; i < 80; i += 1) {
    try {
      const response = await fetch(url);
      if (predicate(response)) return;
    } catch (_) {
      // keep waiting while the dev server or backend comes up
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function fulfillJsonAfterDelay(route, payload, delay = 300) {
  await new Promise((resolve) => setTimeout(resolve, delay));
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(payload),
  });
}

function startBackend(port) {
  return spawn(pythonCommand(), ["-m", "photo_calibrator.backend.simple_server", "--port", String(port)], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONPATH: path.join(process.cwd(), "src") },
    stdio: "pipe",
  });
}

function startFrontend(port, backendPort) {
  return spawn("npm", ["--prefix", "frontend", "run", "dev:web", "--", "--host", "127.0.0.1", "--port", String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      VITE_DEV_API_PROXY_TARGET: `http://127.0.0.1:${backendPort}`,
    },
    stdio: "pipe",
  });
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        if (!port) {
          reject(new Error("Could not allocate free port"));
          return;
        }
        resolve(port);
      });
    });
  });
}

async function startServers() {
  const backendPort = await getFreePort();
  const frontendPort = await getFreePort();
  const backend = startBackend(backendPort);
  const backendUrl = `http://127.0.0.1:${backendPort}`;
  await waitForUrl(`${backendUrl}/api/health`, (response) => response.ok);
  const frontend = startFrontend(frontendPort, backendPort);
  const frontendUrl = `http://127.0.0.1:${frontendPort}`;
  await waitForUrl(frontendUrl, (response) => response.ok);
  return { backend, backendUrl, frontend, frontendUrl };
}

function stopServer(server) {
  if (!server || server.killed) return;
  server.kill("SIGTERM");
}

async function expectInViewport(page, locator, name) {
  await expect(locator, `${name} should be visible`).toBeVisible();
  const viewport = page.viewportSize();
  const box = await locator.boundingBox();
  if (!viewport || !box) {
    throw new Error(`${name} is not measurable`);
  }
  expect(box.y, `${name} should start inside the viewport`).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height, `${name} should remain inside the viewport`).toBeLessThanOrEqual(viewport.height);
}

async function getBox(locator, name) {
  const box = await locator.boundingBox();
  if (!box) {
  throw new Error(`${name} is not measurable`);
  }
  return box;
}

async function stubWorkbenchBaseRoutes(page) {
  await page.route("**/api/health", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });
  await page.route("**/api/capabilities?*", async (route) => {
    await fulfillJsonAfterDelay(route, {
      accelerator: {
        backend: "cpu-opencv",
        requested_backend: "auto",
        gpu_ops: [],
        cpu_fallback_ops: ["resize", "rgb-lab", "lab-rgb", "curve-lut", "matrix", "3d-lut"],
        opencl_available: false,
        opencl_enabled: false,
      },
    }, 80);
  });
  await page.route("**/api/capabilities", async (route) => {
    await fulfillJsonAfterDelay(route, {
      accelerator: {
        backend: "cpu-opencv",
        requested_backend: "auto",
        gpu_ops: [],
        cpu_fallback_ops: ["resize", "rgb-lab", "lab-rgb", "curve-lut", "matrix", "3d-lut"],
        opencl_available: false,
        opencl_enabled: false,
      },
    }, 80);
  });
  await page.route("**/api/plugins", async (route) => {
    await fulfillJsonAfterDelay(route, { plugins: [] }, 80);
  });
  await page.route("**/api/ai-evaluators", async (route) => {
    await fulfillJsonAfterDelay(
      route,
      {
        evaluators: [
          {
            id: "builtin.noopaievaluator",
            name: "Noop AI Evaluator",
            source: "plugin",
            supports_network: false,
          },
        ],
      },
      80,
    );
  });
  await page.route("**/api/session/list", async (route) => {
    await fulfillJsonAfterDelay(route, { sessions: [] }, 80);
  });
  await page.route("**/api/calibrate", async (route) => {
    const body = route.request().postDataJSON();
    const fileName = body.file_name || "imported-image.png";
    const sessionId = `sess:${fileName}`;
    await fulfillJsonAfterDelay(route, {
      session_id: sessionId,
      original_preview: TINY_PNG_DATA_URL,
      calibrated_image: TINY_PNG_DATA_URL,
      reduction_pct: 12,
      input: {
        direction: "warm",
        lab: {
          strength: 82,
          a_mean: 0.4,
          b_star_mean: -0.3,
        },
        zones: {
          global: { a_mean: 0.4, b_mean: -0.3, pixels: 70400 },
        },
      },
      output: {
        lab: {
          strength: 61,
          a_mean: 0.1,
          b_star_mean: -0.1,
        },
      },
      processing: {
        analysis_width: 320,
        analysis_height: 220,
        original_width: 320,
        original_height: 220,
        preview_source: "cache",
        color_space: "sRGB",
        data_range: [0, 255],
        accelerator_backend: "cpu-opencv",
        accelerator_requested: "auto",
      },
    });
  });
  await page.route("**/api/film-scan", async (route) => {
    const body = route.request().postDataJSON();
    await fulfillJsonAfterDelay(route, {
      session_id: body.session_id || "sess:film-scan",
      crop_rect: { left: 0.12, top: 0.1, width: 0.76, height: 0.78 },
      film_scan: {
        angle_deg: 0.2,
        confidence: 0.91,
        border_type: "black",
        film_format: "35mm",
        diagnosis: ["detected"],
      },
      processing: {
        film_scan_source: "stub",
        analysis_width: 320,
        analysis_height: 220,
      },
    });
  });
}

function createTempImageDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function removeTempDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

async function stubCompactWorkflowRoutes(page) {
  await stubWorkbenchBaseRoutes(page);
  await page.route("**/api/export", async (route) => {
    await fulfillJsonAfterDelay(route, {
      ok: true,
      path: "/tmp/photo-calibrator-ui-export.jpeg",
      format: "jpeg",
      size: 24576,
      elapsed_ms: 48.6,
      export_settings: {
        color_space: "sRGB",
        bit_depth: 8,
        metadata_keys: ["camera_model", "lens_model"],
        icc_embedded: true,
      },
    });
  });
  await page.route("**/api/document/render", async (route) => {
    const body = route.request().postDataJSON();
    await fulfillJsonAfterDelay(route, {
      ok: true,
      session_id: body.session_id,
      calibrated_image: TINY_PNG_DATA_URL,
      document: {
        source: "session",
        operations: [
          { name: "calibration", replayable: true, params: { mode: "balanced", strength: 82 } },
          { name: "crop", replayable: false, params: { source: "film_scan" } },
        ],
        replayable_operations: [{ name: "calibration" }],
      },
      output: {
        lab: {
          strength: 82,
          a_mean: 0.4,
          b_star_mean: -0.3,
        },
      },
      processing: {
        analysis_width: 320,
        analysis_height: 220,
        preview_source: "cache",
        document_replayable_ops: 1,
      },
    });
  });
  await page.route("**/api/session/save", async (route) => {
    const body = route.request().postDataJSON();
    await fulfillJsonAfterDelay(route, {
      ok: true,
      path: body.path,
      session_id: body.session_id,
      size: 8192,
    });
  });
  await page.route("**/api/ai-evaluate", async (route) => {
    const body = route.request().postDataJSON();
    await fulfillJsonAfterDelay(route, {
      ok: true,
      session_id: body.session_id,
      evaluator_name: body.evaluator_name,
      elapsed_ms: 12.5,
      request: {
        provider: {
          type: "mock",
        },
      },
      evaluation: {
        summary: "Mock AI review completed.",
        rationale: "UI regression stub",
        scores: [{ name: "overall", value: 0.82 }],
        issues: [{ type: "white_balance", severity: "medium", message: "Highlights still trend warm." }],
        suggestions: [{ operation: "lab_shift", confidence: 0.73, params: { b: -1.2 } }],
      },
    });
  });
}

module.exports = {
  TINY_PNG_DATA_URL,
  createTempImageDir,
  expectInViewport,
  fulfillJsonAfterDelay,
  getBox,
  getFreePort,
  makeImage,
  removeTempDir,
  startBackend,
  startServers,
  stopServer,
  stubWorkbenchBaseRoutes,
  stubCompactWorkflowRoutes,
  waitForUrl,
};
