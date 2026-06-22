import type { WorkbenchController } from "../hooks/useWorkbench";
import { InspectorPaneContent } from "./InspectorPaneContent";
import { InspectorTabs } from "./InspectorTabs";
import { SidePaneShell } from "./SidePaneShell";

type InspectorPaneProps = {
  workbench: WorkbenchController;
};

export function InspectorPane({ workbench }: InspectorPaneProps) {
  return (
    <SidePaneShell
      header={null}
      side="right"
      testId="inspector-pane"
    >
      <div className="pc-inspector-body">
        <InspectorTabs active={workbench.activeInspectorTab} onChange={workbench.setActiveInspectorTab} />
        <div className="pc-inspector-content">
          <InspectorPaneContent workbench={workbench} />
        </div>
      </div>
    </SidePaneShell>
  );
}
