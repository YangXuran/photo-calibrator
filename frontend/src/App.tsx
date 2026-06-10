import { useEffect } from "react";
import { AppShell } from "./components/AppShell";
import { NotificationCenter } from "./components/NotificationCenter";
import { WorkbenchLayout } from "./components/WorkbenchLayout";
import { WorkbenchTopbar } from "./components/WorkbenchTopbar";
import { useWorkbench } from "./hooks/useWorkbench";
import type { PathFileInfo } from "./hooks/useWorkbench";
import type { WorkspaceFile } from "./types";

export default function App() {
  const workbench = useWorkbench();

  useEffect(() => {
    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<WorkspaceFile[]>;
      workbench.injectFiles(customEvent.detail);
    };
    window.addEventListener("photo-calibrator:inject-files", handler);
    return () => window.removeEventListener("photo-calibrator:inject-files", handler);
  }, [workbench.injectFiles]);

  // macOS native menu: receive files picked from menu bar -> Open Photos / Open Folder
  useEffect(() => {
    const menuBridge = (window as unknown as Record<string, unknown>).__PHOTO_CALIBRATOR_MENU__ as
      | { onFilesPicked: (cb: (files: PathFileInfo[]) => void) => () => void }
      | undefined;
    if (!menuBridge) return;
    const unlisten = menuBridge.onFilesPicked((files: PathFileInfo[]) => {
      workbench.onPickFiles(files);
    });
    return unlisten;
  }, [workbench.onPickFiles]);

  return (
    <AppShell
      focusMode={workbench.layoutState.viewerFocusMode}
      notifications={<NotificationCenter focusMode={workbench.layoutState.viewerFocusMode} items={workbench.notifications} onDismiss={workbench.dismissNotification} />}
      topbar={<WorkbenchTopbar backendOk={workbench.backendOk} onPickFiles={workbench.onPickFiles} workbench={workbench} />}
      workbench={<WorkbenchLayout workbench={workbench} />}
    />
  );
}
