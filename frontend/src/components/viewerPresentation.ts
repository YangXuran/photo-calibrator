import type { WorkbenchController } from "../hooks/useWorkbench";
import { t } from "../i18n";
import type { WorkspaceFile } from "../types";
import { getWorkspaceStateSummary } from "../lib/workspaceStatus";
import { getViewerZoomLabel } from "./viewerLabels";

type WorkspaceStateSummary = ReturnType<typeof getWorkspaceStateSummary>;

type ViewerPresentation = {
  filmScanStatus: string;
  focusMode: boolean;
  hudPrimary: string[];
  hudSecondary: string[];
  hudCropPriority: "primary" | "secondary" | "hidden";
  selectedFile?: WorkspaceFile;
  showFilmstrip: boolean;
  showHud: boolean;
  statusBarMode: "full" | "minimal" | "compact";
  summary: WorkspaceStateSummary;
};

type ViewerPresentationInput = Pick<
  WorkbenchController,
  "actionStates" | "compareMode" | "layoutState" | "selectedFile" | "splitPosition" | "stageContainerSize" | "viewerZoomMode" | "viewerZoomScale"
>;

export function getViewerPresentation(workbench: ViewerPresentationInput): ViewerPresentation {
  const selectedFile = workbench.selectedFile;
  const summary = getWorkspaceStateSummary(selectedFile);
  const focusMode = workbench.layoutState.viewerFocusMode;
  const showFilmstrip = workbench.layoutState.showFilmstrip;
  const showHud = focusMode || workbench.layoutState.showViewerHud;
  const containerSize = workbench.stageContainerSize;
  const imageSize = selectedFile?.preview?.processing;
  const zoomSize = containerSize ? containerSize : undefined;
  const imgSize = imageSize?.original_width && imageSize?.original_height
    ? { width: imageSize.original_width, height: imageSize.original_height }
    : undefined;
  const filmScanStatus =
    workbench.actionStates.filmScan.status === "running"
      ? t("workspaceStatus.detecting")
      : summary.cropLabel === t("workspaceStatus.cropApplied")
        ? t("workspaceStatus.applied")
        : summary.cropLabel === t("workspaceStatus.cropAdjusted")
        ? t("workspaceStatus.adjusted")
        : summary.cropLabel === t("workspaceStatus.cropSuggested")
          ? t("workspaceStatus.suggested")
          : t("workspaceStatus.none");

  /* Single unified HUD composition — minimal, non-intrusive */
  const zoomEntry = `Zoom: ${getViewerZoomLabel(workbench.viewerZoomMode, workbench.viewerZoomScale, "hud", zoomSize, imgSize)}`;
  const sizeEntry = summary.sizeLabel !== "-" ? `Size: ${summary.sizeLabel}` : null;
  const cropEntry = summary.cropLabel !== t("workspaceStatus.noCrop") ? `Crop: ${summary.cropLabel}` : null;

  const hudPrimary = [zoomEntry].filter(Boolean) as string[];
  const hudSecondary = [sizeEntry, cropEntry].filter(Boolean) as string[];

  return {
    filmScanStatus,
    focusMode,
    hudPrimary,
    hudSecondary,
    hudCropPriority: "secondary",
    selectedFile,
    showFilmstrip,
    showHud,
    statusBarMode: "full",
    summary,
  };
}
