import { spawn } from "node:child_process";
import { createServer } from "node:net";

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function normalizeBaseUrl(value) {
  return String(value || "").replace(/\/$/, "");
}

export class BackendSupervisor {
  constructor(options) {
    this.host = options.host || "127.0.0.1";
    this.startPort = Number(options.startPort || 8766);
    this.configuredUrl = normalizeBaseUrl(options.configuredUrl);
    this.pythonPath = options.pythonPath;
    this.args = [...(options.args || [])];
    this.cwd = options.cwd;
    this.env = { ...options.env };
    this.startupTimeoutMs = Number(options.startupTimeoutMs || 15000);
    this.externalTimeoutMs = Number(options.externalTimeoutMs || 1500);
    this.spawnProcess = options.spawnProcess || spawn;
    this.createNetServer = options.createNetServer || createServer;
    this.fetchFn = options.fetchFn || fetch;
    this.expectedService = options.expectedService || "photo-calibrator";
    this.log = options.log || console;
    this.process = null;
    this.listeners = new Set();
    this.stopping = false;
    this.startPromise = null;
    this.state = {
      status: "idle",
      ownership: "none",
      url: this.configuredUrl,
      pid: null,
      lastError: null,
    };
  }

  snapshot() {
    return { ...this.state };
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start() {
    if (this.state.status === "ready") return this.state.url;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this._start().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  async _start() {
    if (this.configuredUrl) {
      this._setState({
        status: "starting",
        ownership: "external",
        url: this.configuredUrl,
        pid: null,
        lastError: null,
      });
      if (await this._waitForHealth(this.configuredUrl, this.externalTimeoutMs)) {
        this._setState({ status: "ready" });
        return this.configuredUrl;
      }
      const message = `Configured backend is unavailable at ${this.configuredUrl}`;
      this._setState({ status: "failed", lastError: message });
      throw new Error(message);
    }

    const port = await this._findAvailablePort(this.startPort);
    const url = `http://${this.host}:${port}`;
    this._setState({
      status: "starting",
      ownership: "managed",
      url,
      pid: null,
      lastError: null,
    });
    this.stopping = false;
    let child;
    try {
      child = this.spawnProcess(
        this.pythonPath,
        [...this.args, "--port", String(port)],
        { cwd: this.cwd, env: this.env, stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this._setState({ status: "failed", ownership: "managed", url, lastError: message });
      throw error;
    }
    this.process = child;
    this._setState({ pid: child.pid ?? null });
    child.stdout?.on("data", (chunk) => this.log.log(`[backend] ${chunk}`.trimEnd()));
    child.stderr?.on("data", (chunk) => this.log.error(`[backend:err] ${chunk}`.trimEnd()));
    child.on("error", (error) => this._handleProcessFailure(child, error));
    child.on("exit", (code, signal) => {
      if (this.stopping || child !== this.process) return;
      const detail = signal ? `signal ${signal}` : `code ${code}`;
      this._handleProcessFailure(child, new Error(`Backend exited with ${detail}`));
    });

    const ready = await this._waitForHealth(
      url,
      this.startupTimeoutMs,
      () => this.process === child,
    );
    if (!ready) {
      const message = this.state.lastError || `Backend startup timed out at ${url}`;
      await this.stop();
      this._setState({ status: "failed", ownership: "managed", url, lastError: message });
      throw new Error(message);
    }
    this._setState({ status: "ready", lastError: null });
    return url;
  }

  async restart() {
    await this.stop();
    await delay(100);
    return this.start();
  }

  async stop() {
    this.stopping = true;
    const child = this.process;
    this.process = null;
    if (child && !child.killed) child.kill("SIGTERM");
    this._setState({ status: "stopped", pid: null });
    await delay(25);
    this.stopping = false;
  }

  _handleProcessFailure(child, error) {
    if (child !== this.process) return;
    this.process = null;
    this._setState({
      status: "failed",
      pid: null,
      lastError: error instanceof Error ? error.message : String(error),
    });
  }

  _setState(patch) {
    this.state = { ...this.state, ...patch };
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  async _findAvailablePort(startPort) {
    for (let port = startPort; port < startPort + 20; port += 1) {
      if (await this._isPortAvailable(port)) return port;
    }
    throw new Error(`No available backend port in range ${startPort}-${startPort + 19}`);
  }

  _isPortAvailable(port) {
    return new Promise((resolve) => {
      const server = this.createNetServer();
      server.unref?.();
      server.once("error", () => resolve(false));
      server.listen(port, this.host, () => server.close(() => resolve(true)));
    });
  }

  async _waitForHealth(url, timeoutMs, shouldContinue = () => true) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs && shouldContinue()) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(800, timeoutMs));
      try {
        const response = await this.fetchFn(`${url}/api/health`, { signal: controller.signal });
        if (response.ok) {
          const payload = await response.json();
          if (payload?.ok === true && payload?.service === this.expectedService) return true;
        }
      } catch {
        // The backend is still starting or unavailable.
      } finally {
        clearTimeout(timer);
      }
      await delay(250);
    }
    return false;
  }
}
