import type { CalibrationPayload, CapabilityPayload, WorkspaceFile } from "../types";
import { getWorkspaceStateSummary } from "../lib/workspaceStatus";
import { InfoGrid } from "./InfoGrid";
import { PaneSection } from "./PaneSection";

type AnalysisContextSectionProps = {
  collapseScope?: string;
  selectedFile?: WorkspaceFile;
  result?: CalibrationPayload;
  capabilities?: CapabilityPayload | null;
};

export function AnalysisContextSection({ collapseScope, selectedFile, result, capabilities }: AnalysisContextSectionProps) {
  const summary = getWorkspaceStateSummary(selectedFile);
  const neutralCoverage = result?.charts?.neutral_mask?.coverage;

  return (
    <PaneSection
      collapseStorageScope={collapseScope}
      collapseStorageKey="inspector-analysis-context"
      collapsible
      defaultCollapsed
      testId="analysis-context-section"
      title="处理上下文"
    >
      <InfoGrid
        items={[
          { label: "Session", value: selectedFile?.sessionId ?? "-" },
          { label: "Accelerator", value: result?.processing?.accelerator_backend ?? capabilities?.accelerator?.backend ?? "-" },
          { label: "Color Space", value: summary.colorSpaceLabel },
          { label: "Preview", value: summary.previewLabel },
          { label: "Crop", value: summary.cropLabel },
          { label: "Neutral Coverage", value: neutralCoverage != null ? `${(neutralCoverage * 100).toFixed(1)}%` : "-" },
        ]}
      />
    </PaneSection>
  );
}
