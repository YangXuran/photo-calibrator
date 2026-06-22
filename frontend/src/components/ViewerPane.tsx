import { useViewerKeyboardShortcuts } from "../hooks/useViewerKeyboardShortcuts";
import { getViewerPanePresentation } from "../lib/layoutPresets";
import { ViewerFilmstripPane } from "./ViewerFilmstripPane";
import { ViewerMainPane } from "./ViewerMainPane";
import { ViewerPaneControls } from "./ViewerPaneControls";
import { ViewerStagePane } from "./ViewerStagePane";
import { ViewerStatusStrip } from "./ViewerStatusStrip";
import { ViewerStackLayout } from "./ViewerStackLayout";
import { getViewerPresentation } from "./viewerPresentation";
import { getViewerStatusPresentation } from "./viewerStatusPresentation";
import type { WorkbenchController } from "../hooks/useWorkbench";

type ContainerSize = {
  width: number;
  height: number;
};

type ViewerPaneProps = {
  workbench: WorkbenchController;
  originalSrc?: string;
  calibratedSrc?: string;
  onContainerResize?: (size: ContainerSize) => void;
};

export function ViewerPane({ workbench, originalSrc, calibratedSrc, onContainerResize }: ViewerPaneProps) {
  const { filmScanStatus, focusMode, hudPrimary, hudSecondary, hudCropPriority, selectedFile, showFilmstrip, showHud, statusBarMode } = getViewerPresentation(workbench);
  const statusPresentation = getViewerStatusPresentation(selectedFile, workbench.viewerZoomMode, workbench.viewerZoomScale, workbench.stageContainerSize ?? undefined);
  const viewerPanePresentation = getViewerPanePresentation();

  useViewerKeyboardShortcuts(workbench);

  const viewerMain = (
    <ViewerMainPane
      controls={
        <ViewerPaneControls
          compareTone={viewerPanePresentation.compareTone}
          density={viewerPanePresentation.controlsDensity}
          emphasis={viewerPanePresentation.controlsEmphasis}
          focusMode={focusMode}
          showStageHint={viewerPanePresentation.showStageHint}
          showZoomReset={viewerPanePresentation.showZoomReset}
          showZoomStepper={viewerPanePresentation.showZoomStepper}
          visibleCompareModes={viewerPanePresentation.visibleCompareModes}
          visibleZoomPresets={viewerPanePresentation.visibleZoomPresets}
          workbench={workbench}
          zoomTone={viewerPanePresentation.zoomTone}
        />
      }
      density={viewerPanePresentation.controlsDensity}
      emphasis={viewerPanePresentation.controlsEmphasis}
      focusMode={focusMode}
      meta={focusMode ? undefined : viewerPanePresentation.meta}
      status={
        <ViewerStatusStrip
          density={viewerPanePresentation.statusDensity}
          emphasis={viewerPanePresentation.statusEmphasis}
          mode={statusBarMode}
          presentation={statusPresentation}
        />
      }
      title={selectedFile?.name ?? viewerPanePresentation.title}
      stage={
        <>
          {workbench.highResLoading ? <progress className="pc-highres-progress" /> : null}
          <ViewerStagePane
            calibratedPreviewBitmap={workbench.localCurvePreviewBitmap}
            calibratedSrc={calibratedSrc}
            compareTone={viewerPanePresentation.compareTone}
            filmScanStatus={filmScanStatus}
            focusMode={focusMode}
            hudCropPriority={hudCropPriority}
            hudPrimary={hudPrimary}
            hudSecondary={hudSecondary}
            onContainerResize={onContainerResize}
            originalSrc={originalSrc}
            selectedFile={selectedFile}
            showHud={showHud}
            showZoomReset={viewerPanePresentation.showZoomReset}
            showZoomStepper={viewerPanePresentation.showZoomStepper}
            visibleCompareModes={viewerPanePresentation.visibleCompareModes}
            visibleZoomPresets={viewerPanePresentation.visibleZoomPresets}
            workbench={workbench}
            zoomTone={viewerPanePresentation.zoomTone}
          />
        </>
      }
    />
  );

  return (
    <ViewerStackLayout filmstrip={showFilmstrip ? <ViewerFilmstripPane workbench={workbench} /> : undefined} layoutKey="unified" main={viewerMain} />
  );
}
