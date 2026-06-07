import { type PointerEvent as ReactPointerEvent } from "react";
import type { CropRect, ViewerZoomMode } from "../types";

type DragHandle = "move" | "nw" | "ne" | "sw" | "se";

type ViewerCropOverlayProps = {
  cropRect: CropRect;
  editable?: boolean;
  onCropChange?: (cropRect: CropRect) => void;
  zoomMode: ViewerZoomMode;
  zoomScale: number;
};

function clampCropRect(cropRect: CropRect): CropRect {
  const left = Math.max(0, Math.min(cropRect.left, 0.98));
  const top = Math.max(0, Math.min(cropRect.top, 0.98));
  const width = Math.max(0.04, Math.min(cropRect.width, 1 - left));
  const height = Math.max(0.04, Math.min(cropRect.height, 1 - top));
  return { left, top, width, height };
}

function nextCropRect(origin: CropRect, handle: DragHandle, dx: number, dy: number): CropRect {
  const right = origin.left + origin.width;
  const bottom = origin.top + origin.height;
  if (handle === "move") {
    return clampCropRect({ ...origin, left: origin.left + dx, top: origin.top + dy });
  }
  const next = { left: origin.left, top: origin.top, width: origin.width, height: origin.height };
  if (handle.includes("w")) next.left = origin.left + dx;
  if (handle.includes("n")) next.top = origin.top + dy;
  const resolvedRight = handle.includes("e") ? right + dx : right;
  const resolvedBottom = handle.includes("s") ? bottom + dy : bottom;
  next.width = resolvedRight - next.left;
  next.height = resolvedBottom - next.top;
  return clampCropRect(next);
}

export function ViewerCropOverlay({ cropRect, editable, onCropChange, zoomMode, zoomScale }: ViewerCropOverlayProps) {
  function startDrag(event: ReactPointerEvent<HTMLDivElement | HTMLButtonElement>, handle: DragHandle) {
    if (!editable || !onCropChange) return;
    event.preventDefault();
    event.stopPropagation();
    const origin = { ...cropRect };
    const parent = event.currentTarget.closest(".pc-stage") as HTMLDivElement | null;
    if (!parent) return;
    const bounds = parent.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;

    const move = (pointerEvent: PointerEvent) => {
      const effectiveScale = zoomMode === "manual" ? zoomScale : 1;
      const dx = (pointerEvent.clientX - startX) / (bounds.width * effectiveScale);
      const dy = (pointerEvent.clientY - startY) / (bounds.height * effectiveScale);
      onCropChange(nextCropRect(origin, handle, dx, dy));
    };

    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  }

  return (
    <div
      className={`pc-crop-overlay ${editable ? "is-editable" : ""}`}
      onPointerDown={(event) => startDrag(event, "move")}
      style={{
        left: `${cropRect.left * 100}%`,
        top: `${cropRect.top * 100}%`,
        width: `${cropRect.width * 100}%`,
        height: `${cropRect.height * 100}%`,
      }}
    >
      {editable ? (
        <>
          <button className="pc-crop-handle pc-crop-handle-nw" onPointerDown={(event) => startDrag(event, "nw")} type="button" />
          <button className="pc-crop-handle pc-crop-handle-ne" onPointerDown={(event) => startDrag(event, "ne")} type="button" />
          <button className="pc-crop-handle pc-crop-handle-sw" onPointerDown={(event) => startDrag(event, "sw")} type="button" />
          <button className="pc-crop-handle pc-crop-handle-se" onPointerDown={(event) => startDrag(event, "se")} type="button" />
        </>
      ) : null}
    </div>
  );
}
