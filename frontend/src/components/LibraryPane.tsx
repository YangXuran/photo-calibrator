import type { WorkbenchController } from "../hooks/useWorkbench";
import { LibraryPaneContent } from "./LibraryPaneContent";
import { LibraryPaneHeader } from "./LibraryPaneHeader";
import { SidePaneShell } from "./SidePaneShell";

type LibraryPaneProps = {
  workbench: WorkbenchController;
};

export function LibraryPane({ workbench }: LibraryPaneProps) {
  return (
    <SidePaneShell
      header={<LibraryPaneHeader fileCount={workbench.files.length} pluginCount={workbench.plugins.length} selectedName={workbench.selectedFile?.name} />}
      side="left"
      testId="library-pane"
    >
      <LibraryPaneContent workbench={workbench} />
    </SidePaneShell>
  );
}
