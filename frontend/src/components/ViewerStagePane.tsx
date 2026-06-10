import { ViewerCropActions } from "./ViewerCropActions";
import { ViewerFocusToolbar } from "./ViewerFocusToolbar";
import { ViewerStage } from "./ViewerStage";
import type { WorkbenchController } from "../hooks/useWorkbench";
import type { WorkspaceFile } from "../types";

type ViewerStagePaneWorkbench = Pick<
  WorkbenchController,
  | "compareMode"
  | "loading"
  | "resetSelectedCrop"
  | "runFilmScan"
  | "setCompareMode"
  | "setSplitPosition"
  | "setViewerManualScale"
  | "setViewerPanOffset"
  | "setViewerZoomPreset"
  | "splitPosition"
  | "toggleViewerFocusMode"
  | "updateSelectedCrop"
  | "viewerPan"
  | "viewerZoomMode"
  | "viewerZoomScale"
  | "zoomIn"
  | "zoomOut"
  | "resetViewerZoom"
>;

type ContainerSize = {
  width: number;
  height: number;
};

type ViewerStagePaneProps = {
  hudCropPriority?: "primary" | "secondary" | "hidden";
  calibratedSrc?: string;
  compareTone?: "default" | "primary" | "muted";
  filmScanStatus: string;
  focusMode: boolean;
  hudPrimary: string[];
  hudSecondary: string[];
  onContainerResize?: (size: ContainerSize) => void;
  originalSrc?: string;
  selectedFile?: WorkspaceFile;
  showHud: boolean;
  showZoomReset?: boolean;
  showZoomStepper?: boolean;
  visibleCompareModes?: Array<"side-by-side" | "split" | "calibrated-only">;
  visibleZoomPresets?: Array<"fit" | "fill">;
  workbench: ViewerStagePaneWorkbench;
  zoomTone?: "default" | "primary" | "muted";
};

export function ViewerStagePane({
  hudCropPriority = "secondary",
  calibratedSrc,
  compareTone = "primary",
  filmScanStatus,
  focusMode,
  hudPrimary,
  hudSecondary,
  onContainerResize,
  originalSrc,
  selectedFile,
  showHud,
  showZoomReset = true,
  showZoomStepper = true,
  visibleCompareModes,
  visibleZoomPresets,
  workbench,
  zoomTone = "default",
}: ViewerStagePaneProps) {
  const focusToolbar = focusMode ? (
    <ViewerFocusToolbar
      compareTone={compareTone}
      showZoomReset={showZoomReset}
      showZoomStepper={showZoomStepper}
      visibleCompareModes={visibleCompareModes}
      visibleZoomPresets={visibleZoomPresets}
      workbench={workbench}
      zoomTone={zoomTone}
    />
  ) : undefined;
  const hudActions = showHud ? <ViewerCropActions canReset={selectedFile?.cropEdited} onReset={workbench.resetSelectedCrop} onSuggest={workbench.runFilmScan} /> : null;

  return (
    <div className={`pc-stage-shell ${focusMode ? "is-focus" : ""}`} data-testid="viewer-stage-shell">
      <ViewerStage
        calibratedSrc={calibratedSrc}
        compareMode={workbench.compareMode}
        cropEditable={Boolean(selectedFile?.crop)}
        cropRect={selectedFile?.crop?.crop_rect}
        focusMode={focusMode}
        hudActions={hudActions}
        hudCropPriority={hudCropPriority}
        hudPrimary={showHud ? hudPrimary : undefined}
        hudSecondary={showHud ? hudSecondary : undefined}
        hudStatus={showHud ? filmScanStatus : undefined}
        hudToolbar={focusToolbar}
        loading={workbench.loading}
        onContainerResize={onContainerResize}
        onCropChange={workbench.updateSelectedCrop}
        onPanChange={workbench.setViewerPanOffset}
        onZoomChange={workbench.setViewerManualScale}
        originalSrc={originalSrc}
        panOffset={workbench.viewerPan}
        splitPosition={workbench.splitPosition}
        onSplitChange={workbench.setSplitPosition}
        zoomMode={workbench.viewerZoomMode}
        zoomScale={workbench.viewerZoomScale}
      />
    </div>
  );
}
