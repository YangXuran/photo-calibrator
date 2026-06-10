import { useRef } from "react";
import { useViewerHudLifecycle } from "../hooks/useViewerHudLifecycle";
import { useViewerStageInteractions } from "../hooks/useViewerStageInteractions";
import type { CompareMode, CropRect, ViewerPan, ViewerZoomMode } from "../types";
import { ViewerStageCompareBoard } from "./ViewerStageCompareBoard";
import { ViewerStageEmptyState } from "./ViewerStageEmptyState";
import { ViewerHudOverlay } from "./ViewerHudOverlay";
import { ViewerStageImageScene } from "./ViewerStageImageScene";
import { ViewerStageSplitScene } from "./ViewerStageSplitScene";
import { ViewerStageSurface } from "./ViewerStageSurface";

type ContainerSize = {
  width: number;
  height: number;
};

type ViewerStageProps = {
  compareMode: CompareMode;
  splitPosition: number;
  onSplitChange?: (position: number) => void;
  originalSrc?: string;
  calibratedSrc?: string;
  loading?: boolean;
  cropRect?: CropRect;
  cropEditable?: boolean;
  onContainerResize?: (size: ContainerSize) => void;
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
  focusMode?: boolean;
};

export function ViewerStage({
  compareMode,
  splitPosition,
  onSplitChange,
  originalSrc,
  calibratedSrc,
  loading,
  cropRect,
  cropEditable,
  onContainerResize,
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
  const calibratedStageRef = useRef<HTMLDivElement | null>(null);

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
      primary={hudPrimary ?? []}
      secondary={hudSecondary ?? []}
      status={hudStatus}
      toolbar={hudToolbar}
    />
  );

  if (compareMode === "split") {
    const handleDividerDown = (event: React.PointerEvent) => {
      if (!onSplitChange) return;
      event.preventDefault();
      event.stopPropagation();
      const surface = event.currentTarget.parentElement;
      if (!surface) return;
      const bounds = surface.getBoundingClientRect();
      const move = (e: PointerEvent) => {
        const pct = Math.max(10, Math.min(90, ((e.clientX - bounds.left) / bounds.width) * 100));
        onSplitChange(Math.round(pct));
      };
      const stop = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", stop);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", stop, { once: true });
    };
    return (
      <ViewerStageSurface className="pc-stage-split" isPanning={isPanning} loading={loading} onDoubleClick={handleDoubleClick} onMouseMove={wakeHud} onPointerDown={startPan} onWheel={handleWheel} stageRef={stageRef} zoomMode={zoomMode}>
        {hud}
        <ViewerStageSplitScene
          calibratedSrc={calibrated}
          cropEditable={cropEditable}
          cropRect={cropRect}
          loading={loading}
          onContainerResize={onContainerResize}
          onCropChange={onCropChange}
          originalSrc={original}
          panOffset={panOffset}
          splitPosition={splitPosition}
          zoomMode={zoomMode}
          zoomScale={zoomScale}
        >
          <div className="pc-stage-divider" onPointerDown={handleDividerDown} role="separator" style={{ left: `${splitPosition}%` }} />
        </ViewerStageSplitScene>
      </ViewerStageSurface>
    );
  }

  if (compareMode === "calibrated-only") {
    return (
      <ViewerStageSurface isPanning={isPanning} loading={loading} onDoubleClick={handleDoubleClick} onMouseMove={wakeHud} onPointerDown={startPan} onWheel={handleWheel} stageRef={stageRef} zoomMode={zoomMode}>
        {hud}
        <ViewerStageImageScene cropEditable={cropEditable} cropRect={cropRect} imageAlt="Calibrated" imageSrc={calibrated} loading={loading} onContainerResize={onContainerResize} onCropChange={onCropChange} panOffset={panOffset} zoomMode={zoomMode} zoomScale={zoomScale} />
      </ViewerStageSurface>
    );
  }

  return (
    <ViewerStageCompareBoard
      calibratedStage={
        <ViewerStageSurface isPanning={isPanning} loading={loading} onDoubleClick={handleDoubleClick} onMouseMove={wakeHud} onPointerDown={startPan} onWheel={handleWheel} stageRef={calibratedStageRef} zoomMode={zoomMode}>
          <ViewerStageImageScene imageAlt="Calibrated" imageSrc={calibrated} loading={loading} onContainerResize={onContainerResize} panOffset={panOffset} zoomMode={zoomMode} zoomScale={zoomScale} />
        </ViewerStageSurface>
      }
      hud={hud}
      originalStage={
        <ViewerStageSurface isPanning={isPanning} loading={loading} onDoubleClick={handleDoubleClick} onMouseMove={wakeHud} onPointerDown={startPan} onWheel={handleWheel} stageRef={stageRef} zoomMode={zoomMode}>
          <ViewerStageImageScene cropEditable={cropEditable} cropRect={cropRect} imageAlt="Original" imageSrc={original} loading={loading} onContainerResize={onContainerResize} onCropChange={onCropChange} panOffset={panOffset} zoomMode={zoomMode} zoomScale={zoomScale} />
        </ViewerStageSurface>
      }
    />
  );
}
