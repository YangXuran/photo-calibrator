import type { CompareMode, ViewerZoomMode } from "../types";

export function getViewerCompareLabel(compareMode: CompareMode, splitPosition: number) {
  if (compareMode === "side-by-side") return "Dual";
  if (compareMode === "split") return `Split ${splitPosition}%`;
  return "Calibrated";
}

export function getViewerZoomLabel(
  zoomMode: ViewerZoomMode,
  zoomScale: number,
  style: "hud" | "status" | "focus" = "focus",
  containerSize?: { width: number; height: number },
  imageSize?: { width: number; height: number },
): string {
  if (zoomMode === "manual") {
    let pct: number;
    if (containerSize && imageSize && imageSize.width > 0) {
      pct = Math.round((containerSize.width / imageSize.width) * zoomScale * 100);
    } else {
      pct = Math.round(zoomScale * 100);
    }
    return style === "status" ? `Manual ${pct}%` : `${pct}%`;
  }
  if (zoomMode === "fill") {
    if (containerSize && imageSize && imageSize.width > 0) {
      const pct = Math.round((containerSize.width / imageSize.width) * 100);
      return style === "status" ? `Fill ${pct}%` : `Fill ${pct}%`;
    }
    return style === "status" ? "Fill view" : "Fill";
  }
  if (containerSize && imageSize && imageSize.width > 0) {
    const pct = Math.round((containerSize.width / imageSize.width) * 100);
    return style === "status" ? `Fit ${pct}%` : `Fit ${pct}%`;
  }
  return style === "status" ? "Fit view" : "Fit";
}
