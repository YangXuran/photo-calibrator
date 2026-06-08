import type { WorkbenchController } from "../hooks/useWorkbench";
import { getInspectorPanePresentation, getInspectorSectionOrder } from "../lib/layoutPresets";
import { PaneGroup } from "./PaneGroup";
import { InspectorAdjustPanel } from "./InspectorAdjustPanel";
import { InspectorAnalysisPanel } from "./InspectorAnalysisPanel";
import { InspectorExportPanel } from "./InspectorExportPanel";
import { InspectorSessionPanel } from "./InspectorSessionPanel";
import { InspectorSettingsPanel } from "./InspectorSettingsPanel";
import { getInspectorTabMeta } from "./inspectorTabMeta";

type InspectorPaneContentProps = {
  workbench: WorkbenchController;
};

export function InspectorPaneContent({ workbench }: InspectorPaneContentProps) {
  const tabMeta = getInspectorTabMeta(workbench.activeInspectorTab);
  const presentation = getInspectorPanePresentation(workbench.activeLayoutPreset, workbench.activeInspectorTab);
  const sectionOrder = getInspectorSectionOrder(workbench.activeLayoutPreset, workbench.activeInspectorTab);

  return (
    <PaneGroup
      density={presentation.density}
      emphasis={presentation.emphasis}
      meta={presentation.meta ?? tabMeta.meta}
      testId="inspector-pane-group"
      title={presentation.title ?? tabMeta.title}
    >
      {workbench.activeInspectorTab === "adjust" ? <InspectorAdjustPanel order={sectionOrder} workbench={workbench} /> : null}
      {workbench.activeInspectorTab === "analysis" ? <InspectorAnalysisPanel order={sectionOrder} workbench={workbench} /> : null}
      {workbench.activeInspectorTab === "export" ? <InspectorExportPanel order={sectionOrder} workbench={workbench} /> : null}
      {workbench.activeInspectorTab === "session" ? <InspectorSessionPanel order={sectionOrder} workbench={workbench} /> : null}
      {workbench.activeInspectorTab === "settings" ? <InspectorSettingsPanel workbench={workbench} /> : null}
    </PaneGroup>
  );
}
