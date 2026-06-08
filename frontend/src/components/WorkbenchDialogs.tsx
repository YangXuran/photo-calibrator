import type { WorkbenchController } from "../hooks/useWorkbench";
import { LayoutSettingsDialog } from "./LayoutSettingsDialog";
import { ShortcutHelpDialog } from "./ShortcutHelpDialog";

type WorkbenchDialogsProps = {
  showLayoutSettings: boolean;
  showShortcutHelp: boolean;
  onCloseLayoutSettings: () => void;
  onCloseShortcutHelp: () => void;
  workbench: Pick<WorkbenchController, "activeLayoutPreset" | "applyLayoutPreset" | "layoutState" | "preferences" | "resetPreferences" | "toggleViewerFocusMode" | "updatePreference">;
};

export function WorkbenchDialogs({
  showLayoutSettings,
  showShortcutHelp,
  onCloseLayoutSettings,
  onCloseShortcutHelp,
  workbench,
}: WorkbenchDialogsProps) {
  return (
    <>
      <LayoutSettingsDialog onClose={onCloseLayoutSettings} open={showLayoutSettings} workbench={workbench} />
      <ShortcutHelpDialog onClose={onCloseShortcutHelp} open={showShortcutHelp} />
    </>
  );
}
