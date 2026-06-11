import { memo, useEffect, useRef, useState } from "react";
import type { CropRect, ViewerPan, ViewerZoomMode } from "../types";
import { ViewerCropOverlay } from "./ViewerCropOverlay";
import { ViewerStageBitmapCanvas } from "./ViewerStageBitmapCanvas";
import { ViewerStageMedia } from "./ViewerStageMedia";

type ContainerSize = { width: number; height: number };

type ViewerStageImageSceneProps = {
  cropEditable?: boolean;
  cropRect?: CropRect;
  imageAlt: string;
  imageKey?: string;
  imageSrc: string;
  loading?: boolean;
  onContainerResize?: (size: ContainerSize) => void;
  onCropChange?: (cropRect: CropRect) => void;
  onSettledPreviewImage?: () => void;
  panOffset: ViewerPan;
  previewBitmap?: ImageBitmap | null;
  zoomMode: ViewerZoomMode;
  zoomScale: number;
};

export const ViewerStageImageScene = memo(function ViewerStageImageScene({
  cropEditable, cropRect, imageAlt, imageSrc, loading = false,
  imageKey, onContainerResize, onCropChange, onSettledPreviewImage, panOffset, previewBitmap, zoomMode, zoomScale,
}: ViewerStageImageSceneProps) {
  const [displaySrc, setDisplaySrc] = useState(imageSrc);
  const [imageError, setImageError] = useState(false);
  const prevSrcRef = useRef(imageSrc);
  const prevImageKeyRef = useRef(imageKey);

  useEffect(() => {
    if (!imageSrc) {
      prevSrcRef.current = imageSrc;
      prevImageKeyRef.current = imageKey;
      setDisplaySrc("");
      setImageError(false);
      return;
    }
    if (prevSrcRef.current === imageSrc) return;
    const fileChanged = prevImageKeyRef.current !== imageKey;
    prevSrcRef.current = imageSrc;
    prevImageKeyRef.current = imageKey;
    if (fileChanged) {
      setDisplaySrc("");
    }
    setImageError(false);
    const img = new Image();
    img.onload = () => {
      setDisplaySrc(imageSrc);
      if (previewBitmap) {
        onSettledPreviewImage?.();
      }
    };
    img.onerror = () => setImageError(true);
    img.src = imageSrc;
  }, [imageKey, imageSrc, onSettledPreviewImage, previewBitmap]);

  const showImage = !!displaySrc && !imageError;
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
      {showImage ? (
        <img alt={imageAlt} className="pc-stage-image" src={displaySrc} onError={() => setImageError(true)} />
      ) : null}
      {previewBitmap ? (
        <ViewerStageBitmapCanvas alt={imageAlt} bitmap={previewBitmap} className="pc-stage-image pc-stage-canvas pc-stage-preview-overlay" />
      ) : null}
      {cropRect ? <ViewerCropOverlay cropRect={cropRect} editable={cropEditable} onCropChange={onCropChange} zoomMode={zoomMode} zoomScale={zoomScale} /> : null}
    </ViewerStageMedia>
  );
});
