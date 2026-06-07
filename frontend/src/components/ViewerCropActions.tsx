type ViewerCropActionsProps = {
  canReset?: boolean;
  onSuggest: () => void;
  onReset: () => void;
};

export function ViewerCropActions({ canReset, onSuggest, onReset }: ViewerCropActionsProps) {
  return (
    <>
      <button className="pc-stage-action-button" data-testid="focus-crop-detect" onClick={onSuggest} type="button">
        Detect
      </button>
      <button className="pc-stage-action-button" data-testid="focus-crop-reset" disabled={!canReset} onClick={onReset} type="button">
        Reset crop
      </button>
    </>
  );
}
