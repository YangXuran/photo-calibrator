import { memo, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { ViewerPan, ViewerZoomMode } from "../types";

type ContainerSize = {
  width: number;
  height: number;
};

type ViewerStageMediaProps = {
  children: ReactNode;
  panOffset: ViewerPan;
  zoomMode: ViewerZoomMode;
  zoomScale: number;
  onContainerResize?: (size: ContainerSize) => void;
};

export const ViewerStageMedia = memo(function ViewerStageMedia({ children, panOffset, zoomMode, zoomScale, onContainerResize }: ViewerStageMediaProps) {
  const transform = zoomMode === "manual" ? `translate3d(${panOffset.x}px, ${panOffset.y}px, 0) scale(${zoomScale})` : undefined;
  const mediaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!onContainerResize) return;
    const el = mediaRef.current?.parentElement;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { inlineSize, blockSize } = entry.borderBoxSize?.[0] ?? entry.contentRect;
        onContainerResize({ width: Math.round(inlineSize), height: Math.round(blockSize) });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [onContainerResize]);

  return (
    <div
      ref={mediaRef}
      className={`pc-stage-media ${zoomMode === "fill" ? "is-fill" : "is-fit"} ${zoomMode === "manual" ? "is-manual" : ""}`}
      style={transform ? { transform } : undefined}
    >
      {children}
    </div>
  );
});
