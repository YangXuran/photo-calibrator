import { useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import type { ViewerPan, ViewerZoomMode } from "../types";

type ViewerStageInteractionsOptions = {
  onPanChange?: (panOffset: ViewerPan) => void;
  onZoomChange?: (zoomScale: number) => void;
  panOffset: ViewerPan;
  wakeHud: () => void;
  zoomMode: ViewerZoomMode;
  zoomScale: number;
};

function clampPanOffset(stageBounds: DOMRect, scale: number, panOffset: ViewerPan) {
  if (scale <= 1) {
    return { x: 0, y: 0 };
  }
  const maxX = ((stageBounds.width * scale) - stageBounds.width) / 2;
  const maxY = ((stageBounds.height * scale) - stageBounds.height) / 2;
  return {
    x: Math.max(-maxX, Math.min(maxX, panOffset.x)),
    y: Math.max(-maxY, Math.min(maxY, panOffset.y)),
  };
}

export function useViewerStageInteractions({
  onPanChange,
  onZoomChange,
  panOffset,
  wakeHud,
  zoomMode,
  zoomScale,
}: ViewerStageInteractionsOptions) {
  const [isPanning, setIsPanning] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const wheelAccRef = useRef(0);
  const wheelRafRef = useRef<number | null>(null);
  const panRafRef = useRef<number | null>(null);

  function handleWheel(event: ReactWheelEvent<HTMLDivElement>) {
    if (!onZoomChange) return;
    event.preventDefault();
    wakeHud();
    wheelAccRef.current += event.deltaY;
    if (wheelRafRef.current === null) {
      wheelRafRef.current = requestAnimationFrame(() => {
        const accumulated = wheelAccRef.current;
        wheelAccRef.current = 0;
        wheelRafRef.current = null;
        const step = accumulated > 0 ? -0.1 : 0.1;
        const nextScale = zoomScale + step;
        onZoomChange(Math.max(0.5, Math.min(4, Number(nextScale.toFixed(2)))));
      });
    }
  }

  function handleDoubleClick(event: ReactPointerEvent<HTMLDivElement>) {
    if (!onZoomChange) return;
    if ((event.target as HTMLElement).closest(".pc-crop-overlay, .pc-crop-handle")) return;
    wakeHud();
    if (wheelRafRef.current) { cancelAnimationFrame(wheelRafRef.current); wheelRafRef.current = null; }
    if (zoomMode === "manual" && zoomScale > 1.05) {
      onZoomChange(1);
      onPanChange?.({ x: 0, y: 0 });
      return;
    }
    onZoomChange(2);
    onPanChange?.({ x: 0, y: 0 });
  }

  function startPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (zoomMode !== "manual" || !onPanChange) return;
    if ((event.target as HTMLElement).closest(".pc-crop-overlay, .pc-crop-handle")) return;
    event.preventDefault();
    wakeHud();
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = { ...panOffset };
    const stageBounds = event.currentTarget.getBoundingClientRect();
    setIsPanning(true);

    const move = (pointerEvent: PointerEvent) => {
      const next = clampPanOffset(stageBounds, zoomScale, {
        x: origin.x + (pointerEvent.clientX - startX),
        y: origin.y + (pointerEvent.clientY - startY),
      });
      if (panRafRef.current) cancelAnimationFrame(panRafRef.current);
      panRafRef.current = requestAnimationFrame(() => {
        panRafRef.current = null;
        onPanChange(next);
      });
    };

    const stop = () => {
      setIsPanning(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  }

  return {
    handleDoubleClick,
    handleWheel,
    isPanning,
    stageRef,
    startPan,
  };
}
