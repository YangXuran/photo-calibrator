type LibraryPaneHeaderProps = {
  fileCount: number;
  pluginCount: number;
  selectedName?: string;
};

export function LibraryPaneHeader({ fileCount, pluginCount, selectedName }: LibraryPaneHeaderProps) {
  return (
    <div className="pc-inspector-head" data-testid="library-head">
      <div className="pc-stage-meta">
        <span className="pc-overline">Library</span>
        <strong>{selectedName ?? "未选择照片"}</strong>
      </div>
      <div className="pc-summary-strip">
        <span className="pc-summary-chip">{`${fileCount} files`}</span>
        <span className="pc-summary-chip">{`${pluginCount} plugins`}</span>
      </div>
    </div>
  );
}
