import type { CalibrationPayload } from "../types";
import { fmt } from "../lib/format";
import { StatCard } from "./StatCard";

type AnalysisMetricsGridProps = {
  result?: CalibrationPayload;
};

export function AnalysisMetricsGrid({ result }: AnalysisMetricsGridProps) {
  return (
    <section className="pc-stat-grid">
      <StatCard label="Original |dE|" tone="accent" value={fmt(result?.input.lab.strength)} />
      <StatCard label="Calibrated |dE|" value={fmt(result?.output.lab.strength)} />
      <StatCard label="Reduction" value={result ? `${fmt(result.reduction_pct, 0)}%` : "-"} />
      <StatCard label="Direction" value={result?.input.direction ?? "-"} />
      <StatCard label="Analysis" value={result?.processing?.analysis_width && result.processing.analysis_height ? `${result.processing.analysis_width}x${result.processing.analysis_height}` : "-"} />
      <StatCard label="Preview" value={result?.processing?.preview_source ?? "-"} />
      <StatCard label="CCC" value={fmt(result?.charts?.ccc?.d_sigma, 2)} />
      <StatCard label="PCI" value={fmt(result?.charts?.pci?.value, 2)} />
    </section>
  );
}
