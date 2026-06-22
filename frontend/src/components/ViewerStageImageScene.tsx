import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { CropDiagnostics, CropRect, ViewerPan, ViewerZoomMode } from "../types";
import { ViewerCropOverlay } from "./ViewerCropOverlay";
import { ViewerStageBitmapCanvas } from "./ViewerStageBitmapCanvas";
import { ViewerStageMedia } from "./ViewerStageMedia";

type ContainerSize = { width: number; height: number };

type ViewerStageImageSceneProps = {
  cropEditable?: boolean;
  cropDiagnostics?: CropDiagnostics;
  cropRect?: CropRect;
  imageAlt: string;
  imageKey?: string;
  imageSrc: string;
  loading?: boolean;
  onContainerResize?: (size: ContainerSize) => void;
  onCropChange?: (cropRect: CropRect, options?: { interaction?: "drag" | "commit" }) => void;
  onSettledPreviewImage?: () => void;
  panOffset: ViewerPan;
  previewBitmap?: ImageBitmap | null;
  zoomMode: ViewerZoomMode;
  zoomScale: number;
};

export const ViewerStageImageScene = memo(function ViewerStageImageScene({
  cropDiagnostics, cropEditable, cropRect, imageAlt, imageSrc, loading = false,
  imageKey, onContainerResize, onCropChange, onSettledPreviewImage, panOffset, previewBitmap, zoomMode, zoomScale,
}: ViewerStageImageSceneProps) {
  const [displaySrc, setDisplaySrc] = useState(imageSrc);
  const [imageError, setImageError] = useState(false);
  const [containerSize, setContainerSize] = useState<ContainerSize | null>(null);
  const [naturalSize, setNaturalSize] = useState<ContainerSize | null>(null);
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
      setNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
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
  const loadingStyle = {
    "--pc-stage-loading-scale": String(zoomMode === "manual" ? 1 / zoomScale : 1),
  } as CSSProperties;
  const handleResize = (size: ContainerSize) => {
    setContainerSize(size);
    onContainerResize?.(size);
  };
  const frameStyle = useMemo<CSSProperties>(() => {
    if (!containerSize || !naturalSize || naturalSize.width <= 0 || naturalSize.height <= 0 || zoomMode === "fill") {
      return { inset: 0 };
    }
    const scale = Math.min(containerSize.width / naturalSize.width, containerSize.height / naturalSize.height);
    const width = Math.max(1, Math.round(naturalSize.width * scale));
    const height = Math.max(1, Math.round(naturalSize.height * scale));
    const left = Math.round((containerSize.width - width) / 2);
    const top = Math.round((containerSize.height - height) / 2);
    return { left, top, width, height };
  }, [containerSize, naturalSize, zoomMode]);
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
        {showImage ? (
          <img alt={imageAlt} className="pc-stage-image" src={displaySrc} onError={() => setImageError(true)} />
        ) : null}
        {previewBitmap ? (
          <ViewerStageBitmapCanvas alt={imageAlt} bitmap={previewBitmap} className="pc-stage-image pc-stage-canvas pc-stage-preview-overlay" />
        ) : null}
        {cropRect ? <ViewerCropOverlay cropDiagnostics={cropDiagnostics} cropRect={cropRect} editable={cropEditable} onCropChange={onCropChange} zoomMode={zoomMode} zoomScale={zoomScale} /> : null}
      </div>
    </ViewerStageMedia>
  );
});
