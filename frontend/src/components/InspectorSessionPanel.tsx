import type { WorkbenchController } from "../hooks/useWorkbench";
import { ActivityPanel } from "./ActivityPanel";
import { HistoryPanel } from "./HistoryPanel";
import { InspectorPanelSections } from "./InspectorPanelSections";
import { PaneSection } from "./PaneSection";
import { SessionCard } from "./SessionCard";
import { SessionLibraryCard } from "./SessionLibraryCard";

type InspectorSessionPanelProps = {
  order?: string[];
  workbench: WorkbenchController;
};

export function InspectorSessionPanel({ order, workbench }: InspectorSessionPanelProps) {
  const selectedFile = workbench.selectedFile;
  const collapseScope = "workbench";
  return (
    <InspectorPanelSections
      order={order}
      sections={[
        {
          key: "history",
          content: (
            <PaneSection
              collapseStorageScope={collapseScope}
              collapseStorageKey="inspector-session-history"
              collapsible
              testId="history-section"
              title="操作历史"
              meta={selectedFile?.historyPersistent === false ? "历史未持久化" : "当前文件的撤销 / 重做记录"}
            >
              <HistoryPanel
                entries={workbench.history}
                currentIndex={workbench.historyIndex}
                onUndo={workbench.undo}
                onRedo={workbench.redo}
              />
            </PaneSection>
          ),
        },
        {
          key: "session-card",
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
          key: "saved-sessions",
          content: (
            <SessionLibraryCard
              onDelete={workbench.deleteSavedSession}
              onLoad={workbench.loadSavedSession}
              onRefresh={workbench.refreshSavedSessions}
              sessions={workbench.savedSessions}
            />
          ),
        },
        {
          key: "activity",
          content: <ActivityPanel items={workbench.activityLog} />,
        },
      ]}
    />
  );
}
