import type { InspectorTab, WorkspaceFile } from "../types";
import { InspectorContextStrip } from "./InspectorContextStrip";
import { InspectorTabs } from "./InspectorTabs";

type InspectorPaneHeaderProps = {
  selectedFile?: WorkspaceFile;
  activeTab: InspectorTab;
  onChangeTab: (tab: InspectorTab) => void;
};

export function InspectorPaneHeader({ selectedFile, activeTab, onChangeTab }: InspectorPaneHeaderProps) {
  return (
    <div className="pc-inspector-head" data-testid="inspector-head">
      <div className="pc-stage-meta">
        <span className="pc-overline">Inspector</span>
        <strong>{selectedFile?.name ?? "未选择照片"}</strong>
      </div>
      <InspectorTabs active={activeTab} onChange={onChangeTab} />
      <InspectorContextStrip selectedFile={selectedFile} />
    </div>
  );
}
