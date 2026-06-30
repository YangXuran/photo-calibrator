import type { LabVector } from "../types";
import { t } from "../i18n";
import { EmptyPanel } from "./EmptyPanel";

type LabVectorChartProps = {
  vectors?: LabVector[];
};

const COLORS = ["#f8fafc", "#60a5fa", "#f59e0b", "#fb7185"];

const TICK_VALUES = [-20, -15, -10, -5, 0, 5, 10, 15, 20];

export function LabVectorChart({ vectors }: LabVectorChartProps) {
  const size = 240;
  const center = size / 2;
  const scale = 4.5;
  if (!vectors?.length) return <EmptyPanel>{t("analysis.noLabVector")}</EmptyPanel>;

  return (
    <div className="pc-lab-wrap">
      <svg
        className="pc-chart pc-lab-chart"
        viewBox={`0 0 ${size} ${size}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={t("labels.labVectorPlot")}
      >
        {/* Grid lines */}
        <line x1={0} y1={center} x2={size} y2={center} className="pc-grid-line" />
        <line x1={center} y1={0} x2={center} y2={size} className="pc-grid-line" />

        {/* Tick marks and labels for a* axis (horizontal) */}
        {TICK_VALUES.filter((v) => v !== 0).map((v) => {
          const x = center + v * scale;
          if (x < 10 || x > size - 10) return null;
          return (
            <g key={`a-${v}`}>
              <line x1={x} y1={center - 3} x2={x} y2={center + 3} stroke="var(--muted)" strokeWidth="0.5" />
              <text x={x} y={center + 14} textAnchor="middle" fill="var(--muted)" fontSize="8">
                {v > 0 ? `+${v}` : v}
              </text>
            </g>
          );
        })}

        {/* Tick marks and labels for b* axis (vertical) */}
        {TICK_VALUES.filter((v) => v !== 0).map((v) => {
          const y = center - v * scale;
          if (y < 10 || y > size - 10) return null;
          return (
            <g key={`b-${v}`}>
              <line x1={center - 3} y1={y} x2={center + 3} y2={y} stroke="var(--muted)" strokeWidth="0.5" />
              <text x={center - 6} y={y + 3} textAnchor="end" fill="var(--muted)" fontSize="8">
                {v > 0 ? `+${v}` : v}
              </text>
            </g>
          );
        })}

        {/* Axis labels */}
        <text x={size - 8} y={center - 6} textAnchor="end" fill="var(--muted)" fontSize="9">a*</text>
        <text x={center + 8} y={12} textAnchor="start" fill="var(--muted)" fontSize="9">b*</text>

        {vectors.map((vector, index) => {
          const x = center + vector.a * scale;
          const y = center - vector.b * scale;
          return (
            <g key={`${vector.name}-${index}`}>
              <line x1={center} y1={center} x2={x} y2={y} stroke={COLORS[index % COLORS.length]} strokeWidth="2.5" />
              <circle cx={x} cy={y} r="4.5" fill={COLORS[index % COLORS.length]} />
            </g>
          );
        })}
      </svg>
      <div className="pc-legend">
        {vectors.map((vector, index) => (
          <div className="pc-legend-item" key={vector.name}>
            <span className="pc-legend-swatch" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
            <span>{vector.name}</span>
            <strong>
              a {vector.a.toFixed(1)} / b {vector.b.toFixed(1)}
            </strong>
          </div>
        ))}
      </div>
    </div>
  );
}
