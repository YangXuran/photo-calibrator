import type { WorkbenchController } from "../hooks/useWorkbench";
import { t } from "../i18n";
import { CropCard } from "./CropCard";
import { InfoGrid } from "./InfoGrid";
import { PaneSection } from "./PaneSection";

type ComposeToolPanelProps = {
  workbench: WorkbenchController;
};

export function ComposeToolPanel({ workbench }: ComposeToolPanelProps) {
  const selectedFile = workbench.selectedFile;
  const collapseScope = "workbench";
  const imageTransform = selectedFile?.imageTransform ?? { rotation: 0, flipH: false, flipV: false };
  const perspectiveCorrection = selectedFile?.crop?.perspective_correction;
  const perspectiveDetected = Boolean(perspectiveCorrection?.enabled && perspectiveCorrection.corners?.length === 4);
  const perspectiveApplied = Boolean(selectedFile?.result?.processing?.perspective_applied);
  const perspectiveStatus = perspectiveApplied
    ? t("compose.keystoneApplied")
    : perspectiveDetected
      ? t("compose.keystoneSuggested")
      : t("compose.keystoneNone");

  return (
    <div className="pc-tool-panel" data-testid="compose-tool-panel">
      <PaneSection
        collapseStorageScope={collapseScope}
        collapseStorageKey="tool-compose-rotate"
        collapsible
        emphasis="primary"
        testId="compose-rotate-section"
        title={t("compose.rotateFlipTitle")}
      >
        <div className="pc-compose-grid">
          <button className="pc-compose-btn" data-testid="compose-rotate-left" disabled={!selectedFile} onClick={() => workbench.rotateSelectedImage(-90)} title={t("compose.rotateLeftTitle")} type="button">
            ↺ 90°
          </button>
          <button className="pc-compose-btn" data-testid="compose-rotate-right" disabled={!selectedFile} onClick={() => workbench.rotateSelectedImage(90)} title={t("compose.rotateRightTitle")} type="button">
            ↻ 90°
          </button>
          <button className={`pc-compose-btn ${imageTransform.flipH ? "is-active" : ""}`} data-testid="compose-flip-horizontal" disabled={!selectedFile} onClick={() => workbench.flipSelectedImage("horizontal")} title={t("compose.flipHorizontalTitle")} type="button">
            ↔ {t("compose.flip")}
          </button>
          <button className={`pc-compose-btn ${imageTransform.flipV ? "is-active" : ""}`} data-testid="compose-flip-vertical" disabled={!selectedFile} onClick={() => workbench.flipSelectedImage("vertical")} title={t("compose.flipVerticalTitle")} type="button">
            ↕ {t("compose.flip")}
          </button>
        </div>
        <label className="pc-field">
          <span>{t("compose.rotationAngle")}</span>
          <div className="pc-compose-angle">
            <input
              data-testid="compose-rotation-input"
              max={180}
              min={-180}
              onBlur={(event) =>
                workbench.updateSelectedImageTransform(
                  { ...imageTransform, rotation: Number(event.currentTarget.value) },
                  { interaction: "commit", description: t("compose.rotationAngle") },
                )
              }
              onChange={(event) =>
                workbench.updateSelectedImageTransform(
                  { ...imageTransform, rotation: Number(event.target.value) },
                  { interaction: "drag" },
                )
              }
              onKeyDown={() => workbench.beginEdit()}
              onKeyUp={(event) =>
                workbench.updateSelectedImageTransform(
                  { ...imageTransform, rotation: Number(event.currentTarget.value) },
                  { interaction: "commit", description: t("compose.rotationAngle") },
                )
              }
              onPointerDown={() => workbench.beginEdit()}
              onPointerUp={(event) =>
                workbench.updateSelectedImageTransform(
                  { ...imageTransform, rotation: Number(event.currentTarget.value) },
                  { interaction: "commit", description: t("compose.rotationAngle") },
                )
              }
              step={0.1}
              type="range"
              value={imageTransform.rotation}
            />
            <span className="pc-compose-angle-value">{imageTransform.rotation.toFixed(1)}°</span>
          </div>
        </label>
        <button className="pc-button pc-button-secondary pc-button-small" data-testid="compose-transform-reset" disabled={!selectedFile} onClick={workbench.resetSelectedImageTransform} type="button">
          {t("compose.resetTransform")}
        </button>
      </PaneSection>

      <CropCard
        collapseScope={collapseScope}
        crop={selectedFile?.crop}
        cropApplied={Boolean(selectedFile?.cropApplied || selectedFile?.result?.processing?.crop_applied)}
        cropEdited={selectedFile?.cropEdited}
        onApply={workbench.applySelectedCrop}
        onReset={workbench.resetSelectedCrop}
        onSuggest={workbench.runFilmScan}
      />

      <PaneSection
        collapseStorageScope={collapseScope}
        collapseStorageKey="tool-compose-keystone"
        collapsible
        defaultCollapsed
        testId="compose-keystone-section"
        title={t("compose.keystoneTitle")}
      >
        <InfoGrid
          items={[
            { label: t("compose.keystoneStatus"), value: perspectiveStatus },
            { label: t("compose.keystoneCorners"), value: perspectiveDetected ? String(perspectiveCorrection?.corners.length ?? 0) : "-" },
            { label: t("crop.source"), value: selectedFile?.crop?.processing?.film_scan_source ?? "-" },
          ]}
        />
      </PaneSection>
    </div>
  );
}
