import type { BatchExportItemResult, WorkspaceFile } from "../types";
import { directoryFromPath } from "../lib/paths";
import { PaneSection } from "./PaneSection";

type BatchExportCardProps = {
  files: WorkspaceFile[];
  outputPath: string;
  format: string;
  actionState: {
    status: "idle" | "running" | "success" | "error";
    detail?: string;
  };
  results: BatchExportItemResult[];
  onExport: () => void;
};

export function BatchExportCard({ files, outputPath, format, actionState, results, onExport }: BatchExportCardProps) {
  const exportableCount = files.filter((item) => item.kind === "file" && item.file).length;
  const outputDir = directoryFromPath(outputPath);
  const successCount = results.filter((item) => item.ok).length;
  const failCount = results.filter((item) => !item.ok).length;

  return (
    <PaneSection
      actions={
        <button className="pc-button pc-button-secondary pc-button-small" data-testid="batch-export-run-button" disabled={exportableCount === 0 || actionState.status === "running"} onClick={onExport} type="button">
          {actionState.status === "running" ? "批量导出中…" : "批量导出"}
        </button>
      }
      collapseStorageKey="inspector-batch-export"
      collapseStorageScope="workbench"
      collapsible
      testId="batch-export-section"
      title="批量导出"
    >
      <div className="pc-form-stack">
        <span className="pc-overline" data-testid="batch-export-summary">
          {exportableCount} 个文件，格式 {format.toUpperCase()}，输出目录 {outputDir}
        </span>
        {actionState.detail ? <span className="pc-overline">{actionState.detail}</span> : null}
        {results.length > 0 ? (
          <div className="pc-body-text" data-testid="batch-export-results">
            <div>✅ {successCount} / ❌ {failCount}</div>
            {results.map((item) => (
              <div className="pc-result-row" key={item.file_id} style={{ color: item.ok ? "var(--success)" : "var(--danger)" }}>
                {item.ok ? "✓" : "✗"} {item.file_name}
                {item.path ? ` — ${item.path}` : ""}
                {item.error ? ` — ${item.error}` : ""}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </PaneSection>
  );
}
