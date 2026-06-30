import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MutableRefObject } from "react";
import { t } from "../i18n";

type SplitGeometry = {
  height: number;
  left: number;
  top: number;
  width: number;
};

type ViewerSplitControlProps = {
  frameRef: MutableRefObject<HTMLDivElement | null>;
  onChange: (position: number) => void;
  position: number;
  updateKey: string;
};

function clampPosition(value: number) {
  return Math.max(10, Math.min(90, Math.round(value)));
}

export const ViewerSplitControl = memo(function ViewerSplitControl({
  frameRef,
  onChange,
  position,
  updateKey,
}: ViewerSplitControlProps) {
  const [geometry, setGeometry] = useState<SplitGeometry | null>(null);
  const controlRef = useRef<HTMLDivElement | null>(null);
  const geometryRef = useRef<SplitGeometry | null>(null);
  const draggingRef = useRef(false);

  const measure = useCallback(() => {
    const stage = controlRef.current?.parentElement;
    const frame = frameRef.current;
    if (!(stage instanceof HTMLElement) || !(frame instanceof HTMLElement)) return false;
    const stageRect = stage.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    if (stageRect.width <= 0 || stageRect.height <= 0 || frameRect.width <= 0 || frameRect.height <= 0) return false;
    const next = {
      height: frameRect.height,
      left: frameRect.left - stageRect.left,
      top: frameRect.top - stageRect.top,
      width: frameRect.width,
    };
    geometryRef.current = next;
    setGeometry((current) => current
      && Math.abs(current.height - next.height) < 0.25
      && Math.abs(current.left - next.left) < 0.25
      && Math.abs(current.top - next.top) < 0.25
      && Math.abs(current.width - next.width) < 0.25
      ? current
      : next);
    return true;
  }, [frameRef]);

  useLayoutEffect(() => {
    const stage = controlRef.current?.parentElement;
    if (!stage) return;
    let frameRequest = 0;
    let attempts = 0;
    const measureUntilReady = () => {
      attempts += 1;
      if (!measure() && attempts < 60) frameRequest = requestAnimationFrame(measureUntilReady);
    };
    frameRequest = requestAnimationFrame(measureUntilReady);
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(stage);
    const frame = frameRef.current;
    if (frame instanceof HTMLElement) resizeObserver.observe(frame);
    stage.addEventListener("transitionend", measure, true);
    return () => {
      cancelAnimationFrame(frameRequest);
      resizeObserver.disconnect();
      stage.removeEventListener("transitionend", measure, true);
    };
  }, [frameRef, measure, updateKey]);

  const updateFromPointer = (clientX: number) => {
    const current = geometryRef.current;
    if (!current || current.width <= 0) return;
    const stageLeft = controlRef.current?.parentElement?.getBoundingClientRect().left ?? 0;
    onChange(clampPosition(((clientX - stageLeft - current.left) / current.width) * 100));
  };

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      if (!draggingRef.current) return;
      event.preventDefault();
      updateFromPointer(event.clientX);
    };
    const onPointerUp = () => {
      draggingRef.current = false;
    };
    const onMouseMove = (event: MouseEvent) => {
      if (!draggingRef.current) return;
      event.preventDefault();
      updateFromPointer(event.clientX);
    };
    const onMouseUp = () => {
      draggingRef.current = false;
    };
    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("mousemove", onMouseMove, { passive: false });
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  });

  const controlStyle: CSSProperties = geometry && geometry.width > 0 && geometry.height > 0
    ? { height: geometry.height, left: geometry.left, top: geometry.top, width: geometry.width }
    : { inset: 0 };

  return (
    <div
      className="pc-stage-split-control"
      data-testid="split-stage-control"
      ref={controlRef}
      style={controlStyle}
    >
      <div
        aria-label={t("viewer.splitAria")}
        aria-orientation="vertical"
        aria-valuemax={90}
        aria-valuemin={10}
        aria-valuenow={position}
        className="pc-stage-divider"
        data-testid="split-stage-divider"
        onKeyDown={(event) => {
          const step = event.shiftKey ? 5 : 1;
          if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
            event.preventDefault();
            onChange(clampPosition(position - step));
          } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
            event.preventDefault();
            onChange(clampPosition(position + step));
          } else if (event.key === "Home") {
            event.preventDefault();
            onChange(10);
          } else if (event.key === "End") {
            event.preventDefault();
            onChange(90);
          }
        }}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          draggingRef.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          updateFromPointer(event.clientX);
        }}
        onPointerMove={(event) => {
          if (!draggingRef.current && !event.currentTarget.hasPointerCapture(event.pointerId)) return;
          event.preventDefault();
          updateFromPointer(event.clientX);
        }}
        onPointerUp={(event) => {
          draggingRef.current = false;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerCancel={(event) => {
          draggingRef.current = false;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          draggingRef.current = true;
          updateFromPointer(event.clientX);
        }}
        role="slider"
        style={{ left: `${position}%` }}
        tabIndex={0}
      >
        <span className="pc-stage-divider-handle" aria-hidden="true">
          <span />
          <span />
        </span>
      </div>
    </div>
  );
});
