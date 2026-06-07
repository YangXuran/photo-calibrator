import type { WorkbenchController } from "../hooks/useWorkbench";
import type { ActiveLayoutPreset, WorkspaceFile } from "../types";
import { getWorkspaceStateSummary } from "../lib/workspaceStatus";
import { getViewerCompareLabel, getViewerZoomLabel } from "./viewerLabels";

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
  "actionStates" | "compareMode" | "layoutState" | "selectedFile" | "splitPosition" | "viewerZoomMode" | "viewerZoomScale"
>;

export function getViewerPresentation(workbench: ViewerPresentationInput, activeLayoutPreset: ActiveLayoutPreset): ViewerPresentation {
  const selectedFile = workbench.selectedFile;
  const summary = getWorkspaceStateSummary(selectedFile);
  const focusMode = workbench.layoutState.viewerFocusMode;
  const showFilmstrip = workbench.layoutState.showFilmstrip;
  const showHud = focusMode || workbench.layoutState.showViewerHud;
  const filmScanStatus =
    workbench.actionStates.filmScan.status === "running"
      ? "Detecting"
      : summary.cropLabel === "Crop adjusted"
        ? "Adjusted"
        : summary.cropLabel === "Crop suggested"
          ? "Suggested"
          : "None";

  /* preset-aware HUD composition */
  const compareEntry = `Compare: ${getViewerCompareLabel(workbench.compareMode, workbench.splitPosition)}`;
  const zoomEntry = `Zoom: ${getViewerZoomLabel(workbench.viewerZoomMode, workbench.viewerZoomScale, "hud")}`;
  const sourceEntry = summary.sourceLabel !== "-" ? `Source: ${summary.sourceLabel}` : null;
  const sizeEntry = summary.sizeLabel !== "-" ? `Size: ${summary.sizeLabel}` : null;
  const colorEntry = summary.colorSpaceLabel !== "-" ? `Color: ${summary.colorSpaceLabel}` : null;
  const cropEntry = summary.cropLabel !== "No crop" ? `Crop: ${summary.cropLabel}` : null;
  const previewEntry = summary.previewLabel !== "-" ? `Preview: ${summary.previewLabel}` : null;

  let hudPrimary: string[];
  let hudSecondary: string[];
  let hudCropPriority: "primary" | "secondary" | "hidden";
  let statusBarMode: "full" | "minimal" | "compact";

  if (activeLayoutPreset === "review") {
    hudPrimary = [compareEntry, sourceEntry, zoomEntry].filter(Boolean) as string[];
    hudSecondary = [cropEntry, sizeEntry, colorEntry, previewEntry].filter(Boolean) as string[];
    hudCropPriority = "primary";
    statusBarMode = "full";
  } else if (activeLayoutPreset === "edit") {
    hudPrimary = [zoomEntry, cropEntry, compareEntry].filter(Boolean) as string[];
    hudSecondary = [sourceEntry, sizeEntry, colorEntry].filter(Boolean) as string[];
    hudCropPriority = "primary";
    statusBarMode = "compact";
  } else if (activeLayoutPreset === "analyze") {
    hudPrimary = [sourceEntry, compareEntry, zoomEntry].filter(Boolean) as string[];
    hudSecondary = [cropEntry, sizeEntry, colorEntry, previewEntry].filter(Boolean) as string[];
    hudCropPriority = "secondary";
    statusBarMode = "compact";
  } else {
    hudPrimary = [compareEntry, zoomEntry, sourceEntry].filter(Boolean) as string[];
    hudSecondary = [sizeEntry, colorEntry, cropEntry, previewEntry].filter(Boolean) as string[];
    hudCropPriority = "secondary";
    statusBarMode = "full";
  }

  return {
    filmScanStatus,
    focusMode,
    hudPrimary,
    hudSecondary,
    hudCropPriority,
    selectedFile,
    showFilmstrip,
    showHud,
    statusBarMode,
    summary,
  };
}
