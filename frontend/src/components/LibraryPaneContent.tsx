import type { WorkbenchController } from "../hooks/useWorkbench";
import { SelectionStatusCard } from "./SelectionStatusCard";
import { SessionLibraryCard } from "./SessionLibraryCard";
import { WorkspaceSummaryStrip } from "./WorkspaceSummaryStrip";

type LibraryPaneContentProps = {
  workbench: WorkbenchController;
};

export function LibraryPaneContent({ workbench }: LibraryPaneContentProps) {
  return (
    <>
      <WorkspaceSummaryStrip
        pluginCount={workbench.plugins.length}
        selectedFileName={workbench.selectedFile?.name}
        totalFiles={workbench.files.length}
      />
      {workbench.preferences.showSelectionStatus ? <SelectionStatusCard selectedFile={workbench.selectedFile} /> : null}
      {workbench.preferences.showSavedSessions ? (
        <SessionLibraryCard
          onDelete={workbench.deleteSavedSession}
          onLoad={workbench.loadSavedSession}
          onRefresh={workbench.refreshSavedSessions}
          sessions={workbench.savedSessions}
        />
      ) : null}
    </>
  );
}
