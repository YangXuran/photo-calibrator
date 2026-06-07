import type { CompareMode } from "../types";

type ViewerCompareControlsProps = {
  compareMode: CompareMode;
  visibleModes?: CompareMode[];
  focusMode?: boolean;
  compact?: boolean;
  tone?: "default" | "primary" | "muted";
  onChangeCompareMode: (mode: CompareMode) => void;
  onChangeSplitPosition: (value: number) => void;
  splitPosition: number;
  wrapperClassName?: string;
};

export function ViewerCompareControls({
  compareMode,
  visibleModes = ["side-by-side", "split", "calibrated-only"],
  focusMode = false,
  compact = false,
  tone = "default",
  onChangeCompareMode,
  onChangeSplitPosition,
  splitPosition,
  wrapperClassName,
}: ViewerCompareControlsProps) {
  const showDual = visibleModes.includes("side-by-side");
  const showSplit = visibleModes.includes("split");
  const showCalibrated = visibleModes.includes("calibrated-only");

  return (
    <div
      className={`pc-viewer-control-block pc-viewer-control-block-${tone} ${wrapperClassName ?? ""}`.trim()}
      data-testid={focusMode ? "focus-compare-controls" : "viewer-compare-controls"}
    >
      <div className={`pc-segmented ${focusMode ? "is-focus-overlay" : ""} ${compact ? "is-compact" : ""}`.trim()} data-testid={focusMode ? "focus-compare-mode-group" : "compare-mode-group"}>
        {showDual ? (
          <button className={compareMode === "side-by-side" ? "is-active" : ""} data-testid="compare-mode-dual" onClick={() => onChangeCompareMode("side-by-side")} type="button">
            双栏
          </button>
        ) : null}
        {showSplit ? (
          <button className={compareMode === "split" ? "is-active" : ""} data-testid="compare-mode-split" onClick={() => onChangeCompareMode("split")} type="button">
            滑动对比
          </button>
        ) : null}
        {showCalibrated ? (
          <button className={compareMode === "calibrated-only" ? "is-active" : ""} data-testid="compare-mode-calibrated" onClick={() => onChangeCompareMode("calibrated-only")} type="button">
            仅校准
          </button>
        ) : null}
      </div>
      {compareMode === "split" && showSplit ? (
        <label className={`pc-inline-field ${focusMode ? "is-focus-overlay" : ""}`.trim()} data-testid="split-position-field">
          <span>分割</span>
          <input data-testid="split-position-input" max={90} min={10} onChange={(event) => onChangeSplitPosition(Number(event.target.value))} type="range" value={splitPosition} />
        </label>
      ) : null}
    </div>
  );
}
