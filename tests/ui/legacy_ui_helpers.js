const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

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
  const result = spawnSync("python3", ["-c", script], {
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

function startLegacyServer(port) {
  return spawn("python3", ["-m", "photo_calibrator.backend.simple_server", "--port", String(port), "--web-root", "web"], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONPATH: path.join(process.cwd(), "src") },
    stdio: "pipe",
  });
}

function stopServer(server) {
  if (!server || server.killed) return;
  server.kill();
}

module.exports = {
  makeImage,
  startLegacyServer,
  stopServer,
  waitForServer,
};
