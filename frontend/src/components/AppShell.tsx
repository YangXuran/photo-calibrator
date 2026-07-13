import type { ReactNode } from "react";
import { useRuntimeConfig } from "../runtime/RuntimeProvider";

type AppShellProps = {
  topbar: ReactNode;
  notifications: ReactNode;
  workbench: ReactNode;
  focusMode?: boolean;
};

export function AppShell({ topbar, notifications, workbench, focusMode = false }: AppShellProps) {
  const runtime = useRuntimeConfig();

  return (
    <div className={`pc-app pc-app-mode-${runtime.mode} ${focusMode ? "pc-app-focus" : ""}`} data-testid="app-shell">
      <div className="pc-shell-frame" data-testid="app-shell-frame">
        {notifications}
        {topbar}
        {workbench}
      </div>
    </div>
  );
}
