import type { WorkbenchController } from "../hooks/useWorkbench";
import { InspectorPaneContent } from "./InspectorPaneContent";
import { InspectorPaneHeader } from "./InspectorPaneHeader";
import { SidePaneShell } from "./SidePaneShell";

type InspectorPaneProps = {
  workbench: WorkbenchController;
};

export function InspectorPane({ workbench }: InspectorPaneProps) {
  const selectedFile = workbench.selectedFile;

  return (
    <SidePaneShell
      header={<InspectorPaneHeader activeTab={workbench.activeInspectorTab} onChangeTab={workbench.setActiveInspectorTab} selectedFile={selectedFile} />}
      side="right"
      testId="inspector-pane"
    >
      <InspectorPaneContent workbench={workbench} />
    </SidePaneShell>
  );
}
