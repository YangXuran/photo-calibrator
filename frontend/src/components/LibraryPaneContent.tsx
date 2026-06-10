import type { WorkbenchController } from "../hooks/useWorkbench";
import { AnalysisChartsSection } from "./AnalysisChartsSection";

type LibraryPaneContentProps = {
  workbench: WorkbenchController;
};

export function LibraryPaneContent({ workbench }: LibraryPaneContentProps) {
  const result = workbench.selectedFile?.result;
  return (
    <AnalysisChartsSection collapseScope="workbench" result={result} />
  );
}
