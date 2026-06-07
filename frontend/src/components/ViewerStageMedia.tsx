import type { ReactNode } from "react";
import type { ViewerPan, ViewerZoomMode } from "../types";

type ViewerStageMediaProps = {
  children: ReactNode;
  panOffset: ViewerPan;
  zoomMode: ViewerZoomMode;
  zoomScale: number;
};

export function ViewerStageMedia({ children, panOffset, zoomMode, zoomScale }: ViewerStageMediaProps) {
  const transform = zoomMode === "manual" ? `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomScale})` : undefined;

  return (
    <div
      className={`pc-stage-media ${zoomMode === "fill" ? "is-fill" : "is-fit"} ${zoomMode === "manual" ? "is-manual" : ""}`}
      style={transform ? { transform } : undefined}
    >
      {children}
    </div>
  );
}
