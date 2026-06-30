import type { ReactNode } from "react";
import { t } from "../i18n";

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
          <figcaption>{t("viewer.original")}</figcaption>
          {originalStage}
        </figure>
        <figure className="pc-stage-frame">
          <figcaption>{t("viewer.calibratedPreview")}</figcaption>
          {calibratedStage}
        </figure>
      </div>
    </div>
  );
}
