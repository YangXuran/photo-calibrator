import type { WorkspaceFile } from "../types";

export type WorkspaceStateTone = "accent" | "success" | "warning" | "neutral";

export type WorkspaceStateSummary = {
  sourceLabel: string;
  stateLabel: string;
  stateTone: WorkspaceStateTone;
  exportLabel: string;
  colorSpaceLabel: string;
  previewLabel: string;
  cropLabel: string;
  sizeLabel: string;
  sessionLabel: string;
  hasSession: boolean;
  hasOriginalFile: boolean;
};

export function getWorkspaceStateSummary(item?: WorkspaceFile): WorkspaceStateSummary {
  const width = item?.result?.processing?.original_width ?? item?.preview?.processing?.original_width;
  const height = item?.result?.processing?.original_height ?? item?.preview?.processing?.original_height;
  const previewSource = item?.result?.processing?.preview_source ?? item?.preview?.processing?.preview_source;
  const colorSpace = item?.result?.processing?.color_space;

  let stateLabel = "Not prepared";
  let stateTone: WorkspaceStateTone = "neutral";
  if (item?.cropEdited) {
    stateLabel = "Crop adjusted";
    stateTone = "accent";
  } else if (item?.crop) {
    stateLabel = "Crop suggested";
    stateTone = "warning";
  } else if (item?.result) {
    stateLabel = "Calibrated";
    stateTone = "success";
  } else if (item?.sessionId) {
    stateLabel = "Prepared";
    stateTone = "neutral";
  } else if (item) {
    stateLabel = "Imported";
    stateTone = "neutral";
  }

  return {
    sourceLabel: item ? (item.kind === "session" ? "Session restore" : "Local file") : "-",
    stateLabel,
    stateTone,
    exportLabel: item?.file ? "Full-resolution export ready" : "No original file export",
    colorSpaceLabel: colorSpace ?? "-",
    previewLabel: previewSource ?? "-",
    cropLabel: item?.cropEdited ? "Crop adjusted" : item?.crop ? "Crop suggested" : "No crop",
    sizeLabel: width && height ? `${width}×${height}` : "-",
    sessionLabel: item?.sessionId ?? "-",
    hasSession: Boolean(item?.sessionId),
    hasOriginalFile: Boolean(item?.file),
  };
}
