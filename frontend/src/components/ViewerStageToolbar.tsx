import type { WorkbenchController } from "../hooks/useWorkbench";
import { t } from "../i18n";

export type ViewerStageToolbarWorkbench = Pick<
  WorkbenchController,
  "resetViewerZoom" | "setViewerZoomPreset" | "viewerZoomMode" | "viewerZoomScale" | "zoomIn" | "zoomOut"
>;

type ViewerStageToolbarProps = {
  workbench: ViewerStageToolbarWorkbench;
  compact?: boolean;
  showHint?: boolean;
  focusMode?: boolean;
  tone?: "default" | "primary" | "muted";
  visiblePresets?: Array<"fit" | "fill">;
  showStepper?: boolean;
  showReset?: boolean;
};

export function ViewerStageToolbar({
  workbench,
  compact = false,
  focusMode = false,
  tone = "default",
  visiblePresets = ["fit", "fill"],
  showStepper = true,
  showReset = true,
}: ViewerStageToolbarProps) {
  const showFit = visiblePresets.includes("fit");
  const showFill = visiblePresets.includes("fill");

  return (
    <div
      className={`pc-stage-toolbar pc-viewer-control-block pc-viewer-control-block-${tone} ${compact ? "is-compact" : ""}`.trim()}
      data-testid={focusMode ? "focus-stage-toolbar" : "viewer-stage-toolbar"}
    >
      {(showFit || showFill) ? (
        <div className={`pc-segmented ${compact ? "is-compact" : ""}`} data-testid={focusMode ? "focus-zoom-preset-group" : "viewer-zoom-preset-group"}>
          {showFit ? (
            <button className={workbench.viewerZoomMode === "fit" ? "is-active" : ""} data-testid={focusMode ? "focus-zoom-fit" : "viewer-zoom-fit"} onClick={() => workbench.setViewerZoomPreset("fit")} type="button">
              {focusMode ? "Fit" : t("common.fit")}
            </button>
          ) : null}
          {showFill ? (
            <button className={workbench.viewerZoomMode === "fill" ? "is-active" : ""} data-testid={focusMode ? "focus-zoom-fill" : "viewer-zoom-fill"} onClick={() => workbench.setViewerZoomPreset("fill")} type="button">
              {focusMode ? "Fill" : t("common.fill")}
            </button>
          ) : null}
        </div>
      ) : null}
      {showStepper ? (
        <div className={`pc-stepper ${compact ? "is-compact" : ""}`} data-testid={focusMode ? "focus-zoom-stepper" : "viewer-zoom-stepper"}>
          <button data-testid={focusMode ? "focus-zoom-out" : "viewer-zoom-out"} onClick={workbench.zoomOut} type="button">
            -
          </button>
          <span data-testid={focusMode ? "focus-zoom-readout" : "viewer-zoom-readout"}>{Math.round((workbench.viewerZoomMode === "manual" ? workbench.viewerZoomScale : 1) * 100)}%</span>
          <button data-testid={focusMode ? "focus-zoom-in" : "viewer-zoom-in"} onClick={workbench.zoomIn} type="button">
            +
          </button>
        </div>
      ) : null}
      {showReset ? (
        <button className="pc-button pc-button-secondary pc-button-small" data-testid={focusMode ? "focus-zoom-reset" : "viewer-zoom-reset"} onClick={workbench.resetViewerZoom} type="button">
          {focusMode ? "Reset" : t("common.reset")}
        </button>
      ) : null}
    </div>
  );
}
