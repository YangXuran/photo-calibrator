import { useState } from "react";

export function useWorkbenchTopbarDialogs() {
  const [showLayoutSettings, setShowLayoutSettings] = useState(false);
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  const [showRuntimeSettings, setShowRuntimeSettings] = useState(false);

  return {
    showLayoutSettings,
    showShortcutHelp,
    showRuntimeSettings,
    openLayoutSettings: () => setShowLayoutSettings(true),
    closeLayoutSettings: () => setShowLayoutSettings(false),
    openShortcutHelp: () => setShowShortcutHelp(true),
    closeShortcutHelp: () => setShowShortcutHelp(false),
    openRuntimeSettings: () => setShowRuntimeSettings(true),
    closeRuntimeSettings: () => setShowRuntimeSettings(false),
  };
}
