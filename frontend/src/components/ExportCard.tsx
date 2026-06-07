import type { ExportPayload } from "../types";
import { InfoGrid } from "./InfoGrid";
import { PaneSection } from "./PaneSection";
import { ResultSummary } from "./ResultSummary";

type ExportCardProps = {
  collapseScope?: string;
  options: {
    format: string;
    outputPath: string;
    quality: number;
    embedIcc: boolean;
    preserveMetadata: boolean;
    exportTransform: string;
  };
  setOptions: (updater: (current: ExportCardProps["options"]) => ExportCardProps["options"]) => void;
  result: ExportPayload | null;
  actionState: {
    status: "idle" | "running" | "success" | "error";
    detail?: string;
  };
  onExport: () => void;
};

export function ExportCard({ collapseScope, options, setOptions, result, actionState, onExport }: ExportCardProps) {
  const summaryStatus = result ? "success" : actionState.status;
  return (
    <PaneSection
      actions={
        <button className="pc-button pc-button-secondary pc-button-small" data-testid="export-run-button" onClick={onExport} type="button">
          导出文件
        </button>
      }
      collapseStorageScope={collapseScope}
      collapseStorageKey="inspector-export-settings"
      collapsible
      meta="直接调用 backend /api/export"
      testId="export-settings-section"
      title="导出设置"
    >
      <div className="pc-form-stack">
        <label className="pc-field">
          <span>格式</span>
          <select onChange={(event) => setOptions((current) => ({ ...current, format: event.target.value }))} value={options.format}>
            <option value="jpeg">JPEG</option>
            <option value="png">PNG</option>
            <option value="tiff16">TIFF 16-bit</option>
            <option value="exr">OpenEXR</option>
            <option value="hdr">HDR</option>
            <option value="sidecar">Sidecar JSON</option>
            <option value="cube">3D LUT .cube</option>
          </select>
        </label>
        <label className="pc-field">
          <span>输出路径</span>
          <input onChange={(event) => setOptions((current) => ({ ...current, outputPath: event.target.value }))} type="text" value={options.outputPath} />
        </label>
        <label className="pc-field">
          <span>质量 {options.quality}</span>
          <input max={100} min={40} onChange={(event) => setOptions((current) => ({ ...current, quality: Number(event.target.value) }))} step={1} type="range" value={options.quality} />
        </label>
        <label className="pc-field">
          <span>导出变换</span>
          <select onChange={(event) => setOptions((current) => ({ ...current, exportTransform: event.target.value }))} value={options.exportTransform}>
            <option value="auto">Auto</option>
            <option value="display">Display</option>
            <option value="scene-linear">Scene Linear</option>
          </select>
        </label>
        <label className="pc-check">
          <input checked={options.embedIcc} onChange={(event) => setOptions((current) => ({ ...current, embedIcc: event.target.checked }))} type="checkbox" />
          <span>嵌入 ICC</span>
        </label>
        <label className="pc-check">
          <input checked={options.preserveMetadata} onChange={(event) => setOptions((current) => ({ ...current, preserveMetadata: event.target.checked }))} type="checkbox" />
          <span>保留 Metadata</span>
        </label>
      </div>
      {actionState.status !== "idle" || result ? (
        <div className="pc-stack">
          <ResultSummary
            detail={result?.path ?? actionState.detail ?? "等待导出结果。"}
            meta={result ? `${result.format.toUpperCase()} / ${(result.size / 1024).toFixed(1)} KB / ${result.elapsed_ms.toFixed(1)} ms` : null}
            status={summaryStatus}
            testIds={{ root: "export-result-summary", status: "export-status-chip", detail: "export-result-path" }}
            title="Export"
          />
          {result ? (
            <InfoGrid
              items={[
                { label: "Color Space", value: result.export_settings?.color_space ?? "-" },
                { label: "Bit Depth", value: result.export_settings?.bit_depth ?? "-" },
                { label: "ICC Embedded", value: result.export_settings?.icc_embedded ? "Yes" : "No" },
                { label: "Metadata Keys", value: result.export_settings?.metadata_keys?.length ?? 0 },
              ]}
            />
          ) : null}
          {result?.export_settings?.metadata_keys?.length ? (
            <div className="pc-note">
              <strong>Metadata</strong>
              <span>{result.export_settings?.metadata_keys?.join(", ")}</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </PaneSection>
  );
}
