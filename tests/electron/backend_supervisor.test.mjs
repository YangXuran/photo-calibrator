import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { BackendSupervisor } from "../../frontend/electron/backendSupervisor.mjs";

function availablePortServer() {
  return {
    unref() {},
    once() {},
    listen(_port, _host, callback) { callback(); },
    close(callback) { callback(); },
  };
}

function fakeChild(pid = 4321) {
  const child = new EventEmitter();
  child.pid = pid;
  child.killed = false;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = (signal) => {
    child.killed = true;
    queueMicrotask(() => child.emit("exit", 0, signal));
    return true;
  };
  return child;
}

test("uses a healthy configured backend without spawning a child", async () => {
  let spawnCalls = 0;
  const supervisor = new BackendSupervisor({
    configuredUrl: "http://127.0.0.1:9999/",
    fetchFn: async () => ({ ok: true, json: async () => ({ ok: true, service: "photo-calibrator" }) }),
    spawnProcess: () => { spawnCalls += 1; },
  });

  assert.equal(await supervisor.start(), "http://127.0.0.1:9999");
  assert.deepEqual(supervisor.snapshot(), {
    status: "ready",
    ownership: "external",
    url: "http://127.0.0.1:9999",
    pid: null,
    lastError: null,
  });
  assert.equal(spawnCalls, 0);
});

test("spawns and supervises a managed backend on an available port", async () => {
  const child = fakeChild();
  let spawnArgs;
  const states = [];
  const supervisor = new BackendSupervisor({
    host: "127.0.0.1",
    startPort: 8766,
    pythonPath: "python3",
    args: ["-m", "photo_calibrator.backend.simple_server"],
    cwd: "/tmp/project",
    env: { PYTHONPATH: "src" },
    createNetServer: availablePortServer,
    spawnProcess: (...args) => {
      spawnArgs = args;
      return child;
    },
    fetchFn: async () => ({ ok: true, json: async () => ({ ok: true, service: "photo-calibrator" }) }),
  });
  supervisor.subscribe((state) => states.push(state.status));

  assert.equal(await supervisor.start(), "http://127.0.0.1:8766");
  assert.equal(supervisor.snapshot().status, "ready");
  assert.equal(supervisor.snapshot().ownership, "managed");
  assert.equal(supervisor.snapshot().pid, 4321);
  assert.deepEqual(spawnArgs[1], [
    "-m",
    "photo_calibrator.backend.simple_server",
    "--port",
    "8766",
  ]);
  assert.ok(states.includes("starting"));
  assert.equal(states.at(-1), "ready");

  await supervisor.stop();
  assert.equal(child.killed, true);
  assert.equal(supervisor.snapshot().status, "stopped");
});

test("publishes a failed state when a managed backend exits", async () => {
  const child = fakeChild();
  const supervisor = new BackendSupervisor({
    startPort: 8766,
    pythonPath: "python3",
    createNetServer: availablePortServer,
    spawnProcess: () => child,
    fetchFn: async () => ({ ok: true, json: async () => ({ ok: true, service: "photo-calibrator" }) }),
  });

  await supervisor.start();
  child.emit("exit", 7, null);

  assert.equal(supervisor.snapshot().status, "failed");
  assert.match(supervisor.snapshot().lastError, /code 7/);
  assert.equal(supervisor.snapshot().pid, null);
});

test("publishes a failed state when spawning throws synchronously", async () => {
  const supervisor = new BackendSupervisor({
    startPort: 8766,
    pythonPath: "missing-python",
    createNetServer: availablePortServer,
    spawnProcess: () => { throw new Error("spawn failed"); },
  });

  await assert.rejects(supervisor.start(), /spawn failed/);
  assert.equal(supervisor.snapshot().status, "failed");
  assert.equal(supervisor.snapshot().ownership, "managed");
  assert.match(supervisor.snapshot().lastError, /spawn failed/);
});
