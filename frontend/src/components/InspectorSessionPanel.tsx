import type { WorkbenchController } from "../hooks/useWorkbench";
import { getAuxiliarySectionPresentation } from "../lib/layoutPresets";
import { InspectorPanelSections } from "./InspectorPanelSections";
import { SessionCard } from "./SessionCard";
import { WorkflowFeedCard } from "./WorkflowFeedCard";

type InspectorSessionPanelProps = {
  order?: string[];
  workbench: WorkbenchController;
};

export function InspectorSessionPanel({ order, workbench }: InspectorSessionPanelProps) {
  const selectedFile = workbench.selectedFile;
  const collapseScope = `preset:${workbench.activeLayoutPreset}`;
  const workflowFeedPresentation = getAuxiliarySectionPresentation(workbench.activeLayoutPreset, "workflow-feed");
  return (
    <InspectorPanelSections
      order={order}
      sections={[
        {
          key: "session-card",
          visible: workbench.preferences.showSessionCard,
          content: (
            <SessionCard
              collapseScope={collapseScope}
              documentRender={workbench.documentRender}
              documentActionState={workbench.actionStates.document}
              onRenderDocument={workbench.renderDocument}
              onSave={workbench.saveSession}
              savePath={workbench.sessionOptions.savePath}
              saveResult={workbench.sessionSaveResult}
              sessionActionState={workbench.actionStates.session}
              sessionId={selectedFile?.sessionId}
              setSavePath={(value) => workbench.setSessionOptions((current) => ({ ...current, savePath: value }))}
            />
          ),
        },
        {
          key: "workflow-feed",
          visible: workbench.preferences.showWorkflowFeed,
          content: (
            <WorkflowFeedCard
              aiResult={workbench.aiResult}
              density={workflowFeedPresentation.density}
              documentRender={workbench.documentRender}
              emphasis={workflowFeedPresentation.emphasis}
              exportResult={workbench.exportResult}
              sessionSaveResult={workbench.sessionSaveResult}
            />
          ),
        },
      ]}
    />
  );
}
