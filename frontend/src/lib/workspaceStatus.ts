import type { WorkspaceFile } from "../types";
import { t } from "../i18n";

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
  const cropApplied = Boolean(item?.cropApplied || item?.result?.processing?.crop_applied);

  let stateLabel = "Not prepared";
  let stateTone: WorkspaceStateTone = "neutral";
  if (cropApplied) {
    stateLabel = t("workspaceStatus.cropApplied");
    stateTone = "success";
  } else if (item?.result) {
    stateLabel = t("workspaceStatus.calibrated");
    stateTone = "success";
  } else if (item?.cropEdited) {
    stateLabel = t("workspaceStatus.cropAdjusted");
    stateTone = "accent";
  } else if (item?.crop) {
    stateLabel = t("workspaceStatus.cropSuggested");
    stateTone = "warning";
  } else if (item?.sessionId) {
    stateLabel = t("workspaceStatus.prepared");
    stateTone = "neutral";
  } else if (item) {
    stateLabel = t("workspaceStatus.imported");
    stateTone = "neutral";
  }

  return {
    sourceLabel: item ? (item.kind === "session" ? "Session restore" : "Local file") : "-",
    stateLabel,
    stateTone,
    exportLabel: item?.file ? "Full-resolution export ready" : "No original file export",
    colorSpaceLabel: colorSpace ?? "-",
    previewLabel: previewSource ?? "-",
    cropLabel: cropApplied ? t("workspaceStatus.cropApplied") : item?.cropEdited ? t("workspaceStatus.cropAdjusted") : item?.crop ? t("workspaceStatus.cropSuggested") : t("workspaceStatus.noCrop"),
    sizeLabel: width && height ? `${width}×${height}` : "-",
    sessionLabel: item?.sessionId ? (item.sessionId.length > 20 ? item.sessionId.slice(0, 18) + "…" : item.sessionId) : "-",
    hasSession: Boolean(item?.sessionId),
    hasOriginalFile: Boolean(item?.file),
  };
}
