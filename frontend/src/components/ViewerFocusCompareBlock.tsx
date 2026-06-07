import type { CompareMode } from "../types";

type ViewerFocusCompareBlockProps = {
  compareMode: CompareMode;
  splitPosition: number;
  onChangeCompareMode: (mode: CompareMode) => void;
  onChangeSplitPosition: (value: number) => void;
};

export function ViewerFocusCompareBlock({
  compareMode,
  splitPosition,
  onChangeCompareMode,
  onChangeSplitPosition,
}: ViewerFocusCompareBlockProps) {
  return (
    <div className="pc-focus-compare-controls">
      <div className="pc-segmented is-focus-overlay is-compact" data-testid="focus-compare-mode-group">
        <button className={compareMode === "side-by-side" ? "is-active" : ""} data-testid="compare-mode-dual" onClick={() => onChangeCompareMode("side-by-side")} type="button">
          双栏
        </button>
        <button className={compareMode === "split" ? "is-active" : ""} data-testid="compare-mode-split" onClick={() => onChangeCompareMode("split")} type="button">
          滑动对比
        </button>
        <button className={compareMode === "calibrated-only" ? "is-active" : ""} data-testid="compare-mode-calibrated" onClick={() => onChangeCompareMode("calibrated-only")} type="button">
          仅校准
        </button>
      </div>
      {compareMode === "split" ? (
        <label className="pc-inline-field is-focus-overlay" data-testid="split-position-field">
          <span>分割</span>
          <input data-testid="split-position-input" max={90} min={10} onChange={(event) => onChangeSplitPosition(Number(event.target.value))} type="range" value={splitPosition} />
        </label>
      ) : null}
    </div>
  );
}
