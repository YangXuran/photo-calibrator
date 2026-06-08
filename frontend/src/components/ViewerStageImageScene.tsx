import type { CropRect, ViewerPan, ViewerZoomMode } from "../types";
import { ViewerCropOverlay } from "./ViewerCropOverlay";
import { ViewerStageMedia } from "./ViewerStageMedia";

type ViewerStageImageSceneProps = {
  cropEditable?: boolean;
  cropRect?: CropRect;
  imageAlt: string;
  imageSrc: string;
  loading?: boolean;
  onCropChange?: (cropRect: CropRect) => void;
  panOffset: ViewerPan;
  zoomMode: ViewerZoomMode;
  zoomScale: number;
};

export function ViewerStageImageScene({
  cropEditable,
  cropRect,
  imageAlt,
  imageSrc,
  loading = false,
  onCropChange,
  panOffset,
  zoomMode,
  zoomScale,
}: ViewerStageImageSceneProps) {
  const showImage = imageSrc && !loading;
  return (
    <ViewerStageMedia panOffset={panOffset} zoomMode={zoomMode} zoomScale={zoomScale}>
      {showImage ? <img alt={imageAlt} className="pc-stage-image" src={imageSrc} /> : null}
      {cropRect ? <ViewerCropOverlay cropRect={cropRect} editable={cropEditable} onCropChange={onCropChange} zoomMode={zoomMode} zoomScale={zoomScale} /> : null}
    </ViewerStageMedia>
  );
}
