import type { ReactNode } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

type ThreePaneWorkbenchLayoutProps = {
  center: ReactNode;
  left?: ReactNode;
  layoutKey: string;
  right?: ReactNode;
};

export function ThreePaneWorkbenchLayout({ center, layoutKey, left, right }: ThreePaneWorkbenchLayoutProps) {
  return (
    <PanelGroup autoSaveId={`photo-calibrator-workbench:${layoutKey}`} className="pc-workbench" data-testid="workbench-layout" direction="horizontal">
      {left ? (
        <>
          <Panel collapsible defaultSize={20} minSize={16}>
            {left}
          </Panel>
          <PanelResizeHandle className="pc-resize-handle" data-testid="workbench-left-resize-handle" />
        </>
      ) : null}

      <Panel defaultSize={56} minSize={34}>
        {center}
      </Panel>

      {right ? (
        <>
          <PanelResizeHandle className="pc-resize-handle" data-testid="workbench-right-resize-handle" />
          <Panel collapsible defaultSize={24} minSize={20}>
            {right}
          </Panel>
        </>
      ) : null}
    </PanelGroup>
  );
}
