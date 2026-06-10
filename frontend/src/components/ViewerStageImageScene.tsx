import { memo, useEffect, useState } from "react";
import type { CropRect, ViewerPan, ViewerZoomMode } from "../types";
import { debugLog } from "../lib/debugLog";
import { ViewerCropOverlay } from "./ViewerCropOverlay";
import { ViewerStageMedia } from "./ViewerStageMedia";

type ContainerSize = {
  width: number;
  height: number;
};

type ViewerStageImageSceneProps = {
  cropEditable?: boolean;
  cropRect?: CropRect;
  imageAlt: string;
  imageSrc: string;
  loading?: boolean;
  onContainerResize?: (size: ContainerSize) => void;
  onCropChange?: (cropRect: CropRect) => void;
  panOffset: ViewerPan;
  zoomMode: ViewerZoomMode;
  zoomScale: number;
};

export const ViewerStageImageScene = memo(function ViewerStageImageScene({
  cropEditable,
  cropRect,
  imageAlt,
  imageSrc,
  loading = false,
  onContainerResize,
  onCropChange,
  panOffset,
  zoomMode,
  zoomScale,
}: ViewerStageImageSceneProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  
  useEffect(() => {
    setImageLoaded(false);
    setImageError(false);
    debugLog("ImageScene.srcChanged", imageSrc?.substring(0, 60));
  }, [imageSrc]);
  
  const showImage = imageSrc && !imageError;
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
        <img 
          alt={imageAlt} 
          className="pc-stage-image" 
          src={imageSrc}
          onLoad={() => setImageLoaded(true)}
          onError={() => setImageError(true)}
        />
      ) : null}
      {cropRect ? <ViewerCropOverlay cropRect={cropRect} editable={cropEditable} onCropChange={onCropChange} zoomMode={zoomMode} zoomScale={zoomScale} /> : null}
    </ViewerStageMedia>
  );
});
