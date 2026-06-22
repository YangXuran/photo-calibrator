import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { CropDiagnostics, CropRect, ViewerPan, ViewerZoomMode } from "../types";
import { ViewerCropOverlay } from "./ViewerCropOverlay";
import { ViewerStageBitmapCanvas } from "./ViewerStageBitmapCanvas";
import { ViewerStageMedia } from "./ViewerStageMedia";

type ContainerSize = { width: number; height: number };
type LoadedImagePair = {
  calibratedSrc: string;
  imageKey?: string;
  originalSrc: string;
  naturalSize: ContainerSize;
};

function loadImage(src: string): Promise<ContainerSize> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error(`Failed to load preview: ${src}`));
    image.src = src;
  });
}

type ViewerStageSplitSceneProps = {
  calibratedSrc: string;
  calibratedPreviewBitmap?: ImageBitmap | null;
  children?: ReactNode;
  cropEditable?: boolean;
  cropDiagnostics?: CropDiagnostics;
  cropRect?: CropRect;
  imageKey?: string;
  loading?: boolean;
  onContainerResize?: (size: ContainerSize) => void;
  onCropChange?: (cropRect: CropRect, options?: { interaction?: "drag" | "commit" }) => void;
  onSettledCalibratedImage?: () => void;
  originalSrc: string;
  panOffset: ViewerPan;
  splitPosition: number;
  zoomMode: ViewerZoomMode;
  zoomScale: number;
};

export const ViewerStageSplitScene = memo(function ViewerStageSplitScene({
  calibratedPreviewBitmap, calibratedSrc, children, cropDiagnostics, cropEditable, cropRect, imageKey, loading = false,
  onContainerResize, onCropChange, onSettledCalibratedImage, originalSrc, panOffset, splitPosition, zoomMode, zoomScale,
}: ViewerStageSplitSceneProps) {
  const [displayPair, setDisplayPair] = useState<LoadedImagePair | null>(null);
  const [imageError, setImageError] = useState(false);
  const [containerSize, setContainerSize] = useState<ContainerSize | null>(null);
  const loadSequenceRef = useRef(0);

  useEffect(() => {
    const sequence = ++loadSequenceRef.current;
    if (!originalSrc || !calibratedSrc) {
      setDisplayPair(null);
      setImageError(false);
      return;
    }
    setImageError(false);
    setDisplayPair((current) => current?.imageKey !== imageKey ? null : current);
    Promise.all([loadImage(originalSrc), loadImage(calibratedSrc)])
      .then(([, calibratedSize]) => {
        if (sequence !== loadSequenceRef.current) return;
        setDisplayPair({ calibratedSrc, imageKey, originalSrc, naturalSize: calibratedSize });
        if (calibratedPreviewBitmap) onSettledCalibratedImage?.();
      })
      .catch(() => {
        if (sequence === loadSequenceRef.current) setImageError(true);
      });
  }, [calibratedPreviewBitmap, calibratedSrc, imageKey, onSettledCalibratedImage, originalSrc]);

  const showLoading = loading || (!displayPair && !imageError);
  const loadingStyle = {
    "--pc-stage-loading-scale": String(zoomMode === "manual" ? 1 / zoomScale : 1),
  } as CSSProperties;
  const handleResize = (size: ContainerSize) => {
    setContainerSize(size);
    onContainerResize?.(size);
  };
  const frameStyle = useMemo<CSSProperties>(() => {
    const naturalSize = displayPair?.naturalSize;
    if (!containerSize || !naturalSize || naturalSize.width <= 0 || naturalSize.height <= 0 || zoomMode === "fill") {
      return { inset: 0 };
    }
    const scale = Math.min(containerSize.width / naturalSize.width, containerSize.height / naturalSize.height);
    const width = Math.max(1, Math.round(naturalSize.width * scale));
    const height = Math.max(1, Math.round(naturalSize.height * scale));
    const left = Math.round((containerSize.width - width) / 2);
    const top = Math.round((containerSize.height - height) / 2);
    return { left, top, width, height };
  }, [containerSize, displayPair?.naturalSize, zoomMode]);

  return (
    <ViewerStageMedia onContainerResize={handleResize} panOffset={panOffset} zoomMode={zoomMode} zoomScale={zoomScale}>
      {showLoading ? (
        <div className="pc-stage-loading" style={loadingStyle}>
          <div className="pc-stage-loading-content">
            <span className="pc-spinner" />
            <span className="pc-stage-loading-label">Loading preview…</span>
          </div>
        </div>
      ) : null}
      <div className="pc-stage-image-frame" style={frameStyle}>
        {displayPair ? (
          <img alt="Calibrated" className="pc-stage-image" src={displayPair.calibratedSrc} onError={() => setImageError(true)} />
        ) : null}
        {calibratedPreviewBitmap ? (
          <ViewerStageBitmapCanvas alt="Calibrated" bitmap={calibratedPreviewBitmap} className="pc-stage-image pc-stage-canvas pc-stage-preview-overlay" />
        ) : null}
        {displayPair ? (
          <div className="pc-stage-clip" style={{ clipPath: `inset(0 ${100 - splitPosition}% 0 0)` }}>
            <img alt="Original" className="pc-stage-image" src={displayPair.originalSrc} onError={() => setImageError(true)} />
          </div>
        ) : null}
        {cropRect ? <ViewerCropOverlay cropDiagnostics={cropDiagnostics} cropRect={cropRect} editable={cropEditable} onCropChange={onCropChange} zoomMode={zoomMode} zoomScale={zoomScale} /> : null}
        {children}
      </div>
    </ViewerStageMedia>
  );
});
