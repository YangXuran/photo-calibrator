import type { WorkbenchController } from "../hooks/useWorkbench";
import { CropCard } from "./CropCard";
import { PaneSection } from "./PaneSection";

type ComposeToolPanelProps = {
  workbench: WorkbenchController;
};

export function ComposeToolPanel({ workbench }: ComposeToolPanelProps) {
  const selectedFile = workbench.selectedFile;
  const collapseScope = "workbench";

  return (
    <div className="pc-tool-panel" data-testid="compose-tool-panel">
      <PaneSection
        collapseStorageScope={collapseScope}
        collapseStorageKey="tool-compose-rotate"
        collapsible
        emphasis="primary"
        testId="compose-rotate-section"
        title="旋转与翻转"
        meta=""
      >
        <div className="pc-compose-grid">
          <button className="pc-compose-btn" title="向左旋转 90°" type="button">
            ↺ 90°
          </button>
          <button className="pc-compose-btn" title="向右旋转 90°" type="button">
            ↻ 90°
          </button>
          <button className="pc-compose-btn" title="水平翻转" type="button">
            ↔ 翻转
          </button>
          <button className="pc-compose-btn" title="垂直翻转" type="button">
            ↕ 翻转
          </button>
        </div>
        <label className="pc-field">
          <span>旋转角度</span>
          <div className="pc-compose-angle">
            <input
              data-testid="compose-rotation-input"
              max={180}
              min={-180}
              step={0.1}
              type="range"
              defaultValue={0}
            />
            <span className="pc-compose-angle-value">0.0°</span>
          </div>
        </label>
      </PaneSection>

      <CropCard
        collapseScope={collapseScope}
        crop={selectedFile?.crop}
        cropEdited={selectedFile?.cropEdited}
        onReset={workbench.resetSelectedCrop}
        onSuggest={workbench.runFilmScan}
      />

      <PaneSection
        collapseStorageScope={collapseScope}
        collapseStorageKey="tool-compose-keystone"
        collapsible
        defaultCollapsed
        testId="compose-keystone-section"
        title="透视校正"
        meta="梯形失真与 Keystone"
      >
        <div className="pc-placeholder-panel">
          <p>透视校正工具（待实现）</p>
          <p className="pc-field-hint">
            胶片扫描检测到的透视变换可在裁切中自动应用
          </p>
        </div>
      </PaneSection>
    </div>
  );
}
