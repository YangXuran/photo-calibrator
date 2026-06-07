import type { ReactNode } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

type ViewerStackLayoutProps = {
  filmstrip?: ReactNode;
  layoutKey: string;
  main: ReactNode;
};

export function ViewerStackLayout({ filmstrip, layoutKey, main }: ViewerStackLayoutProps) {
  if (!filmstrip) {
    return <>{main}</>;
  }

  return (
    <PanelGroup autoSaveId={`photo-calibrator-center-stack:${layoutKey}`} className="pc-center-stack" direction="vertical">
      <Panel defaultSize={78} minSize={55}>
        {main}
      </Panel>
      <PanelResizeHandle className="pc-resize-handle pc-resize-handle-horizontal" data-testid="viewer-stack-resize-handle" />
      <Panel defaultSize={22} minSize={16}>
        {filmstrip}
      </Panel>
    </PanelGroup>
  );
}
