import type { PointerEventHandler, ReactNode, RefObject, WheelEventHandler } from "react";
import type { ViewerZoomMode } from "../types";

type ViewerStageSurfaceProps = {
  children: ReactNode;
  className?: string;
  isPanning?: boolean;
  loading?: boolean;
  onDoubleClick: PointerEventHandler<HTMLDivElement>;
  onMouseMove: () => void;
  onPointerDown: PointerEventHandler<HTMLDivElement>;
  onWheel: WheelEventHandler<HTMLDivElement>;
  stageRef: RefObject<HTMLDivElement>;
  zoomMode: ViewerZoomMode;
};

export function ViewerStageSurface({
  children,
  className,
  isPanning = false,
  loading = false,
  onDoubleClick,
  onMouseMove,
  onPointerDown,
  onWheel,
  stageRef,
  zoomMode,
}: ViewerStageSurfaceProps) {
  return (
    <div
      className={`pc-stage ${className ?? ""} ${zoomMode === "manual" ? "is-pannable" : ""} ${isPanning ? "is-panning" : ""}`.trim()}
      onDoubleClick={onDoubleClick}
      onMouseMove={onMouseMove}
      onPointerDown={onPointerDown}
      onWheel={onWheel}
      ref={stageRef}
    >
      {loading ? <div className="pc-stage-busy">正在计算预览</div> : null}
      {children}
    </div>
  );
}
