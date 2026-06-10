import type { HistogramPayload } from "../types";
import { EmptyPanel } from "./EmptyPanel";

type HistogramChartProps = {
  histogram?: HistogramPayload;
  calibratedHistogram?: HistogramPayload;
  showCalibrated?: boolean;
};

// ── Gaussian kernel smoothing ──────────────────────────────────────────

function gaussianSmooth(data: number[], sigma: number = 1.5): number[] {
  const kernelSize = Math.ceil(sigma * 3) * 2 + 1;
  const half = Math.floor(kernelSize / 2);
  const kernel: number[] = [];
  let sum = 0;
  for (let i = -half; i <= half; i++) {
    const val = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel.push(val);
    sum += val;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;

  const result = new Array(data.length).fill(0);
  for (let i = 0; i < data.length; i++) {
    for (let j = 0; j < kernel.length; j++) {
      const idx = Math.min(Math.max(i + j - half, 0), data.length - 1);
      result[i] += data[idx] * kernel[j];
    }
  }
  return result;
}

// ── Layout constants ───────────────────────────────────────────────────

const MARGIN = { top: 8, right: 10, bottom: 28, left: 44 };
const SVG_W = 380;
const SVG_H = 160;
const PLOT_W = SVG_W - MARGIN.left - MARGIN.right;
const PLOT_H = SVG_H - MARGIN.top - MARGIN.bottom;
const X_LABELS = [0, 64, 128, 192, 255];

// ── SVG path builders ──────────────────────────────────────────────────

function linePath(values: number[], scale: number): string {
  if (!values.length) return "";
  const n = values.length - 1;
  return values
    .map((v, i) => {
      const x = MARGIN.left + (i / n) * PLOT_W;
      const y = MARGIN.top + PLOT_H - v * scale * PLOT_H;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function fillPath(values: number[], scale: number): string {
  if (!values.length) return "";
  const n = values.length - 1;
  const bottom = MARGIN.top + PLOT_H;
  const start = `M ${MARGIN.left} ${bottom}`;
  const curve = values
    .map((v, i) => {
      const x = MARGIN.left + (i / n) * PLOT_W;
      const y = MARGIN.top + PLOT_H - v * scale * PLOT_H;
      return `L ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
  const end = `L ${MARGIN.left + PLOT_W} ${bottom} Z`;
  return `${start} ${curve} ${end}`;
}

// ── Component ──────────────────────────────────────────────────────────

export function HistogramChart({ histogram, calibratedHistogram, showCalibrated }: HistogramChartProps) {
  const active = showCalibrated !== false && calibratedHistogram ? calibratedHistogram : histogram;
  if (!active) return <EmptyPanel>暂无直方图</EmptyPanel>;

  const { channels, bins } = active;

  // Apply Gaussian smoothing to each channel
  const smoothR = gaussianSmooth(channels.r.normalized);
  const smoothG = gaussianSmooth(channels.g.normalized);
  const smoothB = gaussianSmooth(channels.b.normalized);

  // Compute global max for Y-axis auto-scaling (prevent divide-by-zero)
  const globalMax = Math.max(
    ...smoothR,
    ...smoothG,
    ...smoothB,
    1e-6
  );
  const scale = 1 / globalMax;

  return (
    <svg
      className="pc-chart"
      viewBox={`0 0 ${SVG_W} ${SVG_H}`}
      role="img"
      aria-label="RGB histogram"
    >
      {/* ── Semi-transparent fills under each channel ── */}
      <path
        d={fillPath(smoothR, scale)}
        fill="#fb7185"
        fillOpacity={0.08}
        stroke="none"
      />
      <path
        d={fillPath(smoothG, scale)}
        fill="#34d399"
        fillOpacity={0.08}
        stroke="none"
      />
      <path
        d={fillPath(smoothB, scale)}
        fill="#60a5fa"
        fillOpacity={0.08}
        stroke="none"
      />

      {/* ── Channel line paths ── */}
      <path d={linePath(smoothR, scale)} className="pc-line-r" />
      <path d={linePath(smoothG, scale)} className="pc-line-g" />
      <path d={linePath(smoothB, scale)} className="pc-line-b" />

      {/* ── Y axis grid lines and labels ── */}
      {[0, 1, 2, 3, 4].map((i) => {
        const y = MARGIN.top + PLOT_H - (i / 4) * PLOT_H;
        return (
          <g key={`y-${i}`}>
            {i > 0 && (
              <line
                x1={MARGIN.left}
                y1={y}
                x2={MARGIN.left + PLOT_W}
                y2={y}
                className="pc-grid-line"
              />
            )}
            {/* Tick mark */}
            <line
              x1={MARGIN.left - 4}
              y1={y}
              x2={MARGIN.left}
              y2={y}
              stroke="var(--line)"
              strokeWidth={1}
            />
            {/* Label */}
            <text
              x={MARGIN.left - 8}
              y={y + 3}
              textAnchor="end"
              fill="#94a3b8"
              fontSize={13}
            >
              {Math.round((i / 4) * 100)}%
            </text>
          </g>
        );
      })}

      {/* ── X axis grid lines and labels ── */}
      {X_LABELS.map((val) => {
        const x = MARGIN.left + (val / (bins - 1 || 1)) * PLOT_W;
        return (
          <g key={`x-${val}`}>
            {/* Grid line */}
            <line
              x1={x}
              y1={MARGIN.top}
              x2={x}
              y2={MARGIN.top + PLOT_H}
              className="pc-grid-line"
            />
            {/* Tick mark */}
            <line
              x1={x}
              y1={MARGIN.top + PLOT_H}
              x2={x}
              y2={MARGIN.top + PLOT_H + 5}
              stroke="var(--line)"
              strokeWidth={1}
            />
            {/* Label */}
            <text
              x={x}
              y={MARGIN.top + PLOT_H + 18}
              textAnchor="middle"
              fill="#94a3b8"
              fontSize={13}
            >
              {val}
            </text>
          </g>
        );
      })}

      {/* ── Axis border lines ── */}
      {/* X axis */}
      <line
        x1={MARGIN.left}
        y1={MARGIN.top + PLOT_H}
        x2={MARGIN.left + PLOT_W}
        y2={MARGIN.top + PLOT_H}
        stroke="var(--line)"
        strokeWidth={1}
      />
      {/* Y axis */}
      <line
        x1={MARGIN.left}
        y1={MARGIN.top}
        x2={MARGIN.left}
        y2={MARGIN.top + PLOT_H}
        stroke="var(--line)"
        strokeWidth={1}
      />
    </svg>
  );
}
