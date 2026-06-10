import type { CalibrationPayload, CapabilityPayload, WorkspaceFile } from "../types";
import { fmt } from "../lib/format";
import { getWorkspaceStateSummary } from "../lib/workspaceStatus";
import { StatCard } from "./StatCard";

type AnalysisMetricsGridProps = {
  result?: CalibrationPayload;
  selectedFile?: WorkspaceFile;
  capabilities?: CapabilityPayload | null;
};

export function AnalysisMetricsGrid({ result, selectedFile, capabilities }: AnalysisMetricsGridProps) {
  const summary = getWorkspaceStateSummary(selectedFile);
  const neutralCoverage = result?.charts?.neutral_mask?.coverage;

  return (
    <section className="pc-stat-grid">
      <StatCard label="Original |dE|" tone="accent" value={fmt(result?.input.lab.strength)} />
      <StatCard label="Calibrated |dE|" value={fmt(result?.output.lab.strength)} />
      <StatCard label="Reduction" value={result ? `${fmt(result.reduction_pct, 0)}%` : "-"} />
      <StatCard label="Direction" value={result?.input.direction ?? "-"} />
      <StatCard label="CCC" value={fmt(result?.charts?.ccc?.d_sigma, 2)} />
      <StatCard label="PCI" value={fmt(result?.charts?.pci?.value, 2)} />
      <StatCard label="Analysis" value={result?.processing?.analysis_width && result.processing.analysis_height ? `${result.processing.analysis_width}x${result.processing.analysis_height}` : "-"} />
      <StatCard label="Color Space" value={summary.colorSpaceLabel} />
      <StatCard label="Accelerator" value={result?.processing?.accelerator_backend ?? capabilities?.accelerator?.backend ?? "-"} />
      {neutralCoverage != null ? <StatCard label="Neutral" value={`${(neutralCoverage * 100).toFixed(1)}%`} /> : null}
    </section>
  );
}
