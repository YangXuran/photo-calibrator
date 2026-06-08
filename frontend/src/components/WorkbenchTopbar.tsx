import type { PickedFiles } from "../hooks/useWorkbench";
import { useWorkbenchTopbarDialogs } from "../hooks/useWorkbenchTopbarDialogs";
import { useRuntimeConfig } from "../runtime/RuntimeProvider";
import type { WorkbenchController } from "../hooks/useWorkbench";
import { WorkbenchBrand } from "./WorkbenchBrand";
import { WorkbenchDialogs } from "./WorkbenchDialogs";
import { WorkbenchTopbarActions } from "./WorkbenchTopbarActions";

type WorkbenchTopbarProps = {
  backendOk: boolean | null;
  onPickFiles: (files: PickedFiles) => void;
  workbench: Pick<WorkbenchController, "activeLayoutPreset" | "applyLayoutPreset" | "layoutState" | "redo" | "toggleLayoutElement" | "toggleViewerFocusMode" | "undo">;
};

export function WorkbenchTopbar({ onPickFiles, workbench }: WorkbenchTopbarProps) {
  const runtime = useRuntimeConfig();
  const focusMode = workbench.layoutState.viewerFocusMode;
  const dialogs = useWorkbenchTopbarDialogs();

  return (
    <>
      <header className={`pc-topbar ${focusMode ? "is-focus" : ""}`} data-testid="workbench-topbar">
        <WorkbenchBrand runtime={runtime} />
        <WorkbenchTopbarActions
          focusMode={focusMode}
          onOpenLayoutSettings={dialogs.openLayoutSettings}
          onOpenShortcutHelp={dialogs.openShortcutHelp}
          onPickFiles={onPickFiles}
          runtime={runtime}
          workbench={workbench}
        />
      </header>
      <WorkbenchDialogs
        onCloseLayoutSettings={dialogs.closeLayoutSettings}
        onCloseShortcutHelp={dialogs.closeShortcutHelp}
        showLayoutSettings={dialogs.showLayoutSettings}
        showShortcutHelp={dialogs.showShortcutHelp}
        workbench={workbench}
      />
    </>
  );
}
