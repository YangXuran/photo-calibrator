import { useState } from "react";

export function useWorkbenchTopbarDialogs() {
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  const [showRuntimeSettings, setShowRuntimeSettings] = useState(false);

  return {
    showShortcutHelp,
    showRuntimeSettings,
    openShortcutHelp: () => setShowShortcutHelp(true),
    closeShortcutHelp: () => setShowShortcutHelp(false),
    openRuntimeSettings: () => setShowRuntimeSettings(true),
    closeRuntimeSettings: () => setShowRuntimeSettings(false),
  };
}
