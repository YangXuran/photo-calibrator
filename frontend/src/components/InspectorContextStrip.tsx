import type { WorkspaceFile } from "../types";
import { getWorkspaceStateSummary } from "../lib/workspaceStatus";

type InspectorContextStripProps = {
  selectedFile?: WorkspaceFile;
};

export function InspectorContextStrip({ selectedFile }: InspectorContextStripProps) {
  const summary = getWorkspaceStateSummary(selectedFile);

  if (!selectedFile) {
    return (
      <div className="pc-inspector-context-strip">
        <span className="pc-source-pill is-muted">No source</span>
      </div>
    );
  }

  return (
    <div className="pc-inspector-context-strip">
      <span className={`pc-source-pill ${selectedFile.kind === "session" ? "is-session" : "is-file"}`}>{summary.sourceLabel}</span>
      <span className={`pc-source-pill pc-source-pill-state pc-source-pill-${summary.stateTone}`}>{summary.stateLabel}</span>
      <span className="pc-source-pill is-muted">{summary.cropLabel}</span>
      {summary.previewLabel !== "-" ? <span className="pc-source-pill is-muted">Preview {summary.previewLabel}</span> : null}
    </div>
  );
}
