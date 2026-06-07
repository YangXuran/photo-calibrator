import type { WorkbenchController } from "../hooks/useWorkbench";
import { ViewerCompareControls } from "./ViewerCompareControls";
import { ViewerFocusToolbarBlock } from "./ViewerFocusToolbarBlock";
import { getViewerCompareLabel, getViewerZoomLabel } from "./viewerLabels";
import { ViewerStageToolbar, type ViewerStageToolbarWorkbench } from "./ViewerStageToolbar";
import type { CompareMode } from "../types";

type ViewerFocusToolbarProps = {
  workbench: Pick<WorkbenchController, "compareMode" | "setCompareMode" | "setSplitPosition" | "splitPosition" | "toggleViewerFocusMode"> & ViewerStageToolbarWorkbench;
  compareTone?: "default" | "primary" | "muted";
  zoomTone?: "default" | "primary" | "muted";
  visibleCompareModes?: CompareMode[];
  visibleZoomPresets?: Array<"fit" | "fill">;
  showZoomStepper?: boolean;
  showZoomReset?: boolean;
};

export function ViewerFocusToolbar({
  workbench,
  compareTone = "primary",
  zoomTone = "default",
  visibleCompareModes,
  visibleZoomPresets,
  showZoomStepper = true,
  showZoomReset = true,
}: ViewerFocusToolbarProps) {
  const compareLabel = getViewerCompareLabel(workbench.compareMode, workbench.splitPosition);
  const zoomLabel = getViewerZoomLabel(workbench.viewerZoomMode, workbench.viewerZoomScale, "focus");

  return (
    <div className="pc-focus-overlay-tools">
      <ViewerFocusToolbarBlock label="Compare" testId="focus-compare-block" tone={compareTone === "muted" ? "tertiary" : compareTone === "default" ? "secondary" : "primary"} value={compareLabel} valueTestId="focus-compare-value">
        <ViewerCompareControls
          compact
          compareMode={workbench.compareMode}
          focusMode
          onChangeCompareMode={workbench.setCompareMode}
          onChangeSplitPosition={workbench.setSplitPosition}
          splitPosition={workbench.splitPosition}
          tone={compareTone}
          visibleModes={visibleCompareModes}
          wrapperClassName="pc-focus-compare-controls"
        />
      </ViewerFocusToolbarBlock>
      <ViewerFocusToolbarBlock label="Zoom" testId="focus-zoom-block" tone={zoomTone === "muted" ? "tertiary" : zoomTone === "default" ? "secondary" : "primary"} value={zoomLabel} valueTestId="focus-zoom-value">
        <ViewerStageToolbar compact focusMode showReset={showZoomReset} showStepper={showZoomStepper} tone={zoomTone} visiblePresets={visibleZoomPresets} workbench={workbench} />
      </ViewerFocusToolbarBlock>
      <ViewerFocusToolbarBlock label="Workspace" testId="focus-exit-block" tone="tertiary" value="Focus">
        <button className="pc-stage-action-button is-focus-exit" onClick={workbench.toggleViewerFocusMode} type="button">
          Exit Focus
        </button>
      </ViewerFocusToolbarBlock>
    </div>
  );
}
