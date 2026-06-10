import type { ZoneDatum } from "../types";

type ZoneChartProps = {
  zones?: ZoneDatum[];
};

const ZONE_COLORS: Record<string, string> = {
  shadow: "#60a5fa",
  midtone: "#f59e0b",
  highlight: "#f8fafc",
};

export function ZoneChart({ zones }: ZoneChartProps) {
  if (!zones?.length) return null;

  const maxAB = Math.max(...zones.flatMap((z) => [Math.abs(z.a), Math.abs(z.b)]), 0.1);

  return (
    <div className="pc-bars">
      {zones.map((zone) => (
        <div className="pc-bar-row" key={zone.name}>
          <span className="pc-bar-label">{zone.name}</span>
          <div className="pc-bar-track">
            <div
              className="pc-bar-fill"
              style={{
                width: `${(Math.abs(zone.a) / maxAB) * 100}%`,
                background: ZONE_COLORS[zone.name] ?? "var(--muted)",
              }}
            />
            <div
              className="pc-bar-fill"
              style={{
                width: `${(Math.abs(zone.b) / maxAB) * 100}%`,
                background: ZONE_COLORS[zone.name] ?? "var(--muted)",
                opacity: 0.5,
                marginTop: 2,
              }}
            />
          </div>
          <span className="pc-bar-value">
            a {zone.a.toFixed(1)} / b {zone.b.toFixed(1)}
          </span>
        </div>
      ))}
    </div>
  );
}
