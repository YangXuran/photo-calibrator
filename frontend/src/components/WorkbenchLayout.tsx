import type { WorkbenchController } from "../hooks/useWorkbench";
import { InspectorPane } from "./InspectorPane";
import { LibraryPane } from "./LibraryPane";
import { ThreePaneWorkbenchLayout } from "./ThreePaneWorkbenchLayout";
import { ViewerPane } from "./ViewerPane";
import { getWorkbenchViewerSources } from "./workbenchSources";

type WorkbenchLayoutProps = {
  workbench: WorkbenchController;
};

export function WorkbenchLayout({ workbench }: WorkbenchLayoutProps) {
  const { originalSrc, calibratedSrc } = getWorkbenchViewerSources(workbench.selectedFile, workbench.documentRender);

  return (
    <ThreePaneWorkbenchLayout
      center={<ViewerPane calibratedSrc={calibratedSrc} originalSrc={originalSrc} workbench={workbench} />}
      layoutKey={workbench.activeLayoutPreset}
      left={workbench.layoutState.showLibraryPane ? <LibraryPane workbench={workbench} /> : undefined}
      right={workbench.layoutState.showInspectorPane ? <InspectorPane workbench={workbench} /> : undefined}
    />
  );
}
