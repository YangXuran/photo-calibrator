export type InteractivePreviewBackendTiming = {
  calibration_ms?: number;
  response_ms?: number;
};

export type InteractivePreviewTimingRecord = {
  requestId: number;
  fileId?: string;
  fileName?: string;
  sessionId?: string;
  fast: boolean;
  accepted: boolean;
  current: boolean;
  elapsedMs: number;
  backendCalibrationMs?: number;
  backendResponseMs?: number;
  mode: string;
  strength: number;
  previewSource?: string;
  analysisWidth?: number;
  analysisHeight?: number;
};

export type InteractivePreviewRunner = () => void;

type InteractivePreviewWindow = Window & {
  __PHOTO_CALIBRATOR_CALIBRATION_TIMINGS__?: InteractivePreviewTimingRecord[];
};

const CALIBRATION_TIMING_EVENT = "photo-calibrator:calibration-timing";
const CALIBRATION_TIMING_BUFFER_LIMIT = 80;

export class InteractivePreviewController {
  private inFlight = false;
  private latestGuard = "";
  private latestRequestId = 0;
  private lastAppliedRequestId = 0;
  private queuedRunner: InteractivePreviewRunner | null = null;

  static sessionRequired(input: { sourcePath?: string; sessionId?: string }): boolean {
    return Boolean(input.sourcePath && !input.sessionId);
  }

  static guard(parts: Array<string | number | boolean | undefined | null>): string {
    return parts.map((part) => String(part ?? "")).join("::");
  }

  reset(): void {
    this.inFlight = false;
    this.latestGuard = "";
    this.latestRequestId = 0;
    this.lastAppliedRequestId = 0;
    this.queuedRunner = null;
  }

  setGuard(guard: string): void {
    this.latestGuard = guard;
  }

  clearQueued(runner?: InteractivePreviewRunner): void {
    if (!runner || this.queuedRunner === runner) {
      this.queuedRunner = null;
    }
  }

  nextRequestId(): number {
    this.latestRequestId += 1;
    return this.latestRequestId;
  }

  evaluateFrame(input: { requestId: number; fast: boolean; guard: string }): { accepted: boolean; current: boolean } {
    const current = input.requestId === this.latestRequestId && input.guard === this.latestGuard;
    const interactiveFrame = input.fast
      && input.guard === this.latestGuard
      && input.requestId > this.lastAppliedRequestId;
    return {
      accepted: current || interactiveFrame,
      current,
    };
  }

  markApplied(requestId: number): void {
    this.lastAppliedRequestId = Math.max(this.lastAppliedRequestId, requestId);
  }

  schedule(input: { fast: boolean; run: () => Promise<void> }): InteractivePreviewRunner {
    const runner = () => this.start(input);
    if (input.fast && this.inFlight) {
      this.queuedRunner = runner;
    } else {
      runner();
    }
    return runner;
  }

  recordTiming(record: InteractivePreviewTimingRecord): void {
    if (typeof window === "undefined") return;
    const target = window as InteractivePreviewWindow;
    const records = target.__PHOTO_CALIBRATOR_CALIBRATION_TIMINGS__ ?? [];
    records.push(record);
    target.__PHOTO_CALIBRATOR_CALIBRATION_TIMINGS__ = records.slice(-CALIBRATION_TIMING_BUFFER_LIMIT);
    window.dispatchEvent(new CustomEvent(CALIBRATION_TIMING_EVENT, { detail: record }));
  }

  private start(input: { fast: boolean; run: () => Promise<void> }): void {
    const task = input.run();
    if (!input.fast) return;
    this.inFlight = true;
    void task.finally(() => {
      const queued = this.queuedRunner;
      if (queued) {
        this.queuedRunner = null;
        queued();
        return;
      }
      this.inFlight = false;
    });
  }
}
