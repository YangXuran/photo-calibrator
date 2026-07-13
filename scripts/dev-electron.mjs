import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { shouldSuppressManagedStderr } from "./logFilters.mjs";

const repoRoot = new URL("..", import.meta.url);
const frontendDir = new URL("../frontend/", import.meta.url);
const requestedViteUrl = process.env.PHOTO_CALIBRATOR_RENDERER_URL || "http://127.0.0.1:5173";
const electronBin = new URL(
  process.platform === "win32" ? "../frontend/node_modules/.bin/electron.cmd" : "../frontend/node_modules/.bin/electron",
  import.meta.url,
);
const electronBinPath = fileURLToPath(electronBin);

const isWin = process.platform === "win32";
const npmCommand = isWin ? "npm.cmd" : "npm";
const children = new Set();
let shuttingDown = false;

function spawnManaged(label, command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, ...options.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  children.add(child);
  child.stdout?.on("data", (chunk) => {
    const text = chunk.toString();
    options.onStdout?.(text);
    process.stdout.write(`[${label}] ${text}`);
  });
  child.stderr?.on("data", (chunk) => {
    const text = chunk.toString();
    if (!shouldSuppressManagedStderr(label, text)) {
      process.stderr.write(`[${label}:err] ${text}`);
    }
  });
  child.on("exit", (code, signal) => {
    children.delete(child);
    if (!shuttingDown && label === "electron") {
      shutdown(code ?? (signal ? 1 : 0));
    }
  });
  child.on("error", (error) => {
    console.error(`[${label}] failed to start: ${error.message}`);
    shutdown(1);
  });
  return child;
}

async function waitForUrl(url, timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await delay(250);
  }
  throw new Error(`Server did not become ready at ${url} within ${timeoutMs}ms`);
}

function waitForViteUrl(timeoutMs = 30000) {
  let resolveUrl;
  let rejectUrl;
  const promise = new Promise((resolve, reject) => {
    resolveUrl = resolve;
    rejectUrl = reject;
  });
  const timer = setTimeout(() => {
    rejectUrl(new Error(`Vite did not print a local URL within ${timeoutMs}ms`));
  }, timeoutMs);
  timer.unref();

  return {
    promise: promise.finally(() => clearTimeout(timer)),
    onStdout(text) {
      const stripped = text.replace(/\u001b\[[0-9;]*m/g, "");
      const match = stripped.match(/Local:\s+(http:\/\/127\.0\.0\.1:\d+\/?)/);
      if (match) resolveUrl(match[1].replace(/\/$/, ""));
    },
  };
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  setTimeout(() => {
    for (const child of children) {
      if (!child.killed) child.kill("SIGKILL");
    }
    process.exit(exitCode);
  }, 1500).unref();
}

process.on("SIGINT", () => shutdown(130));
process.on("SIGTERM", () => shutdown(143));

console.log("Starting Photo Calibrator dev app...");
const viteReady = waitForViteUrl();
spawnManaged("vite", npmCommand, ["run", "dev", "--", "--host", "127.0.0.1"], {
  cwd: frontendDir,
  onStdout: viteReady.onStdout,
});

try {
  const viteUrl = await viteReady.promise;
  await waitForUrl(viteUrl);
  if (!existsSync(electronBinPath)) {
    throw new Error("Electron binary is missing. Run `npm install` in frontend first.");
  }
  spawnManaged("electron", electronBinPath, ["electron/main.mjs"], {
    cwd: frontendDir,
    env: {
      PHOTO_CALIBRATOR_RENDERER_URL: viteUrl || requestedViteUrl,
      PHOTO_CALIBRATOR_RENDERER_MODE: "dev",
      ...(process.env.PHOTO_CALIBRATOR_API_BASE_URL
        ? { PHOTO_CALIBRATOR_API_BASE_URL: process.env.PHOTO_CALIBRATOR_API_BASE_URL }
        : {}),
    },
  });
} catch (error) {
  console.error(error.message);
  shutdown(1);
}
