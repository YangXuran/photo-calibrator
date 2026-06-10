import { memo, useEffect, useState, type ReactNode } from "react";
import type { CropRect, ViewerPan, ViewerZoomMode } from "../types";
import { debugLog } from "../lib/debugLog";
import { ViewerCropOverlay } from "./ViewerCropOverlay";
import { ViewerStageMedia } from "./ViewerStageMedia";

type ContainerSize = {
  width: number;
  height: number;
};

type ViewerStageSplitSceneProps = {
  calibratedSrc: string;
  children?: ReactNode;
  cropEditable?: boolean;
  cropRect?: CropRect;
  loading?: boolean;
  onContainerResize?: (size: ContainerSize) => void;
  onCropChange?: (cropRect: CropRect) => void;
  originalSrc: string;
  panOffset: ViewerPan;
  splitPosition: number;
  zoomMode: ViewerZoomMode;
  zoomScale: number;
};

export const ViewerStageSplitScene = memo(function ViewerStageSplitScene({
  calibratedSrc,
  children,
  cropEditable,
  cropRect,
  loading = false,
  onContainerResize,
  onCropChange,
  originalSrc,
  panOffset,
  splitPosition,
  zoomMode,
  zoomScale,
}: ViewerStageSplitSceneProps) {
  const [originalLoaded, setOriginalLoaded] = useState(false);
  const [calibratedLoaded, setCalibratedLoaded] = useState(false);
  const [originalError, setOriginalError] = useState(false);
  const [calibratedError, setCalibratedError] = useState(false);
  
  useEffect(() => {
    setOriginalLoaded(false);
    setOriginalError(false);
    debugLog("SplitScene.originalSrcChanged", originalSrc?.substring(0, 60));
  }, [originalSrc]);
  
  useEffect(() => {
    setCalibratedLoaded(false);
    setCalibratedError(false);
    debugLog("SplitScene.calibratedSrcChanged", calibratedSrc?.substring(0, 60));
  }, [calibratedSrc]);
  
  const showOriginal = originalSrc && !originalError;
  const showCalibrated = calibratedSrc && !calibratedError;
  const showLoading = loading;

  return (
    <ViewerStageMedia onContainerResize={onContainerResize} panOffset={panOffset} zoomMode={zoomMode} zoomScale={zoomScale}>
      {showLoading ? (
        <div className="pc-stage-loading">
          <div className="pc-stage-loading-content">
            <span className="pc-spinner" />
            <span className="pc-stage-loading-label">Loading preview…</span>
          </div>
        </div>
      ) : null}
      {showCalibrated ? (
        <img 
          alt="Calibrated" 
          className="pc-stage-image" 
          src={calibratedSrc}
          onLoad={() => setCalibratedLoaded(true)}
          onError={() => setCalibratedError(true)}
        />
      ) : null}
      {showOriginal ? (
        <div className="pc-stage-clip" style={{ width: `${splitPosition}%` }}>
          <img 
            alt="Original" 
            className="pc-stage-image" 
            src={originalSrc}
            style={{ width: `${(100 / splitPosition) * 100}%`, maxWidth: "none" }}
            onLoad={() => setOriginalLoaded(true)}
            onError={() => setOriginalError(true)}
          />
        </div>
      ) : null}
      {cropRect ? <ViewerCropOverlay cropRect={cropRect} editable={cropEditable} onCropChange={onCropChange} zoomMode={zoomMode} zoomScale={zoomScale} /> : null}
      {children}
    </ViewerStageMedia>
  );
});
