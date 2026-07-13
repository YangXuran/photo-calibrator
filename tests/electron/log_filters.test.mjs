import assert from "node:assert/strict";
import test from "node:test";

import { shouldSuppressManagedStderr } from "../../scripts/logFilters.mjs";

test("suppresses only the known macOS IMK Electron diagnostic", () => {
  assert.equal(
    shouldSuppressManagedStderr(
      "electron",
      "Electron[1:2] error messaging the mach port for IMKCFRunLoopWakeUpReliable",
    ),
    true,
  );
  assert.equal(
    shouldSuppressManagedStderr("backend", "error messaging the mach port for IMKCFRunLoopWakeUpReliable"),
    false,
  );
  assert.equal(shouldSuppressManagedStderr("electron", "renderer crashed"), false);
});
