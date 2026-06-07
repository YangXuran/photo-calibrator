type WorkspaceSummaryStripProps = {
  hasFiles: boolean;
  fileCount: number;
  pluginCount: number;
  selectedName?: string;
};

export function WorkspaceSummaryStrip({ hasFiles, fileCount, pluginCount, selectedName }: WorkspaceSummaryStripProps) {
  return (
    <div className="pc-summary-strip">
      <span className="pc-summary-chip">{hasFiles ? `${fileCount} files` : "No files"}</span>
      <span className="pc-summary-chip">{`${pluginCount} plugins`}</span>
      <span className="pc-summary-chip is-muted">{selectedName ?? "No selection"}</span>
    </div>
  );
}
