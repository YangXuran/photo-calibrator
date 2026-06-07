import type { WorkbenchController } from "../hooks/useWorkbench";
import { AIReviewCard } from "./AIReviewCard";
import { AnalysisChartsSection } from "./AnalysisChartsSection";
import { AnalysisContextSection } from "./AnalysisContextSection";
import { AnalysisMetricsGrid } from "./AnalysisMetricsGrid";
import { InspectorPanelSections } from "./InspectorPanelSections";

type InspectorAnalysisPanelProps = {
  order?: string[];
  workbench: WorkbenchController;
};

export function InspectorAnalysisPanel({ order, workbench }: InspectorAnalysisPanelProps) {
  const selectedFile = workbench.selectedFile;
  const result = selectedFile?.result;
  const collapseScope = `preset:${workbench.activeLayoutPreset}`;

  return (
    <InspectorPanelSections
      order={order}
      sections={[
        {
          key: "metrics",
          visible: workbench.preferences.showAnalysisMetrics,
          content: <AnalysisMetricsGrid result={result} />,
        },
        {
          key: "charts",
          visible: workbench.preferences.showAnalysisCharts,
          content: <AnalysisChartsSection collapseScope={collapseScope} result={result} />,
        },
        {
          key: "context",
          visible: workbench.preferences.showAnalysisContext,
          content: <AnalysisContextSection capabilities={workbench.capabilities} collapseScope={collapseScope} result={result} selectedFile={selectedFile} />,
        },
        {
          key: "ai-review",
          visible: workbench.preferences.showAnalysisAIReview,
          content: (
            <AIReviewCard
              actionState={workbench.actionStates.ai}
              collapseScope={collapseScope}
              context={workbench.aiContext}
              evaluators={workbench.evaluators}
              onEvaluate={workbench.runAIEvaluation}
              result={workbench.aiResult}
              selectedEvaluator={workbench.selectedEvaluator}
              setContext={workbench.setAiContext}
              setSelectedEvaluator={workbench.setSelectedEvaluator}
            />
          ),
        },
      ]}
    />
  );
}
