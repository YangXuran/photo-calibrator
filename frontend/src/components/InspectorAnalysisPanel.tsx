import type { WorkbenchController } from "../hooks/useWorkbench";
import { AnalysisChartsSection } from "./AnalysisChartsSection";
import { AnalysisMetricsGrid } from "./AnalysisMetricsGrid";
import { InspectorPanelSections } from "./InspectorPanelSections";

type InspectorAnalysisPanelProps = {
  order?: string[];
  workbench: WorkbenchController;
};

export function InspectorAnalysisPanel({ order, workbench }: InspectorAnalysisPanelProps) {
  const selectedFile = workbench.selectedFile;
  const result = selectedFile?.result;
  const collapseScope = "workbench";

  return (
    <InspectorPanelSections
      order={order}
      sections={[
        {
          key: "metrics",
          visible: workbench.preferences.showAnalysisMetrics,
          content: <AnalysisMetricsGrid capabilities={workbench.capabilities} result={result} selectedFile={selectedFile} />,
        },
        {
          key: "charts",
          visible: workbench.preferences.showAnalysisCharts,
          content: <AnalysisChartsSection collapseScope={collapseScope} result={result} />,
        },
      ]}
    />
  );
}
