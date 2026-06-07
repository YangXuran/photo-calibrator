import type { WorkspaceFile } from "../types";
import { getWorkspaceStateSummary } from "../lib/workspaceStatus";
import { InfoGrid } from "./InfoGrid";
import { PaneSection } from "./PaneSection";

type SelectionStatusCardProps = {
  selectedFile?: WorkspaceFile;
};

export function SelectionStatusCard({ selectedFile }: SelectionStatusCardProps) {
  const summary = getWorkspaceStateSummary(selectedFile);
  return (
    <PaneSection density="compact" meta="当前选择的来源与限制" testId="selection-status-section" title="Selection Status">
      <InfoGrid
        items={[
          { label: "Session ID", value: summary.sessionLabel },
          { label: "导出原图", value: summary.exportLabel },
          { label: "Color Space", value: summary.colorSpaceLabel },
          { label: "Session Path", value: selectedFile?.sessionPath ?? "-" },
        ]}
      />
    </PaneSection>
  );
}
