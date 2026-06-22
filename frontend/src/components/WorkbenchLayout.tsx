import { useRef } from "react";
import type { WorkbenchController } from "../hooks/useWorkbench";
import { AnalysisPane } from "./AnalysisPane";
import { InspectorPane } from "./InspectorPane";
import { ThreePaneWorkbenchLayout } from "./ThreePaneWorkbenchLayout";
import { ViewerPane } from "./ViewerPane";
import { getWorkbenchViewerSources } from "./workbenchSources";

type WorkbenchLayoutProps = {
  workbench: WorkbenchController;
};

export function WorkbenchLayout({ workbench }: WorkbenchLayoutProps) {
  const lastFileId = useRef<string>();
  const fileId = workbench.selectedFile?.id;
  const fileSwitched = lastFileId.current !== undefined && lastFileId.current !== fileId;
  if (fileId) lastFileId.current = fileId;
  const docRender = fileSwitched ? null : workbench.documentRender;
  const { originalSrc, calibratedSrc } = getWorkbenchViewerSources(workbench.selectedFile, docRender);

  return (
    <ThreePaneWorkbenchLayout
      center={<ViewerPane calibratedSrc={calibratedSrc} onContainerResize={workbench.setStageContainerSize} originalSrc={originalSrc} workbench={workbench} />}
      layoutKey="unified"
      left={<AnalysisPane workbench={workbench} />}
      right={<InspectorPane workbench={workbench} />}
      showLeft={workbench.layoutState.showAnalysisPane}
      showRight={workbench.layoutState.showInspectorPane}
    />
  );
}
