import type { WorkbenchController } from "../hooks/useWorkbench";
import { getInspectorPanePresentation, getInspectorSectionOrder } from "../lib/layoutPresets";
import { ComposeToolPanel } from "./ComposeToolPanel";
import { CurvesToolPanel } from "./CurvesToolPanel";
import { PaneGroup } from "./PaneGroup";
import { InspectorAdjustPanel } from "./InspectorAdjustPanel";
import { InspectorAIPanel } from "./InspectorAIPanel";
import { InspectorExportPanel } from "./InspectorExportPanel";
import { InspectorSessionPanel } from "./InspectorSessionPanel";
import { InspectorSettingsPanel } from "./InspectorSettingsPanel";

type InspectorPaneContentProps = {
  workbench: WorkbenchController;
};

export function InspectorPaneContent({ workbench }: InspectorPaneContentProps) {
  const presentation = getInspectorPanePresentation(workbench.activeInspectorTab);
  const sectionOrder = getInspectorSectionOrder(workbench.activeInspectorTab);

  return (
    <PaneGroup
      density={presentation.density}
      emphasis={presentation.emphasis}
      testId="inspector-pane-group"
    >
      {workbench.activeInspectorTab === "adjust" ? <InspectorAdjustPanel order={sectionOrder} workbench={workbench} /> : null}
      {workbench.activeInspectorTab === "curves" ? <CurvesToolPanel workbench={workbench} /> : null}
      {workbench.activeInspectorTab === "compose" ? <ComposeToolPanel workbench={workbench} /> : null}
      {workbench.activeInspectorTab === "ai" ? <InspectorAIPanel order={sectionOrder} workbench={workbench} /> : null}
      {workbench.activeInspectorTab === "export" ? <InspectorExportPanel order={sectionOrder} workbench={workbench} /> : null}
      {workbench.activeInspectorTab === "session" ? <InspectorSessionPanel order={sectionOrder} workbench={workbench} /> : null}
      {workbench.activeInspectorTab === "settings" ? <InspectorSettingsPanel aiSettings={workbench.aiSettings} onAISettingsChange={workbench.setAISettings} workbench={workbench} /> : null}
    </PaneGroup>
  );
}
