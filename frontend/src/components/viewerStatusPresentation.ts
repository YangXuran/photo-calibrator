import { getWorkspaceStateSummary, type WorkspaceStateSummary } from "../lib/workspaceStatus";
import type { ViewerZoomMode, WorkspaceFile } from "../types";
import { getViewerZoomLabel } from "./viewerLabels";

export type ViewerStatusPresentation = {
  summary: WorkspaceStateSummary;
  zoomLabel: string;
};

export function getViewerStatusPresentation(selectedFile: WorkspaceFile | undefined, zoomMode: ViewerZoomMode, zoomScale: number): ViewerStatusPresentation {
  return {
    summary: getWorkspaceStateSummary(selectedFile),
    zoomLabel: getViewerZoomLabel(zoomMode, zoomScale, "status"),
  };
}
