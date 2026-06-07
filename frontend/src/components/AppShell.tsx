import type { ReactNode } from "react";
import { useRuntimeConfig } from "../runtime/RuntimeProvider";
import { RuntimeBanner } from "./RuntimeBanner";

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
      <div className={`pc-shell-frame ${focusMode ? "is-focus" : ""}`} data-testid="app-shell-frame">
        {!focusMode ? <RuntimeBanner runtime={runtime} /> : null}
        {notifications}
        {topbar}
        {workbench}
      </div>
    </div>
  );
}
