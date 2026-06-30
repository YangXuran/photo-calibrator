import type { LutVectorPoint } from "../types";
import { t } from "../i18n";
import { EmptyPanel } from "./EmptyPanel";

type ChromaticityChartProps = {
  vectors?: LutVectorPoint[];
  loading?: boolean;
};

const SIZE = 280;
const CENTER = SIZE / 2;
const RINGS = [20, 40, 60, 80];
const LAB_SCALE = 1.8;

function hueToColor(hueAngle: number): string {
  const normalized = ((hueAngle % 360) + 360) % 360;
  return `hsl(${normalized.toFixed(0)}, 78%, 62%)`;
}

function labToSvg(a: number, b: number): { x: number; y: number } {
  return {
    x: CENTER + a * LAB_SCALE,
    y: CENTER - b * LAB_SCALE,
  };
}

export function ChromaticityChart({ vectors, loading }: ChromaticityChartProps) {
  if (loading) {
    return (
      <svg
        className="pc-chart pc-chromaticity-chart"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={t("labels.lutVectorscopeLoading")}
        data-testid="chromaticity-chart"
      >
        {RINGS.map((radius) => (
          <circle
            key={radius}
            cx={CENTER}
            cy={CENTER}
            r={radius}
            fill="none"
            stroke="var(--line-soft)"
            strokeWidth="1"
            className="pc-chromaticity-pulse"
            style={{ animationDelay: `${radius * 15}ms` }}
          />
        ))}
        <line x1={0} y1={CENTER} x2={SIZE} y2={CENTER} stroke="var(--line-soft)" strokeWidth="1" />
        <line x1={CENTER} y1={0} x2={CENTER} y2={SIZE} stroke="var(--line-soft)" strokeWidth="1" />
      </svg>
    );
  }

  if (!vectors?.length) {
    return (
      <div data-testid="chromaticity-chart">
        <EmptyPanel>{t("labels.noLutAnalysis")}</EmptyPanel>
      </div>
    );
  }

  return (
    <svg
      className="pc-chart pc-chromaticity-chart"
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={t("labels.lutHueVectorscope")}
      data-testid="chromaticity-chart"
    >
      {RINGS.map((radius) => (
        <circle key={radius} cx={CENTER} cy={CENTER} r={radius} className="pc-chromaticity-ring" />
      ))}

      <line x1={0} y1={CENTER} x2={SIZE} y2={CENTER} className="pc-chromaticity-axis" />
      <line x1={CENTER} y1={0} x2={CENTER} y2={SIZE} className="pc-chromaticity-axis" />

      <text x={SIZE - 14} y={CENTER - 6} className="pc-chromaticity-label">a*</text>
      <text x={CENTER + 6} y={14} className="pc-chromaticity-label">b*</text>

      <circle cx={CENTER} cy={CENTER} r="2.5" fill="var(--muted)" />

      <defs>
        <marker
          id="pc-arrow-head"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--text)" />
        </marker>
      </defs>

      {vectors.map((vector, index) => {
        const from = labToSvg(vector.a_before, vector.b_before);
        const to = labToSvg(vector.a_after, vector.b_after);
        const color = hueToColor(vector.hue_angle);
        const opacity = Math.max(0.3, Math.min(1, vector.saturation));
        return (
          <g key={`vector-${index}`}>
            <line
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke={color}
              strokeWidth="2"
              opacity={opacity}
              markerEnd="url(#pc-arrow-head)"
            />
            <circle cx={from.x} cy={from.y} r="2.5" fill={color} opacity={opacity * 0.6} />
          </g>
        );
      })}
    </svg>
  );
}
