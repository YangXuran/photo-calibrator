import type { InspectorTab, WorkspaceFile } from "../types";

type InspectorPaneHeaderProps = {
  selectedFile?: WorkspaceFile;
  activeTab: InspectorTab;
  onChangeTab: (tab: InspectorTab) => void;
};

export function InspectorPaneHeader(_props: InspectorPaneHeaderProps) {
  return null;
}
