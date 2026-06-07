import type { CropRect, ViewerPan, ViewerZoomMode } from "../types";
import { ViewerCropOverlay } from "./ViewerCropOverlay";
import { ViewerStageMedia } from "./ViewerStageMedia";

type ViewerStageSplitSceneProps = {
  calibratedSrc: string;
  cropEditable?: boolean;
  cropRect?: CropRect;
  onCropChange?: (cropRect: CropRect) => void;
  originalSrc: string;
  panOffset: ViewerPan;
  splitPosition: number;
  zoomMode: ViewerZoomMode;
  zoomScale: number;
};

export function ViewerStageSplitScene({
  calibratedSrc,
  cropEditable,
  cropRect,
  onCropChange,
  originalSrc,
  panOffset,
  splitPosition,
  zoomMode,
  zoomScale,
}: ViewerStageSplitSceneProps) {
  return (
    <ViewerStageMedia panOffset={panOffset} zoomMode={zoomMode} zoomScale={zoomScale}>
      <img alt="Original" className="pc-stage-image" src={originalSrc} />
      <div className="pc-stage-clip" style={{ width: `${splitPosition}%` }}>
        <img alt="Calibrated" className="pc-stage-image" src={calibratedSrc} />
      </div>
      {cropRect ? <ViewerCropOverlay cropRect={cropRect} editable={cropEditable} onCropChange={onCropChange} zoomMode={zoomMode} zoomScale={zoomScale} /> : null}
    </ViewerStageMedia>
  );
}
