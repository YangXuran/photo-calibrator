import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

type ViewerStageBitmapCanvasProps = {
  alt: string;
  bitmap: ImageBitmap;
  className?: string;
  style?: CSSProperties;
};

const LAYER_STYLE: CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  width: "100%",
  height: "100%",
  display: "block",
  objectFit: "contain",
};

export const ViewerStageBitmapCanvas = memo(function ViewerStageBitmapCanvas({
  alt,
  bitmap,
  className,
  style,
}: ViewerStageBitmapCanvasProps) {
  const frontCanvasRef = useRef<HTMLCanvasElement>(null);
  const backCanvasRef = useRef<HTMLCanvasElement>(null);
  const activeLayerRef = useRef<0 | 1>(0);
  const hasPaintedRef = useRef(false);
  const swapFrameRef = useRef<number | null>(null);
  const [activeLayer, setActiveLayer] = useState<0 | 1>(0);

  useLayoutEffect(() => {
    const nextLayer: 0 | 1 = hasPaintedRef.current
      ? activeLayerRef.current === 0 ? 1 : 0
      : activeLayerRef.current;
    const targetCanvas = nextLayer === 0 ? frontCanvasRef.current : backCanvasRef.current;
    if (!targetCanvas) return;
    if (targetCanvas.width !== bitmap.width) {
      targetCanvas.width = bitmap.width;
    }
    if (targetCanvas.height !== bitmap.height) {
      targetCanvas.height = bitmap.height;
    }
    const context = targetCanvas.getContext("2d");
    if (!context) return;
    context.drawImage(bitmap, 0, 0);
    if (!hasPaintedRef.current) {
      hasPaintedRef.current = true;
      activeLayerRef.current = nextLayer;
      setActiveLayer(nextLayer);
      return;
    }
    if (swapFrameRef.current) {
      window.cancelAnimationFrame(swapFrameRef.current);
    }
    swapFrameRef.current = window.requestAnimationFrame(() => {
      swapFrameRef.current = null;
      activeLayerRef.current = nextLayer;
      setActiveLayer(nextLayer);
    });
  }, [bitmap]);

  useEffect(() => () => {
    if (swapFrameRef.current) {
      window.cancelAnimationFrame(swapFrameRef.current);
    }
  }, []);

  return (
    <div aria-label={alt} className={className} role="img" style={style}>
      <canvas
        ref={frontCanvasRef}
        style={{
          ...LAYER_STYLE,
          opacity: activeLayer === 0 ? 1 : 0,
          zIndex: activeLayer === 0 ? 1 : 0,
        }}
      />
      <canvas
        ref={backCanvasRef}
        style={{
          ...LAYER_STYLE,
          opacity: activeLayer === 1 ? 1 : 0,
          zIndex: activeLayer === 1 ? 1 : 0,
        }}
      />
    </div>
  );
});
