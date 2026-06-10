import type { WorkbenchController } from "../hooks/useWorkbench";
import { AIReviewCard } from "./AIReviewCard";
import { InspectorPanelSections } from "./InspectorPanelSections";

type InspectorAIPanelProps = {
  order?: string[];
  workbench: WorkbenchController;
};

export function InspectorAIPanel({ order, workbench }: InspectorAIPanelProps) {
  const collapseScope = "workbench";

  return (
    <InspectorPanelSections
      order={order}
      sections={[
        {
          key: "ai-review",
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
