import type { LutVectorPoint } from "../types";
import { t } from "../i18n";
import { EmptyPanel } from "./EmptyPanel";

type LutRadarChartProps = {
  vectors?: LutVectorPoint[];
};

const SIZE = 260;
const CENTER = SIZE / 2;
const RADIUS = 100;
const LABEL_R = 115;

function polarX(angleDeg: number, r: number): number {
  return CENTER + r * Math.cos((angleDeg - 90) * (Math.PI / 180));
}

function polarY(angleDeg: number, r: number): number {
  return CENTER + r * Math.sin((angleDeg - 90) * (Math.PI / 180));
}

export function LutRadarChart({ vectors }: LutRadarChartProps) {
  if (!vectors?.length) return <EmptyPanel>{t("analysis.noLutMap")}</EmptyPanel>;

  const byHue = new Map<number, { a_before: number; b_before: number; a_after: number; b_after: number; saturation: number }>();
  for (const v of vectors) {
    const hue = Math.round(v.hue_angle / 15) * 15;
    const prev = byHue.get(hue);
    if (!prev || v.saturation > prev.saturation) {
      byHue.set(hue, { a_before: v.a_before, b_before: v.b_before, a_after: v.a_after, b_after: v.b_after, saturation: v.saturation });
    }
  }

  const entries = [...byHue.entries()].sort((a, b) => a[0] - b[0]);
  if (entries.length < 3) return <EmptyPanel>{t("analysis.insufficientLut")}</EmptyPanel>;

  const maxDelta = Math.max(...entries.map(([, v]) => {
    const before = Math.sqrt(v.a_before ** 2 + v.b_before ** 2);
    const after = Math.sqrt(v.a_after ** 2 + v.b_after ** 2);
    return Math.max(before, after, 1);
  }));

  const scale = RADIUS / maxDelta;

  const beforePath = entries.map(([hue, v]) => {
    const r = Math.sqrt(v.a_before ** 2 + v.b_before ** 2) * scale;
    return `${hue === entries[0][0] ? "M" : "L"} ${polarX(hue, r).toFixed(1)} ${polarY(hue, r).toFixed(1)}`;
  }).join(" ") + " Z";

  const afterPath = entries.map(([hue, v]) => {
    const r = Math.sqrt(v.a_after ** 2 + v.b_after ** 2) * scale;
    return `${hue === entries[0][0] ? "M" : "L"} ${polarX(hue, r).toFixed(1)} ${polarY(hue, r).toFixed(1)}`;
  }).join(" ") + " Z";

  const gridRings = [0.25, 0.5, 0.75, 1.0];
  const gridPaths = gridRings.map((pct) => {
    const r = RADIUS * pct;
    return entries.map(([hue]) => {
      return `${hue === entries[0][0] ? "M" : "L"} ${polarX(hue, r).toFixed(1)} ${polarY(hue, r).toFixed(1)}`;
    }).join(" ");
  });

  return (
    <svg className="pc-chart" data-testid="lut-radar-chart" viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={t("labels.lutRadarChart")}>
      {gridRings.map((pct, i) => (
        <circle key={i} cx={CENTER} cy={CENTER} r={RADIUS * pct} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
      ))}

      {gridPaths.map((p, i) => (
        <path key={i} d={`${p} Z`} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
      ))}

      {entries.map(([hue]) => (
        <line key={`axis-${hue}`} x1={CENTER} y1={CENTER} x2={polarX(hue, RADIUS)} y2={polarY(hue, RADIUS)} stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
      ))}

      <path d={beforePath} fill="rgba(251, 113, 133, 0.15)" stroke="#fb7185" strokeWidth="1.5" />
      <path d={afterPath} fill="rgba(96, 165, 250, 0.15)" stroke="#60a5fa" strokeWidth="1.5" />

      {[0, 90, 180, 270].map((deg) => (
        <text key={deg} x={polarX(deg, LABEL_R)} y={polarY(deg, LABEL_R)} textAnchor="middle" dominantBaseline="middle" fill="var(--muted)" fontSize="9">
          {deg}°
        </text>
      ))}

      <circle cx={CENTER} cy={CENTER} r="2" fill="var(--muted)" />
    </svg>
  );
}
