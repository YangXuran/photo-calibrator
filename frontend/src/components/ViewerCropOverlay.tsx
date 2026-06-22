import { type PointerEvent as ReactPointerEvent } from "react";
import type { CropDiagnostics, CropEdgeDiagnostics, CropRect, ViewerZoomMode } from "../types";

type DragHandle = "move" | "nw" | "ne" | "sw" | "se";

type ViewerCropOverlayProps = {
  cropDiagnostics?: CropDiagnostics;
  cropRect: CropRect;
  editable?: boolean;
  onCropChange?: (cropRect: CropRect, options?: { interaction?: "drag" | "commit" }) => void;
  zoomMode: ViewerZoomMode;
  zoomScale: number;
};

type EdgeName = "left" | "right" | "top" | "bottom";

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

function clampUnit(value: number | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function scoreOpacity(score: number | undefined): number {
  const safe = typeof score === "number" && Number.isFinite(score) ? score : 0;
  return Math.max(0.22, Math.min(0.92, 0.22 + safe / 4));
}

function renderDebugLayer(edgeName: EdgeName, diagnostics?: CropEdgeDiagnostics) {
  if (!diagnostics) return null;
  const bandSamples = diagnostics.band_samples ?? [];
  const mergedCandidates = diagnostics.merged_candidates ?? [];
  const weightedTrim = diagnostics.weighted_trim;
  const guideItems = bandSamples.map((sample, index) => {
    const trim = clampUnit(sample.trim);
    const bandStart = clampUnit(sample.band_start);
    const bandEnd = clampUnit(sample.band_end);
    const style = edgeName === "left" || edgeName === "right"
      ? {
          left: edgeName === "left" ? `${trim * 100}%` : undefined,
          right: edgeName === "right" ? `${trim * 100}%` : undefined,
          top: `${bandStart * 100}%`,
          height: `${Math.max(0.5, (bandEnd - bandStart) * 100)}%`,
          opacity: scoreOpacity(sample.score),
        }
      : {
          top: edgeName === "top" ? `${trim * 100}%` : undefined,
          bottom: edgeName === "bottom" ? `${trim * 100}%` : undefined,
          left: `${bandStart * 100}%`,
          width: `${Math.max(0.5, (bandEnd - bandStart) * 100)}%`,
          opacity: scoreOpacity(sample.score),
        };
    return <span className={`pc-crop-debug-band pc-crop-debug-band-${edgeName}`} key={`${edgeName}-band-${index}`} style={style} />;
  });
  const mergedItems = mergedCandidates.map((trim, index) => {
    const style = edgeName === "left" || edgeName === "right"
      ? {
          left: edgeName === "left" ? `${clampUnit(trim) * 100}%` : undefined,
          right: edgeName === "right" ? `${clampUnit(trim) * 100}%` : undefined,
        }
      : {
          top: edgeName === "top" ? `${clampUnit(trim) * 100}%` : undefined,
          bottom: edgeName === "bottom" ? `${clampUnit(trim) * 100}%` : undefined,
        };
    return <span className={`pc-crop-debug-candidate pc-crop-debug-candidate-${edgeName}`} key={`${edgeName}-candidate-${index}`} style={style} />;
  });
  const weightedStyle = weightedTrim == null
    ? undefined
    : edgeName === "left" || edgeName === "right"
      ? {
          left: edgeName === "left" ? `${clampUnit(weightedTrim) * 100}%` : undefined,
          right: edgeName === "right" ? `${clampUnit(weightedTrim) * 100}%` : undefined,
        }
      : {
          top: edgeName === "top" ? `${clampUnit(weightedTrim) * 100}%` : undefined,
          bottom: edgeName === "bottom" ? `${clampUnit(weightedTrim) * 100}%` : undefined,
        };
  return (
    <>
      {guideItems}
      {mergedItems}
      {weightedStyle ? <span className={`pc-crop-debug-weighted pc-crop-debug-weighted-${edgeName}`} style={weightedStyle} /> : null}
    </>
  );
}

export function ViewerCropOverlay({ cropDiagnostics, cropRect, editable, onCropChange, zoomMode, zoomScale }: ViewerCropOverlayProps) {
  function startDrag(event: ReactPointerEvent<HTMLDivElement | HTMLButtonElement>, handle: DragHandle) {
    if (!editable || !onCropChange) return;
    event.preventDefault();
    event.stopPropagation();
    const origin = { ...cropRect };
    const frame = event.currentTarget.closest(".pc-stage-image-frame") as HTMLDivElement | null;
    if (!frame) return;
    const bounds = frame.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    let latest = origin;

    const move = (pointerEvent: PointerEvent) => {
      const dx = (pointerEvent.clientX - startX) / bounds.width;
      const dy = (pointerEvent.clientY - startY) / bounds.height;
      latest = nextCropRect(origin, handle, dx, dy);
      onCropChange(latest, { interaction: "drag" });
    };

    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      onCropChange(latest, { interaction: "commit" });
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  }

  const edges = cropDiagnostics?.edges;

  return (
    <>
      {renderDebugLayer("left", edges?.left)}
      {renderDebugLayer("right", edges?.right)}
      {renderDebugLayer("top", edges?.top)}
      {renderDebugLayer("bottom", edges?.bottom)}
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
    </>
  );
}
