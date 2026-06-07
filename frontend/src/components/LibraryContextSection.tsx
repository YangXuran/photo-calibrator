import type { WorkbenchController } from "../hooks/useWorkbench";
import { PaneGroup } from "./PaneGroup";
import { SelectionStatusCard } from "./SelectionStatusCard";
import { SessionLibraryCard } from "./SessionLibraryCard";

type LibraryContextSectionProps = {
  workbench: WorkbenchController;
  density?: "default" | "compact";
  emphasis?: "default" | "primary" | "muted";
  meta?: string;
  title?: string;
};

export function LibraryContextSection({
  workbench,
  density = "default",
  emphasis = "default",
  meta = "来源、恢复与运行时上下文",
  title = "Context",
}: LibraryContextSectionProps) {
  return (
    <PaneGroup density={density} emphasis={emphasis} meta={meta} testId="library-context-group" title={title}>
      {workbench.preferences.showSelectionStatus ? <SelectionStatusCard selectedFile={workbench.selectedFile} /> : null}
      {workbench.preferences.showSavedSessions ? (
        <SessionLibraryCard onDelete={workbench.deleteSavedSession} onLoad={workbench.loadSavedSession} onRefresh={workbench.refreshSavedSessions} sessions={workbench.savedSessions} />
      ) : null}
    </PaneGroup>
  );
}
