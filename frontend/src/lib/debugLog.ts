const enabled = isDebugLogEnabled();

const buffer: { ts: number; tag: string; detail?: unknown }[] = [];

function isDebugLogEnabled() {
  if (typeof window === "undefined") return false;
  const explicitFlag = (window as any).__PHOTO_CALIBRATOR_DEBUG__ === true;
  const storageFlag = readFlag("photo-calibrator:debug");
  return explicitFlag || storageFlag;
}

function readFlag(key: string) {
  try {
    return window.localStorage?.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function debugLog(tag: string, detail?: unknown) {
  if (!enabled) return;
  const entry = { ts: performance.now(), tag, detail };
  buffer.push(entry);
  if (buffer.length > 2000) buffer.shift();
  const dt = buffer.length > 1 ? `+${Math.round(entry.ts - buffer[buffer.length - 2]!.ts)}ms` : "";
  console.log("[DEBUG]", dt, tag, detail ?? "");
}

export function debugDump() {
  if (!enabled) return "debug disabled";
  return buffer.map(e => `  ${e.ts.toFixed(0)}ms ${e.tag}`).join("\n");
}

export function debugClear() { buffer.length = 0; }

if (enabled) {
  (window as any).__debugDump = debugDump;
  (window as any).__debugClear = debugClear;
}
