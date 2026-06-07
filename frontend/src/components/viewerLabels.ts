import type { CompareMode, ViewerZoomMode } from "../types";

export function getViewerCompareLabel(compareMode: CompareMode, splitPosition: number) {
  if (compareMode === "side-by-side") return "Dual";
  if (compareMode === "split") return `Split ${splitPosition}%`;
  return "Calibrated";
}

export function getViewerZoomLabel(zoomMode: ViewerZoomMode, zoomScale: number, style: "hud" | "status" | "focus" = "focus") {
  if (zoomMode === "manual") {
    return style === "status" ? `Manual ${Math.round(zoomScale * 100)}%` : `${Math.round(zoomScale * 100)}%`;
  }
  if (zoomMode === "fill") {
    return style === "status" ? "Fill view" : "Fill";
  }
  return style === "status" ? "Fit view" : "Fit";
}
