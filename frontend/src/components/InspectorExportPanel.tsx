import type { WorkbenchController } from "../hooks/useWorkbench";
import { ExportCard } from "./ExportCard";
import { InspectorPanelSections } from "./InspectorPanelSections";

type InspectorExportPanelProps = {
  order?: string[];
  workbench: WorkbenchController;
};

export function InspectorExportPanel({ order, workbench }: InspectorExportPanelProps) {
  const collapseScope = "workbench";
  return (
    <InspectorPanelSections
      order={order}
      sections={[
        {
          key: "export-card",
          content: <ExportCard actionState={workbench.actionStates.export} collapseScope={collapseScope} onExport={workbench.runExport} options={workbench.exportOptions} result={workbench.exportResult} setOptions={(updater) => workbench.setExportOptions((current) => updater(current))} />,
        },
      ]}
    />
  );
}
