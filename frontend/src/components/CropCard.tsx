import type { CropPayload } from "../types";
import { InfoGrid } from "./InfoGrid";
import { PaneSection } from "./PaneSection";

type CropCardProps = {
  collapseScope?: string;
  crop?: CropPayload;
  cropEdited?: boolean;
  onSuggest: () => void;
  onReset: () => void;
};

function percent(value?: number) {
  return value == null ? "-" : `${(value * 100).toFixed(1)}%`;
}

export function CropCard({ collapseScope, crop, cropEdited, onSuggest, onReset }: CropCardProps) {
  return (
    <PaneSection
      actions={
        <div className="pc-inline-actions">
          <button className="pc-button pc-button-secondary pc-button-small" onClick={onSuggest} type="button">
            自动建议
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
      meta="胶片翻拍自动水平与裁切"
      title="胶片裁切"
    >
      <div className="pc-note pc-note-compact">
        <strong>{cropEdited ? "已手动调整" : crop ? "使用建议框" : "未检测"}</strong>
        <span>{cropEdited ? "本地调整框" : "可用于后续导出"}</span>
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
