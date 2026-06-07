import type { ReactNode } from "react";

type ViewerStageCompareBoardProps = {
  calibratedStage: ReactNode;
  hud?: ReactNode;
  originalStage: ReactNode;
};

export function ViewerStageCompareBoard({ calibratedStage, hud, originalStage }: ViewerStageCompareBoardProps) {
  return (
    <div className="pc-stage-board">
      {hud}
      <div className="pc-compare-grid">
        <figure className="pc-stage-frame">
          <figcaption>原图</figcaption>
          {originalStage}
        </figure>
        <figure className="pc-stage-frame">
          <figcaption>校准预览</figcaption>
          {calibratedStage}
        </figure>
      </div>
    </div>
  );
}
