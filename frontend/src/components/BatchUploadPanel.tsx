import { useState } from "react";
import type { WorkspaceFile } from "../types";
import { postBatchCalibrate } from "../lib/api";
import { fileToDataUrl } from "../lib/files";
import { PaneSection } from "./PaneSection";

type BatchUploadPanelProps = {
  files: WorkspaceFile[];
  onResult: (results: { file_name: string; session_id?: string; ok?: boolean; error?: string }[]) => void;
};

export function BatchUploadPanel({ files, onResult }: BatchUploadPanelProps) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [results, setResults] = useState<{ file_name: string; ok: boolean; session_id?: string; error?: string }[]>([]);

  const readyFiles = files.filter((f) => f.file && !f.sessionId);

  async function runBatch() {
    if (readyFiles.length === 0) return;
    setRunning(true);
    setProgress(`Processing ${readyFiles.length} file(s)...`);
    try {
      const items = await Promise.all(
        readyFiles.map(async (f) => ({
          image_data: await fileToDataUrl(f.file as File),
          file_name: f.name,
        })),
      );
      const payload = await postBatchCalibrate({
        items,
        mode: "global",
        strength: 0.8,
        analysis_max_side: 1800,
        workers: Math.min(4, readyFiles.length),
      });
      const resultList = (payload.results || []).map((r) => ({
        file_name: r.file_name,
        ok: !r.error,
        session_id: r.session_id,
        error: r.error,
      }));
      setResults(resultList);
      onResult(payload.results || []);
      setProgress(`Done: ${resultList.filter((r) => r.ok).length}/${resultList.length} OK`);
    } catch (e) {
      setProgress(`Error: ${String(e)}`);
    } finally {
      setRunning(false);
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  const failCount = results.filter((r) => !r.ok).length;

  return (
    <PaneSection density="default" testId="batch-upload-section" title="Batch Calibrate">
      <div className="pc-form-stack">
        <span className="pc-overline">
          {readyFiles.length} 个文件待处理（共 {files.length} 个）
        </span>
        <button
          className="pc-button pc-button-start"
          disabled={running || readyFiles.length === 0}
          onClick={runBatch}
          type="button"
        >
          {running ? "处理中…" : "Run Batch"}
        </button>
        {progress ? <span className="pc-overline">{progress}</span> : null}
        {results.length > 0 ? (
          <div className="pc-body-text">
            <div>✅ {okCount} / ❌ {failCount}</div>
            {results.map((r) => (
              <div className="pc-result-row" key={r.file_name} style={{ color: r.ok ? "var(--success)" : "var(--danger)" }}>
                {r.ok ? "✓" : "✗"} {r.file_name}
                {r.error ? ` — ${r.error}` : ""}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </PaneSection>
  );
}
