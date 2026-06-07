import type { CropRect, ViewerPan, ViewerZoomMode } from "../types";
import { ViewerCropOverlay } from "./ViewerCropOverlay";
import { ViewerStageMedia } from "./ViewerStageMedia";

type ViewerStageImageSceneProps = {
  cropEditable?: boolean;
  cropRect?: CropRect;
  imageAlt: string;
  imageSrc: string;
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
  onCropChange,
  panOffset,
  zoomMode,
  zoomScale,
}: ViewerStageImageSceneProps) {
  return (
    <ViewerStageMedia panOffset={panOffset} zoomMode={zoomMode} zoomScale={zoomScale}>
      <img alt={imageAlt} className="pc-stage-image" src={imageSrc} />
      {cropRect ? <ViewerCropOverlay cropRect={cropRect} editable={cropEditable} onCropChange={onCropChange} zoomMode={zoomMode} zoomScale={zoomScale} /> : null}
    </ViewerStageMedia>
  );
}
