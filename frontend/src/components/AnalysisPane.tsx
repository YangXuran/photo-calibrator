import type { WorkbenchController } from "../hooks/useWorkbench";
import { AnalysisChartsSection } from "./AnalysisChartsSection";
import { SidePaneShell } from "./SidePaneShell";

type AnalysisPaneProps = {
  workbench: WorkbenchController;
};

export function AnalysisPane({ workbench }: AnalysisPaneProps) {
  return (
    <SidePaneShell header={null} side="left" testId="analysis-pane">
      <AnalysisChartsSection collapseScope="workbench" result={workbench.selectedFile?.result} />
    </SidePaneShell>
  );
}
