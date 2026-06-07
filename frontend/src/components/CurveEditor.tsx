import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { ChannelCurve, ManualCurves } from "../types";

type CurveEditorProps = {
  curves: ManualCurves;
  onChange: (curves: ManualCurves) => void;
  disabled?: boolean;
};

type ChannelKey = "r" | "g" | "b";

const SIZE = 280;
const DATA_MAX = 255;
const POINT_RADIUS = 5;
const POINT_RADIUS_SELECTED = 7;

const CHANNEL_COLORS: Record<ChannelKey, string> = {
  r: "#e53e3e",
  g: "#38a169",
  b: "#3182ce",
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

function curveToPath(curve: ChannelCurve): string {
  if (curve.length < 2) return "";
  return curve
    .map((point, index) => {
      const x = toSvgX(point[0]);
      const y = toSvgY(point[1]);
      return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
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

export function CurveEditor({ curves, onChange, disabled }: CurveEditorProps) {
  const [visibleChannels, setVisibleChannels] = useState<Record<ChannelKey, boolean>>({ r: true, g: true, b: true });
  const [selected, setSelected] = useState<{ channel: ChannelKey; index: number } | null>(null);
  const [dragTooltip, setDragTooltip] = useState<{ x: number; y: number; value: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const curvesRef = useRef(curves);
  curvesRef.current = curves;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const channels: ChannelKey[] = ["r", "g", "b"];

  function toggleChannel(channel: ChannelKey) {
    setVisibleChannels((current) => ({ ...current, [channel]: !current[channel] }));
  }

  const handlePointerDown = useCallback(
    (channel: ChannelKey, index: number) => (event: ReactPointerEvent<SVGCircleElement>) => {
      if (disabled) return;
      event.preventDefault();
      event.stopPropagation();
      setSelected({ channel, index });

      const svg = svgRef.current;
      if (!svg) return;

      const resolveDataPoint = (clientX: number, clientY: number) => {
        const rect = svg.getBoundingClientRect();
        const svgX = (clientX - rect.left) * (SIZE / rect.width);
        const svgY = (clientY - rect.top) * (SIZE / rect.height);
        const dataX = toDataX(svgX);
        const dataY = toDataY(svgY);
        return { dataX, dataY, displayX: toSvgX(dataX), displayY: toSvgY(dataY) };
      };

      const move = (pointerEvent: PointerEvent) => {
        const { dataX, dataY, displayX, displayY } = resolveDataPoint(pointerEvent.clientX, pointerEvent.clientY);
        setDragTooltip({ x: displayX, y: displayY, value: dataY });

        const currentCurve = curvesRef.current[channel];
        if (!currentCurve) return;
        const updated = updateCurvePoint(currentCurve, index, dataX, dataY);
        onChangeRef.current({ ...curvesRef.current, [channel]: updated });
      };

      const stop = () => {
        setDragTooltip(null);
        window.removeEventListener("pointermove", move);
      };

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", stop, { once: true });
    },
    [disabled],
  );

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
            {channel.toUpperCase()}
          </button>
        ))}
      </div>
      <svg
        ref={svgRef}
        className="pc-curve-svg"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label="RGB curve editor"
      >
        <rect x="0" y="0" width={SIZE} height={SIZE} fill="var(--bg)" />

        {[1, 2, 3].map((i) => {
          const pos = (i / 4) * SIZE;
          return (
            <g key={`grid-${i}`}>
              <line x1={pos} y1={0} x2={pos} y2={SIZE} className="pc-curve-grid-line" />
              <line x1={0} y1={pos} x2={SIZE} y2={pos} className="pc-curve-grid-line" />
            </g>
          );
        })}

        <line x1={0} y1={SIZE} x2={SIZE} y2={0} className="pc-curve-diagonal" />

        {channels.map((channel) =>
          visibleChannels[channel] ? (
            <path key={`path-${channel}`} d={curveToPath(curves[channel])} fill="none" stroke={CHANNEL_COLORS[channel]} strokeWidth="2" />
          ) : null,
        )}

        {channels.map((channel) =>
          visibleChannels[channel]
            ? curves[channel].map((point, index) => {
                const isSelected = selected?.channel === channel && selected?.index === index;
                return (
                  <circle
                    key={`point-${channel}-${index}`}
                    data-testid={`curve-point-${channel}-${index}`}
                    cx={toSvgX(point[0])}
                    cy={toSvgY(point[1])}
                    r={isSelected ? POINT_RADIUS_SELECTED : POINT_RADIUS}
                    fill={CHANNEL_COLORS[channel]}
                    stroke="var(--text)"
                    strokeWidth={isSelected ? 2 : 1}
                    className="pc-curve-point"
                    onPointerDown={handlePointerDown(channel, index)}
                  />
                );
              })
            : null,
        )}

        {dragTooltip ? (
          <g className="pc-curve-tooltip">
            <rect
              x={dragTooltip.x + 10}
              y={dragTooltip.y - 24}
              width={42}
              height={20}
              rx={4}
              fill="rgba(0,0,0,0.8)"
              stroke="var(--line)"
              strokeWidth={1}
            />
            <text
              x={dragTooltip.x + 31}
              y={dragTooltip.y - 10}
              textAnchor="middle"
              fill="var(--text)"
              fontSize="11"
            >
              {dragTooltip.value}
            </text>
          </g>
        ) : null}
      </svg>
    </div>
  );
}
