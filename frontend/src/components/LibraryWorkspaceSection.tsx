import type { WorkbenchController } from "../hooks/useWorkbench";
import { BatchUploadPanel } from "./BatchUploadPanel";
import { PaneGroup } from "./PaneGroup";
import { WorkspaceBrowserCard } from "./WorkspaceBrowserCard";
import { WorkspaceSummaryStrip } from "./WorkspaceSummaryStrip";

type LibraryWorkspaceSectionProps = {
  workbench: WorkbenchController;
  density?: "default" | "compact";
  emphasis?: "default" | "primary" | "muted";
  meta?: string;
  title?: string;
};

export function LibraryWorkspaceSection({
  workbench,
  density = "default",
  emphasis = "default",
  meta,
  title = "Workspace",
}: LibraryWorkspaceSectionProps) {
  const selectedFile = workbench.selectedFile;

  return (
    <PaneGroup
      density={density}
      emphasis={emphasis}
      testId="library-workspace-group"
    >
      <WorkspaceSummaryStrip
        fileCount={workbench.files.length}
        hasFiles={workbench.files.length > 0}
        pluginCount={workbench.plugins.length}
        selectedName={selectedFile?.name}
      />
      <WorkspaceBrowserCard
        canClearWorkspace={workbench.files.length > 0}
        canRemoveSelected={Boolean(selectedFile)}
        counts={workbench.fileCounts}
        onClearWorkspace={workbench.clearWorkspace}
        onRemoveSelected={workbench.removeSelectedItem}
        searchQuery={workbench.searchQuery}
        setSearchQuery={workbench.setSearchQuery}
        setSourceFilter={workbench.setSourceFilter}
        sourceFilter={workbench.sourceFilter}
      />
      {workbench.files.length > 0 ? (
        <BatchUploadPanel
          files={workbench.files}
          onResult={(results) => {
            workbench.setFiles((items) =>
              items.map((item) => {
                const match = results.find((r) => r.file_name === item.name);
                return match && match.session_id ? { ...item, sessionId: match.session_id } : item;
              }),
            );
          }}
        />
      ) : null}
    </PaneGroup>
  );
}
