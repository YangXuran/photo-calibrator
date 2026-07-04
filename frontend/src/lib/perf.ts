const TRACE_ENABLED = isPerfTraceEnabled();
const traces: { tag: string; ms: number; delta: number }[] = [];
let baseTs = 0;

function isPerfTraceEnabled() {
  if (typeof window === "undefined") return false;
  const explicitFlag = (window as any).__PHOTO_CALIBRATOR_PERF__ === true;
  const storageFlag = readFlag("photo-calibrator:perf");
  return explicitFlag || storageFlag;
}

function readFlag(key: string) {
  try {
    return window.localStorage?.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function perfReset(tag: string) {
  if (!TRACE_ENABLED) return;
  traces.length = 0;
  baseTs = performance.now();
  perfMark(tag);
}

export function perfMark(tag: string) {
  if (!TRACE_ENABLED) return;
  const now = performance.now();
  const delta = traces.length > 0 ? now - traces[traces.length - 1]!.ms : 0;
  traces.push({ tag, ms: Math.round(now - baseTs), delta: Math.round(delta) });
}

export function perfDump() {
  if (!TRACE_ENABLED || traces.length === 0) return;
  const total = traces[traces.length - 1]!.ms;
  const steps = traces.map(t => `  +${t.delta}ms (${t.ms}ms) ${t.tag}`).join("\n");
  console.log(`[Perf] total=${total}ms\n${steps}`);
}
