import { useViewerHudLifecycle } from "../hooks/useViewerHudLifecycle";
import { useViewerStageInteractions } from "../hooks/useViewerStageInteractions";
import type { ActiveLayoutPreset, CompareMode, CropRect, ViewerPan, ViewerZoomMode } from "../types";
import { ViewerStageCompareBoard } from "./ViewerStageCompareBoard";
import { ViewerStageEmptyState } from "./ViewerStageEmptyState";
import { ViewerHudOverlay } from "./ViewerHudOverlay";
import { ViewerStageImageScene } from "./ViewerStageImageScene";
import { ViewerStageSplitScene } from "./ViewerStageSplitScene";
import { ViewerStageSurface } from "./ViewerStageSurface";

type ViewerStageProps = {
  compareMode: CompareMode;
  splitPosition: number;
  originalSrc?: string;
  calibratedSrc?: string;
  loading?: boolean;
  cropRect?: CropRect;
  cropEditable?: boolean;
  onCropChange?: (cropRect: CropRect) => void;
  zoomMode: ViewerZoomMode;
  zoomScale: number;
  panOffset: ViewerPan;
  onPanChange?: (panOffset: ViewerPan) => void;
  onZoomChange?: (zoomScale: number) => void;
  hudPrimary?: string[];
  hudSecondary?: string[];
  hudStatus?: string;
  hudActions?: React.ReactNode;
  hudToolbar?: React.ReactNode;
  hudCropPriority?: "primary" | "secondary" | "hidden";
  preset?: ActiveLayoutPreset;
  focusMode?: boolean;
};

export function ViewerStage({
  compareMode,
  splitPosition,
  originalSrc,
  calibratedSrc,
  loading,
  cropRect,
  cropEditable,
  onCropChange,
  zoomMode,
  zoomScale,
  panOffset,
  onPanChange,
  onZoomChange,
  hudPrimary,
  hudSecondary,
  hudStatus,
  hudActions,
  hudToolbar,
  hudCropPriority,
  preset,
  focusMode = false,
}: ViewerStageProps) {
  const { overlayActive, scheduleHudHide, wakeHud } = useViewerHudLifecycle({
    focusMode,
    resetDeps: [compareMode, originalSrc, calibratedSrc, zoomMode, zoomScale, hudStatus],
  });
  const { handleDoubleClick, handleWheel, isPanning, stageRef, startPan } = useViewerStageInteractions({
    onPanChange,
    onZoomChange,
    panOffset,
    wakeHud,
    zoomMode,
    zoomScale,
  });

  if (!originalSrc && !calibratedSrc) {
    return <ViewerStageEmptyState />;
  }

  const original = originalSrc ?? calibratedSrc ?? "";
  const calibrated = calibratedSrc ?? originalSrc ?? "";

  const hud = (
    <ViewerHudOverlay
      actions={hudActions}
      hudCropPriority={hudCropPriority}
      active={!focusMode || overlayActive}
      docked={focusMode}
      onScheduleHide={() => scheduleHudHide(900)}
      onWake={wakeHud}
      preset={preset}
      primary={hudPrimary ?? []}
      secondary={hudSecondary ?? []}
      status={hudStatus}
      toolbar={hudToolbar}
    />
  );

  if (compareMode === "split") {
    return (
      <ViewerStageSurface className="pc-stage-split" isPanning={isPanning} loading={loading} onDoubleClick={handleDoubleClick} onMouseMove={wakeHud} onPointerDown={startPan} onWheel={handleWheel} stageRef={stageRef} zoomMode={zoomMode}>
        {hud}
        <ViewerStageSplitScene
          calibratedSrc={calibrated}
          cropEditable={cropEditable}
          cropRect={cropRect}
          onCropChange={onCropChange}
          originalSrc={original}
          panOffset={panOffset}
          splitPosition={splitPosition}
          zoomMode={zoomMode}
          zoomScale={zoomScale}
        />
        <div className="pc-stage-divider" style={{ left: `${splitPosition}%` }} />
      </ViewerStageSurface>
    );
  }

  if (compareMode === "calibrated-only") {
    return (
      <ViewerStageSurface isPanning={isPanning} loading={loading} onDoubleClick={handleDoubleClick} onMouseMove={wakeHud} onPointerDown={startPan} onWheel={handleWheel} stageRef={stageRef} zoomMode={zoomMode}>
        {hud}
        <ViewerStageImageScene cropEditable={cropEditable} cropRect={cropRect} imageAlt="Calibrated" imageSrc={calibrated} onCropChange={onCropChange} panOffset={panOffset} zoomMode={zoomMode} zoomScale={zoomScale} />
      </ViewerStageSurface>
    );
  }

  return (
    <ViewerStageCompareBoard
      calibratedStage={
        <ViewerStageSurface isPanning={isPanning} loading={loading} onDoubleClick={handleDoubleClick} onMouseMove={wakeHud} onPointerDown={startPan} onWheel={handleWheel} stageRef={stageRef} zoomMode={zoomMode}>
          <ViewerStageImageScene imageAlt="Calibrated" imageSrc={calibrated} panOffset={panOffset} zoomMode={zoomMode} zoomScale={zoomScale} />
        </ViewerStageSurface>
      }
      hud={hud}
      originalStage={
        <ViewerStageSurface isPanning={isPanning} loading={loading} onDoubleClick={handleDoubleClick} onMouseMove={wakeHud} onPointerDown={startPan} onWheel={handleWheel} stageRef={stageRef} zoomMode={zoomMode}>
          <ViewerStageImageScene cropEditable={cropEditable} cropRect={cropRect} imageAlt="Original" imageSrc={original} onCropChange={onCropChange} panOffset={panOffset} zoomMode={zoomMode} zoomScale={zoomScale} />
        </ViewerStageSurface>
      }
    />
  );
}
