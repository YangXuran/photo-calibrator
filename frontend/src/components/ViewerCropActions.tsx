import { t } from "../i18n";

type ViewerCropActionsProps = {
  canReset?: boolean;
  onSuggest: () => void;
  onReset: () => void;
};

export function ViewerCropActions({ canReset, onSuggest, onReset }: ViewerCropActionsProps) {
  return (
    <>
      <button className="pc-stage-action-button" data-testid="focus-crop-detect" onClick={onSuggest} type="button">
        {t("crop.detect")}
      </button>
      <button className="pc-stage-action-button" data-testid="focus-crop-reset" disabled={!canReset} onClick={onReset} type="button">
        {t("crop.reset")}
      </button>
    </>
  );
}
