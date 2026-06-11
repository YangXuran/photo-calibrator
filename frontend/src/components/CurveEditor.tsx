import { useCallback, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { ChannelCurve, HistogramPayload, ManualCurves } from "../types";

type CurvesEditorProps = {
  curves: ManualCurves;
  onChange: (curves: ManualCurves, options?: { interaction?: "drag" | "commit" | "edit" }) => void;
  disabled?: boolean;
  histogram?: HistogramPayload;
};

type ChannelKey = "r" | "g" | "b" | "l";
type RgbKey = "r" | "g" | "b";

const RGB_CHANNELS: RgbKey[] = ["r", "g", "b"];
const SIZE = 280;
const DATA_MAX = 255;
const POINT_RADIUS = 5;
const POINT_RADIUS_SELECTED = 7;
const MAX_CONTROL_POINTS = 10;

const CHANNEL_COLORS: Record<ChannelKey, string> = {
  r: "#e53e3e",
  g: "#38a169",
  b: "#3182ce",
  l: "#e2e8f0",
};

const CHANNEL_LABELS: Record<ChannelKey, string> = {
  r: "R",
  g: "G",
  b: "B",
  l: "L",
};

function toSvgX(value: number): number {
  return (value / DATA_MAX) * SIZE;
}

function toSvgY(value: number): number {
  return SIZE - (value / DATA_MAX) * SIZE;
}

function toDataX(svgX: number): number {
  return Math.round((svgX / SIZE) * DATA_MAX);
}

function toDataY(svgY: number): number {
  return Math.round(((SIZE - svgY) / SIZE) * DATA_MAX);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function smoothCurvePath(curve: ChannelCurve): string {
  if (curve.length < 2) return "";
  const pts = curve.map((point) => ({ x: toSvgX(point[0]), y: toSvgY(point[1]) }));
  if (pts.length === 2) {
    return `M ${pts[0]!.x.toFixed(1)} ${pts[0]!.y.toFixed(1)} L ${pts[1]!.x.toFixed(1)} ${pts[1]!.y.toFixed(1)}`;
  }

  let d = `M ${pts[0]!.x.toFixed(1)} ${pts[0]!.y.toFixed(1)}`;
  for (let index = 0; index < pts.length - 1; index += 1) {
    const p0 = pts[Math.max(index - 1, 0)]!;
    const p1 = pts[index]!;
    const p2 = pts[index + 1]!;
    const p3 = pts[Math.min(index + 2, pts.length - 1)]!;
    const dx1 = p2.x - p0.x;
    const dy1 = p2.y - p0.y;
    const dx2 = p3.x - p1.x;
    const dy2 = p3.y - p1.y;
    const tension = 0.3;
    const cp1x = p1.x + (dx1 * tension) / 3;
    const cp1y = p1.y + (dy1 * tension) / 3;
    const cp2x = p2.x - (dx2 * tension) / 3;
    const cp2y = p2.y - (dy2 * tension) / 3;
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

function updateCurvePoint(curve: ChannelCurve, index: number, newX: number, newY: number): ChannelCurve {
  const next = curve.map((point) => [...point] as [number, number]);
  const clampedY = clamp(newY, 0, DATA_MAX);
  const prevX = index > 0 ? next[index - 1]![0] : 0;
  const nextX = index < next.length - 1 ? next[index + 1]![0] : DATA_MAX;
  const clampedX = clamp(newX, prevX + 1, nextX - 1);
  next[index] = [clampedX, clampedY];
  return next;
}

function deleteCurvePoint(curve: ChannelCurve, index: number): ChannelCurve {
  if (index <= 0 || index >= curve.length - 1 || curve.length <= 2) return curve;
  return curve.filter((_, pointIndex) => pointIndex !== index).map((point) => [...point] as [number, number]);
}

function insertCurvePoint(curve: ChannelCurve, newX: number, newY: number): { curve: ChannelCurve; index: number } | null {
  if (curve.length >= MAX_CONTROL_POINTS) return null;
  const next = curve.map((point) => [...point] as [number, number]);
  const x = clamp(newX, 1, DATA_MAX - 1);
  const y = clamp(newY, 0, DATA_MAX);
  let insertIndex = next.findIndex((point) => point[0] >= x);
  if (insertIndex < 0) insertIndex = next.length;
  if (insertIndex === 0 || insertIndex >= next.length) return null;
  const prevX = next[insertIndex - 1]![0];
  const nextX = next[insertIndex]![0];
  if (nextX - prevX <= 1) return null;
  const clampedX = clamp(x, prevX + 1, nextX - 1);
  next.splice(insertIndex, 0, [clampedX, y]);
  return { curve: next, index: insertIndex };
}

function interpolateCurveY(curve: ChannelCurve, x: number): number {
  if (curve.length === 0) return 0;
  if (x <= curve[0]![0]) return curve[0]![1];
  for (let index = 1; index < curve.length; index += 1) {
    const prev = curve[index - 1]!;
    const next = curve[index]!;
    if (x <= next[0]) {
      const span = next[0] - prev[0];
      const t = span <= 0 ? 0 : (x - prev[0]) / span;
      return prev[1] + (next[1] - prev[1]) * t;
    }
  }
  return curve[curve.length - 1]![1];
}

function computeLuminanceData(histogram: HistogramPayload): number[] {
  return histogram.channels.r.normalized.map((rVal, index) => {
    const gVal = histogram.channels.g.normalized[index] ?? 0;
    const bVal = histogram.channels.b.normalized[index] ?? 0;
    return 0.2126 * rVal + 0.7152 * gVal + 0.0722 * bVal;
  });
}

function histogramFillPath(data: number[], maxVal: number): string {
  if (data.length === 0) return "";
  const n = data.length - 1;
  const bottom = SIZE;
  const scale = maxVal > 0 ? (SIZE * 0.35) / maxVal : 0;
  let d = `M 0 ${bottom}`;
  for (let index = 0; index <= n; index += 1) {
    const x = (index / n) * SIZE;
    const y = SIZE - data[index] * scale;
    d += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  d += ` L ${SIZE} ${bottom} Z`;
  return d;
}

export function CurveEditor({ curves, onChange, disabled, histogram }: CurvesEditorProps) {
  const [visibleChannels, setVisibleChannels] = useState<Record<ChannelKey, boolean>>({ r: true, g: true, b: true, l: false });
  const [selected, setSelected] = useState<{ channel: ChannelKey; index: number } | null>(null);
  const [dragTooltip, setDragTooltip] = useState<{ x: number; y: number; value: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const curvesRef = useRef(curves);
  curvesRef.current = curves;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const channels: ChannelKey[] = ["r", "g", "b", "l"];

  const resolveDataPoint = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const svgX = (clientX - rect.left) * (SIZE / rect.width);
    const svgY = (clientY - rect.top) * (SIZE / rect.height);
    const dataX = toDataX(svgX);
    const dataY = toDataY(svgY);
    return { dataX, dataY, displayX: toSvgX(dataX), displayY: toSvgY(dataY) };
  }, []);

  const beginDrag = useCallback((channel: ChannelKey, index: number) => {
    const move = (pointerEvent: PointerEvent) => {
      const point = resolveDataPoint(pointerEvent.clientX, pointerEvent.clientY);
      if (!point) return;
      const { dataX, dataY, displayX, displayY } = point;
      setDragTooltip({ x: displayX, y: displayY, value: dataY });
      setSelected({ channel, index });
      const currentCurve = curvesRef.current[channel];
      if (!currentCurve) return;
      const updated = updateCurvePoint(currentCurve, index, dataX, dataY);
      onChangeRef.current({ ...curvesRef.current, [channel]: updated }, { interaction: "drag" });
    };

    const stop = () => {
      setDragTooltip(null);
      window.removeEventListener("pointermove", move);
      onChangeRef.current({ ...curvesRef.current }, { interaction: "commit" });
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  }, [resolveDataPoint]);

  function toggleChannel(channel: ChannelKey) {
    setVisibleChannels((current) => ({ ...current, [channel]: !current[channel] }));
  }

  const handlePointerDown = useCallback(
    (channel: ChannelKey, index: number) => (event: ReactPointerEvent<SVGCircleElement>) => {
      if (disabled) return;
      event.preventDefault();
      event.stopPropagation();
      setSelected({ channel, index });
      beginDrag(channel, index);
    },
    [beginDrag, disabled],
  );

  const handlePointDoubleClick = useCallback(
    (channel: ChannelKey, index: number) => (event: ReactPointerEvent<SVGCircleElement>) => {
      if (disabled) return;
      event.preventDefault();
      event.stopPropagation();
      const updated = deleteCurvePoint(curvesRef.current[channel], index);
      if (updated === curvesRef.current[channel]) return;
      setSelected(null);
      onChangeRef.current({ ...curvesRef.current, [channel]: updated }, { interaction: "edit" });
    },
    [disabled],
  );

  const pickInsertChannel = useCallback((dataX: number, dataY: number): ChannelKey | null => {
    const selectedChannel = selected?.channel;
    if (selectedChannel && visibleChannels[selectedChannel]) {
      return selectedChannel;
    }

    let bestChannel: ChannelKey | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const channel of channels) {
      if (!visibleChannels[channel]) continue;
      const curve = curvesRef.current[channel];
      if (!curve || curve.length >= MAX_CONTROL_POINTS) continue;
      const curveY = interpolateCurveY(curve, dataX);
      const distance = Math.abs(curveY - dataY);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestChannel = channel;
      }
    }
    return bestChannel;
  }, [channels, selected?.channel, visibleChannels]);

  const handleSvgPointerDown = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    if (disabled) return;
    if (event.target instanceof SVGCircleElement) return;
    const point = resolveDataPoint(event.clientX, event.clientY);
    if (!point) return;
    const channel = pickInsertChannel(point.dataX, point.dataY);
    if (!channel) return;
    const inserted = insertCurvePoint(curvesRef.current[channel], point.dataX, point.dataY);
    if (!inserted) return;
    event.preventDefault();
    const nextCurves = { ...curvesRef.current, [channel]: inserted.curve };
    setSelected({ channel, index: inserted.index });
    onChangeRef.current(nextCurves, { interaction: "drag" });
    beginDrag(channel, inserted.index);
  }, [beginDrag, disabled, pickInsertChannel, resolveDataPoint]);

  const histData: Partial<Record<ChannelKey, { path: string; color: string }>> = useMemo(() => {
    const result: Partial<Record<ChannelKey, { path: string; color: string }>> = {};
    if (!histogram) return result;
    for (const channel of channels) {
      if (!visibleChannels[channel]) continue;
      const data = channel === "l"
        ? computeLuminanceData(histogram)
        : [...histogram.channels[channel].normalized];
      if (data.length === 0) continue;
      const maxVal = Math.max(...data, 1e-6);
      result[channel] = { path: histogramFillPath(data, maxVal), color: CHANNEL_COLORS[channel] };
    }
    return result;
  }, [histogram, visibleChannels]);

  return (
    <div className="pc-curve-editor" data-testid="curve-editor">
      <div className="pc-curve-channels">
        {channels.map((channel) => (
          <button
            key={channel}
            className={`pc-curve-channel-btn ${visibleChannels[channel] ? "is-active" : ""}`}
            style={{ borderColor: visibleChannels[channel] ? CHANNEL_COLORS[channel] : undefined }}
            onClick={() => toggleChannel(channel)}
            type="button"
          >
            <span className="pc-curve-channel-dot" style={{ backgroundColor: CHANNEL_COLORS[channel] }} />
            {CHANNEL_LABELS[channel]}
          </button>
        ))}
      </div>
      <svg
        ref={svgRef}
        className="pc-curve-svg"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label="Curve editor"
        onPointerDown={handleSvgPointerDown}
      >
        <rect x="0" y="0" width={SIZE} height={SIZE} fill="var(--bg)" />

        {[1, 2, 3].map((index) => {
          const pos = (index / 4) * SIZE;
          return (
            <g key={`grid-${index}`}>
              <line x1={pos} y1={0} x2={pos} y2={SIZE} className="pc-curve-grid-line" />
              <line x1={0} y1={pos} x2={SIZE} y2={pos} className="pc-curve-grid-line" />
            </g>
          );
        })}

        <line x1={0} y1={SIZE} x2={SIZE} y2={0} className="pc-curve-diagonal" />

        {Object.entries(histData).map(([channel, { path, color }]) => (
          <path key={`hist-${channel}`} d={path} fill={color} fillOpacity={0.12} stroke="none" />
        ))}

        {channels.map((channel) =>
          visibleChannels[channel] ? (
            <path key={`path-${channel}`} d={smoothCurvePath(curves[channel])} fill="none" stroke={CHANNEL_COLORS[channel]} strokeWidth="2" />
          ) : null,
        )}

        {channels.map((channel) =>
          visibleChannels[channel]
            ? curves[channel].map((point, index) => {
                const isSelected = selected?.channel === channel && selected?.index === index;
                return (
                  <circle
                    className={`pc-curve-point ${isSelected ? "is-selected" : ""}`}
                    key={`point-${channel}-${index}`}
                    cx={toSvgX(point[0])}
                    cy={toSvgY(point[1])}
                    data-testid={`curve-point-${channel}-${index}`}
                    fill={CHANNEL_COLORS[channel]}
                    onDoubleClick={handlePointDoubleClick(channel, index)}
                    onPointerDown={handlePointerDown(channel, index)}
                    r={isSelected ? POINT_RADIUS_SELECTED : POINT_RADIUS}
                    stroke="white"
                    strokeWidth={isSelected ? 2.5 : 1.5}
                  />
                );
              })
            : null,
        )}

        {dragTooltip ? (
          <g className="pc-curve-tooltip">
            <rect x={clamp(dragTooltip.x - 20, 0, SIZE - 40)} y={clamp(dragTooltip.y - 28, 0, SIZE - 22)} width="40" height="18" rx="4" />
            <text x={clamp(dragTooltip.x, 20, SIZE - 20)} y={clamp(dragTooltip.y - 15, 13, SIZE - 9)} textAnchor="middle">
              {dragTooltip.value}
            </text>
          </g>
        ) : null}
      </svg>
    </div>
  );
}
