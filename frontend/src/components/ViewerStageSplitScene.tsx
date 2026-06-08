import type { CropRect, ViewerPan, ViewerZoomMode } from "../types";
import { ViewerCropOverlay } from "./ViewerCropOverlay";
import { ViewerStageMedia } from "./ViewerStageMedia";

type ViewerStageSplitSceneProps = {
  calibratedSrc: string;
  cropEditable?: boolean;
  cropRect?: CropRect;
  loading?: boolean;
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
  loading = false,
  onCropChange,
  originalSrc,
  panOffset,
  splitPosition,
  zoomMode,
  zoomScale,
}: ViewerStageSplitSceneProps) {
  const showOriginal = originalSrc && !loading;
  const showCalibrated = calibratedSrc && !loading;
  return (
    <ViewerStageMedia panOffset={panOffset} zoomMode={zoomMode} zoomScale={zoomScale}>
      {showOriginal ? <img alt="Original" className="pc-stage-image" src={originalSrc} /> : null}
      {showCalibrated ? (
        <div className="pc-stage-clip" style={{ width: `${splitPosition}%` }}>
          <img alt="Calibrated" className="pc-stage-image" src={calibratedSrc} />
        </div>
      ) : null}
      {cropRect ? <ViewerCropOverlay cropRect={cropRect} editable={cropEditable} onCropChange={onCropChange} zoomMode={zoomMode} zoomScale={zoomScale} /> : null}
    </ViewerStageMedia>
  );
}
