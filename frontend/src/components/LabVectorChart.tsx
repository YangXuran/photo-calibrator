import type { LabVector } from "../types";
import { EmptyPanel } from "./EmptyPanel";

type LabVectorChartProps = {
  vectors?: LabVector[];
};

const COLORS = ["#f8fafc", "#60a5fa", "#f59e0b", "#fb7185"];

export function LabVectorChart({ vectors }: LabVectorChartProps) {
  const size = 240;
  const center = size / 2;
  const scale = 2.1;
  if (!vectors?.length) return <EmptyPanel>暂无 Lab 向量</EmptyPanel>;

  return (
    <div className="pc-lab-wrap">
      <svg className="pc-chart pc-lab-chart" viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Lab vector plot">
        <line x1={0} y1={center} x2={size} y2={center} className="pc-grid-line" />
        <line x1={center} y1={0} x2={center} y2={size} className="pc-grid-line" />
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
