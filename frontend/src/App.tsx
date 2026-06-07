import { AppShell } from "./components/AppShell";
import { NotificationCenter } from "./components/NotificationCenter";
import { WorkbenchLayout } from "./components/WorkbenchLayout";
import { WorkbenchTopbar } from "./components/WorkbenchTopbar";
import { useWorkbench } from "./hooks/useWorkbench";

export default function App() {
  const workbench = useWorkbench();

  return (
    <AppShell
      focusMode={workbench.layoutState.viewerFocusMode}
      notifications={<NotificationCenter focusMode={workbench.layoutState.viewerFocusMode} items={workbench.notifications} onDismiss={workbench.dismissNotification} />}
      topbar={<WorkbenchTopbar backendOk={workbench.backendOk} onPickFiles={workbench.onPickFiles} workbench={workbench} />}
      workbench={<WorkbenchLayout workbench={workbench} />}
    />
  );
}
