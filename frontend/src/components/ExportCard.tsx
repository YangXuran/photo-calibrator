import type { ExportPayload } from "../types";
import { t } from "../i18n";
import { replaceDirectoryInPath } from "../lib/paths";
import { getShellBridge } from "../runtime/shellBridge";
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
  const outputDirectoryPicker = getShellBridge()?.pickOutputDirectory;

  async function pickOutputDirectory() {
    if (!outputDirectoryPicker) return;
    const directory = await outputDirectoryPicker(options.outputPath);
    if (!directory) return;
    setOptions((current) => ({
      ...current,
      outputPath: replaceDirectoryInPath(current.outputPath, directory),
    }));
  }

  return (
    <PaneSection
      actions={
        <button className="pc-button pc-button-secondary pc-button-small" data-testid="export-run-button" onClick={onExport} type="button">
          {t("export.run")}
        </button>
      }
      collapseStorageScope={collapseScope}
      collapseStorageKey="inspector-export-settings"
      collapsible
      testId="export-settings-section"
      title={t("export.title")}
    >
      <div className="pc-form-stack">
        <label className="pc-field">
          <span>{t("export.format")}</span>
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
          <span>{t("export.outputPath")}</span>
          <div className="pc-field-row">
            <input
              className="pc-field-input-flex"
              data-testid="export-output-path"
              onChange={(event) => setOptions((current) => ({ ...current, outputPath: event.target.value }))}
              type="text"
              value={options.outputPath}
            />
            {outputDirectoryPicker ? (
              <button
                aria-label={t("export.chooseOutputFolder")}
                className="pc-button pc-button-secondary pc-button-small"
                data-testid="export-output-directory-picker"
                onClick={pickOutputDirectory}
                type="button"
              >
                {t("export.choose")}
              </button>
            ) : null}
          </div>
        </label>
        <label className="pc-field">
          <span>{t("export.quality", { value: options.quality })}</span>
          <input max={100} min={40} onChange={(event) => setOptions((current) => ({ ...current, quality: Number(event.target.value) }))} step={1} type="range" value={options.quality} />
        </label>
        <label className="pc-field">
          <span>{t("export.exportTransform")}</span>
          <select onChange={(event) => setOptions((current) => ({ ...current, exportTransform: event.target.value }))} value={options.exportTransform}>
            <option value="auto">Auto</option>
            <option value="display">Display</option>
            <option value="scene-linear">Scene Linear</option>
          </select>
        </label>
        <label className="pc-check">
          <input checked={options.embedIcc} onChange={(event) => setOptions((current) => ({ ...current, embedIcc: event.target.checked }))} type="checkbox" />
          <span>{t("export.embedIcc")}</span>
        </label>
        <label className="pc-check">
          <input checked={options.preserveMetadata} onChange={(event) => setOptions((current) => ({ ...current, preserveMetadata: event.target.checked }))} type="checkbox" />
          <span>{t("export.preserveMetadata")}</span>
        </label>
      </div>
      {actionState.status !== "idle" || result ? (
        <div className="pc-stack">
          <ResultSummary
            detail={result?.path ?? actionState.detail ?? ""}
            meta={result ? `${result.format.toUpperCase()} / ${(result.size / 1024).toFixed(1)} KB / ${result.elapsed_ms.toFixed(1)} ms` : null}
            status={summaryStatus}
            testIds={{ root: "export-result-summary", status: "export-status-chip", detail: "export-result-path" }}
            title={t("labels.export")}
          />
          {result ? (
            <InfoGrid
              items={[
                { label: t("labels.colorSpace"), value: result.export_settings?.color_space ?? "-" },
                { label: t("labels.bitDepth"), value: result.export_settings?.bit_depth ?? "-" },
                { label: t("labels.iccEmbedded"), value: result.export_settings?.icc_embedded ? t("common.yes") : t("common.no") },
                { label: t("labels.metadataKeys"), value: result.export_settings?.metadata_keys?.length ?? 0 },
              ]}
            />
          ) : null}
          {result?.export_settings?.metadata_keys?.length ? (
            <div className="pc-note">
              <strong>{t("labels.metadata")}</strong>
              <span>{result.export_settings?.metadata_keys?.join(", ")}</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </PaneSection>
  );
}
