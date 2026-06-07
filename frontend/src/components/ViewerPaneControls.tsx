import type { WorkbenchController } from "../hooks/useWorkbench";
import type { CompareMode } from "../types";
import { ViewerCompareControls } from "./ViewerCompareControls";
import { ViewerStageToolbar, type ViewerStageToolbarWorkbench } from "./ViewerStageToolbar";

type ViewerPaneControlsProps = {
  focusMode?: boolean;
  density?: "default" | "compact";
  emphasis?: "default" | "primary" | "muted";
  compareTone?: "default" | "primary" | "muted";
  zoomTone?: "default" | "primary" | "muted";
  showStageHint?: boolean;
  visibleCompareModes?: CompareMode[];
  visibleZoomPresets?: Array<"fit" | "fill">;
  showZoomStepper?: boolean;
  showZoomReset?: boolean;
  workbench: Pick<WorkbenchController, "compareMode" | "setCompareMode" | "setSplitPosition" | "splitPosition"> & ViewerStageToolbarWorkbench;
};

export function ViewerPaneControls({
  focusMode = false,
  density = "default",
  emphasis = "default",
  compareTone = "default",
  zoomTone = "default",
  showStageHint = true,
  visibleCompareModes,
  visibleZoomPresets,
  showZoomStepper = true,
  showZoomReset = true,
  workbench,
}: ViewerPaneControlsProps) {
  return (
    <div
      className={`pc-viewer-pane-controls pc-viewer-pane-controls-${density} pc-viewer-pane-controls-${emphasis}`}
      data-testid="viewer-pane-controls"
    >
      <ViewerCompareControls
        compareMode={workbench.compareMode}
        compact={density === "compact"}
        focusMode={focusMode}
        onChangeCompareMode={workbench.setCompareMode}
        onChangeSplitPosition={workbench.setSplitPosition}
        splitPosition={workbench.splitPosition}
        tone={compareTone}
        visibleModes={visibleCompareModes}
      />
      <ViewerStageToolbar
        compact={focusMode || density === "compact"}
        focusMode={focusMode}
        showHint={showStageHint}
        showReset={showZoomReset}
        showStepper={showZoomStepper}
        tone={zoomTone}
        visiblePresets={visibleZoomPresets}
        workbench={workbench}
      />
    </div>
  );
}
