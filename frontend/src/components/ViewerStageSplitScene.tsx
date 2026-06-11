import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import type { CropRect, ViewerPan, ViewerZoomMode } from "../types";
import { ViewerCropOverlay } from "./ViewerCropOverlay";
import { ViewerStageBitmapCanvas } from "./ViewerStageBitmapCanvas";
import { ViewerStageMedia } from "./ViewerStageMedia";

type ContainerSize = { width: number; height: number };

type ViewerStageSplitSceneProps = {
  calibratedSrc: string;
  calibratedPreviewBitmap?: ImageBitmap | null;
  children?: ReactNode;
  cropEditable?: boolean;
  cropRect?: CropRect;
  imageKey?: string;
  loading?: boolean;
  onContainerResize?: (size: ContainerSize) => void;
  onCropChange?: (cropRect: CropRect) => void;
  onSettledCalibratedImage?: () => void;
  originalSrc: string;
  panOffset: ViewerPan;
  splitPosition: number;
  zoomMode: ViewerZoomMode;
  zoomScale: number;
};

export const ViewerStageSplitScene = memo(function ViewerStageSplitScene({
  calibratedPreviewBitmap, calibratedSrc, children, cropEditable, cropRect, imageKey, loading = false,
  onContainerResize, onCropChange, onSettledCalibratedImage, originalSrc, panOffset, splitPosition, zoomMode, zoomScale,
}: ViewerStageSplitSceneProps) {
  const [displayOriginal, setDisplayOriginal] = useState(originalSrc);
  const [displayCalibrated, setDisplayCalibrated] = useState(calibratedSrc);
  const [originalError, setOriginalError] = useState(false);
  const [calibratedError, setCalibratedError] = useState(false);
  const prevOriginalRef = useRef(originalSrc);
  const prevCalibratedRef = useRef(calibratedSrc);
  const prevImageKeyRef = useRef(imageKey);

  useEffect(() => {
    if (!originalSrc) {
      prevOriginalRef.current = originalSrc;
      prevImageKeyRef.current = imageKey;
      setDisplayOriginal("");
      setOriginalError(false);
      return;
    }
    if (prevOriginalRef.current === originalSrc) return;
    const fileChanged = prevImageKeyRef.current !== imageKey;
    prevOriginalRef.current = originalSrc;
    prevImageKeyRef.current = imageKey;
    if (fileChanged) {
      setDisplayOriginal("");
    }
    setOriginalError(false);
    const img = new Image();
    img.onload = () => setDisplayOriginal(originalSrc);
    img.onerror = () => setOriginalError(true);
    img.src = originalSrc;
  }, [imageKey, originalSrc]);

  useEffect(() => {
    if (!calibratedSrc) {
      prevCalibratedRef.current = calibratedSrc;
      prevImageKeyRef.current = imageKey;
      setDisplayCalibrated("");
      setCalibratedError(false);
      return;
    }
    if (prevCalibratedRef.current === calibratedSrc) return;
    const fileChanged = prevImageKeyRef.current !== imageKey;
    prevCalibratedRef.current = calibratedSrc;
    prevImageKeyRef.current = imageKey;
    if (fileChanged) {
      setDisplayCalibrated("");
    }
    setCalibratedError(false);
    const img = new Image();
    img.onload = () => {
      setDisplayCalibrated(calibratedSrc);
      if (calibratedPreviewBitmap) {
        onSettledCalibratedImage?.();
      }
    };
    img.onerror = () => setCalibratedError(true);
    img.src = calibratedSrc;
  }, [calibratedPreviewBitmap, calibratedSrc, imageKey, onSettledCalibratedImage]);

  const showOriginal = !!displayOriginal && !originalError;
  const showCalibrated = !!displayCalibrated && !calibratedError;
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
        <img alt="Calibrated" className="pc-stage-image" src={displayCalibrated} onError={() => setCalibratedError(true)} />
      ) : null}
      {calibratedPreviewBitmap ? (
        <ViewerStageBitmapCanvas alt="Calibrated" bitmap={calibratedPreviewBitmap} className="pc-stage-image pc-stage-canvas pc-stage-preview-overlay" />
      ) : null}
      {showOriginal ? (
        <div className="pc-stage-clip" style={{ width: `${splitPosition}%` }}>
          <img alt="Original" className="pc-stage-image" src={displayOriginal}
            style={{ width: `${(100 / splitPosition) * 100}%`, maxWidth: "none" }}
            onError={() => setOriginalError(true)} />
        </div>
      ) : null}
      {cropRect ? <ViewerCropOverlay cropRect={cropRect} editable={cropEditable} onCropChange={onCropChange} zoomMode={zoomMode} zoomScale={zoomScale} /> : null}
      {children}
    </ViewerStageMedia>
  );
});
