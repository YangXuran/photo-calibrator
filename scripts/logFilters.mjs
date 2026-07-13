const SUPPRESSED_ELECTRON_STDERR = [
  "error messaging the mach port for IMKCFRunLoopWakeUpReliable",
];

export function shouldSuppressManagedStderr(label, text) {
  if (label !== "electron") return false;
  return SUPPRESSED_ELECTRON_STDERR.some((message) => text.includes(message));
}
