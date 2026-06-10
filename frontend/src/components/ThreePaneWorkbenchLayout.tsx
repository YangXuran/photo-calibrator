import type { ReactNode } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

type ThreePaneWorkbenchLayoutProps = {
  center: ReactNode;
  left?: ReactNode;
  layoutKey: string;
  right?: ReactNode;
  showLeft?: boolean;
  showRight?: boolean;
};

export function ThreePaneWorkbenchLayout({ center, layoutKey, left, right, showLeft = true, showRight = true }: ThreePaneWorkbenchLayoutProps) {
  return (
    <PanelGroup autoSaveId={`photo-calibrator-workbench:${layoutKey}`} className="pc-workbench" data-testid="workbench-layout" direction="horizontal">
      <Panel collapsible defaultSize={20} minSize={14} style={!showLeft ? { display: "none" } : undefined}>
        {left}
      </Panel>
      {showLeft ? <PanelResizeHandle className="pc-resize-handle" data-testid="workbench-left-resize-handle" /> : null}

      <Panel defaultSize={56} minSize={34}>
        {center}
      </Panel>

      {showRight ? <PanelResizeHandle className="pc-resize-handle" data-testid="workbench-right-resize-handle" /> : null}
      <Panel collapsible defaultSize={24} minSize={16} style={!showRight ? { display: "none" } : undefined}>
        {right}
      </Panel>
    </PanelGroup>
  );
}
