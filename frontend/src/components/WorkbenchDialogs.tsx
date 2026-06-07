import type { WorkbenchController } from "../hooks/useWorkbench";
import { LayoutSettingsDialog } from "./LayoutSettingsDialog";
import { SettingsDialog } from "./RuntimeSettingsDialog";
import { ShortcutHelpDialog } from "./ShortcutHelpDialog";

type WorkbenchDialogsProps = {
  showLayoutSettings: boolean;
  showShortcutHelp: boolean;
  showRuntimeSettings: boolean;
  onCloseLayoutSettings: () => void;
  onCloseShortcutHelp: () => void;
  onCloseRuntimeSettings: () => void;
  backendOk: boolean | null;
  workbench: Pick<WorkbenchController, "activeLayoutPreset" | "activityLog" | "applyLayoutPreset" | "evaluators" | "layoutState" | "plugins" | "preferences" | "resetPreferences" | "toggleViewerFocusMode" | "updatePreference">;
};

export function WorkbenchDialogs({
  showLayoutSettings,
  showShortcutHelp,
  showRuntimeSettings,
  onCloseLayoutSettings,
  onCloseShortcutHelp,
  onCloseRuntimeSettings,
  backendOk,
  workbench,
}: WorkbenchDialogsProps) {
  return (
    <>
      <LayoutSettingsDialog onClose={onCloseLayoutSettings} open={showLayoutSettings} workbench={workbench} />
      <ShortcutHelpDialog onClose={onCloseShortcutHelp} open={showShortcutHelp} />
      <SettingsDialog backendOk={backendOk} onClose={onCloseRuntimeSettings} open={showRuntimeSettings} workbench={workbench} />
    </>
  );
}
