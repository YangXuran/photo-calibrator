import type { PickedFiles } from "../hooks/useWorkbench";
import { useWorkbenchTopbarDialogs } from "../hooks/useWorkbenchTopbarDialogs";
import { useRuntimeConfig } from "../runtime/RuntimeProvider";
import type { WorkbenchController } from "../hooks/useWorkbench";
import { RuntimeStatusChips } from "./RuntimeStatusChips";
import { WorkbenchBrand } from "./WorkbenchBrand";
import { WorkbenchDialogs } from "./WorkbenchDialogs";
import { WorkbenchTopbarActions } from "./WorkbenchTopbarActions";

type WorkbenchTopbarProps = {
  backendOk: boolean | null;
  onPickFiles: (files: PickedFiles) => void;
  workbench: Pick<WorkbenchController, "activeLayoutPreset" | "activityLog" | "applyLayoutPreset" | "evaluators" | "layoutState" | "plugins" | "preferences" | "redo" | "resetPreferences" | "toggleLayoutElement" | "toggleViewerFocusMode" | "undo" | "updatePreference">;
};

export function WorkbenchTopbar({ backendOk, onPickFiles, workbench }: WorkbenchTopbarProps) {
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
          onOpenRuntimeSettings={dialogs.openRuntimeSettings}
          onOpenShortcutHelp={dialogs.openShortcutHelp}
          onPickFiles={onPickFiles}
          runtime={runtime}
          workbench={workbench}
        />
        {!focusMode ? <RuntimeStatusChips backendOk={backendOk} runtime={runtime} /> : null}
      </header>
      <WorkbenchDialogs
        backendOk={backendOk}
        onCloseLayoutSettings={dialogs.closeLayoutSettings}
        onCloseRuntimeSettings={dialogs.closeRuntimeSettings}
        onCloseShortcutHelp={dialogs.closeShortcutHelp}
        showLayoutSettings={dialogs.showLayoutSettings}
        showRuntimeSettings={dialogs.showRuntimeSettings}
        showShortcutHelp={dialogs.showShortcutHelp}
        workbench={workbench}
      />
    </>
  );
}
