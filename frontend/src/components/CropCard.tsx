import type { CropPayload } from "../types";
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
            自动建议
          </button>
          <button className="pc-button pc-button-primary pc-button-small" data-testid="crop-apply-button" disabled={!crop || cropApplied} onClick={onApply} type="button">
            {cropApplied ? "已应用" : "应用裁切"}
          </button>
          <button className="pc-button pc-button-secondary pc-button-small" disabled={!cropEdited} onClick={onReset} type="button">
            恢复建议框
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
      title="胶片裁切"
    >
      <div className="pc-note pc-note-compact">
        <strong>{cropApplied ? "裁切已应用" : cropEdited ? "待应用：已手动调整" : crop ? "待应用：建议框" : "未检测"}</strong>
        <span>{cropApplied ? "原图与校准图已使用相同裁切" : crop ? "建议框已向内保留安全边距，调整后点击应用" : "先运行自动建议"}</span>
      </div>
      <InfoGrid
        items={[
          { label: "置信度", value: crop?.film_scan?.confidence != null ? crop.film_scan.confidence.toFixed(2) : "-" },
          { label: "角度", value: crop?.film_scan?.angle_deg != null ? `${crop.film_scan.angle_deg.toFixed(2)}°` : "-" },
          { label: "格式", value: crop?.film_scan?.film_format ?? "-" },
          { label: "来源", value: crop?.processing?.film_scan_source ?? "-" },
          { label: "Left / Top", value: `${percent(crop?.crop_rect.left)} / ${percent(crop?.crop_rect.top)}` },
          { label: "Width / Height", value: `${percent(crop?.crop_rect.width)} / ${percent(crop?.crop_rect.height)}` },
        ]}
      />
    </PaneSection>
  );
}
