import { getWorkspaceStateSummary, type WorkspaceStateSummary } from "../lib/workspaceStatus";
import type { ViewerZoomMode, WorkspaceFile } from "../types";
import { getViewerZoomLabel } from "./viewerLabels";

export type ViewerStatusPresentation = {
  summary: WorkspaceStateSummary;
  zoomLabel: string;
};

export function getViewerStatusPresentation(
  selectedFile: WorkspaceFile | undefined,
  zoomMode: ViewerZoomMode,
  zoomScale: number,
  containerSize?: { width: number; height: number },
): ViewerStatusPresentation {
  const processing = selectedFile?.preview?.processing;
  const imgSize = processing?.original_width && processing?.original_height
    ? { width: processing.original_width, height: processing.original_height }
    : undefined;
  return {
    summary: getWorkspaceStateSummary(selectedFile),
    zoomLabel: getViewerZoomLabel(zoomMode, zoomScale, "status", containerSize, imgSize),
  };
}
