import type { CropPayload } from "../types";
import { t } from "../i18n";
import { InfoGrid } from "./InfoGrid";
import { PaneSection } from "./PaneSection";

type CropCardProps = {
  collapseScope?: string;
  crop?: CropPayload;
  cropEdited?: boolean;
  cropApplied?: boolean;
  onApply: () => void;
  onSuggest: () => void;
  onReset: () => void;
};

function percent(value?: number) {
  return value == null ? "-" : `${(value * 100).toFixed(1)}%`;
}

export function CropCard({ collapseScope, crop, cropApplied, cropEdited, onApply, onSuggest, onReset }: CropCardProps) {
  return (
    <PaneSection
      actions={
        <div className="pc-inline-actions">
          <button className="pc-button pc-button-secondary pc-button-small" onClick={onSuggest} type="button">
            {t("crop.autoSuggest")}
          </button>
          <button className="pc-button pc-button-primary pc-button-small" data-testid="crop-apply-button" disabled={!crop || cropApplied} onClick={onApply} type="button">
            {cropApplied ? t("crop.appliedButton") : t("crop.apply")}
          </button>
          <button className="pc-button pc-button-secondary pc-button-small" disabled={!cropEdited} onClick={onReset} type="button">
            {t("crop.restoreSuggestion")}
          </button>
        </div>
      }
      collapseStorageScope={collapseScope}
      collapseStorageKey="inspector-adjust-crop"
      collapsible
      defaultCollapsed
      density="compact"
      emphasis="muted"
      testId="crop-section"
      title={t("crop.title")}
    >
      <div className="pc-note pc-note-compact">
        <strong>{cropApplied ? t("crop.statusApplied") : cropEdited ? t("crop.statusEdited") : crop ? t("crop.statusSuggested") : t("crop.statusNone")}</strong>
      </div>
      <InfoGrid
        items={[
          { label: t("crop.confidence"), value: crop?.film_scan?.confidence != null ? crop.film_scan.confidence.toFixed(2) : "-" },
          { label: t("crop.angle"), value: crop?.film_scan?.angle_deg != null ? `${crop.film_scan.angle_deg.toFixed(2)}°` : "-" },
          { label: t("crop.format"), value: crop?.film_scan?.film_format ?? "-" },
          { label: t("crop.source"), value: crop?.processing?.film_scan_source ?? "-" },
          { label: "Left / Top", value: `${percent(crop?.crop_rect.left)} / ${percent(crop?.crop_rect.top)}` },
          { label: "Width / Height", value: `${percent(crop?.crop_rect.width)} / ${percent(crop?.crop_rect.height)}` },
        ]}
      />
    </PaneSection>
  );
}
