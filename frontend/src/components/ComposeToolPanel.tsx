import type { WorkbenchController } from "../hooks/useWorkbench";
import { CropCard } from "./CropCard";
import { PaneSection } from "./PaneSection";

type ComposeToolPanelProps = {
  workbench: WorkbenchController;
};

export function ComposeToolPanel({ workbench }: ComposeToolPanelProps) {
  const selectedFile = workbench.selectedFile;
  const collapseScope = "workbench";
  const imageTransform = selectedFile?.imageTransform ?? { rotation: 0, flipH: false, flipV: false };

  return (
    <div className="pc-tool-panel" data-testid="compose-tool-panel">
      <PaneSection
        collapseStorageScope={collapseScope}
        collapseStorageKey="tool-compose-rotate"
        collapsible
        emphasis="primary"
        testId="compose-rotate-section"
        title="旋转与翻转"
      >
        <div className="pc-compose-grid">
          <button className="pc-compose-btn" data-testid="compose-rotate-left" disabled={!selectedFile} onClick={() => workbench.rotateSelectedImage(-90)} title="向左旋转 90°" type="button">
            ↺ 90°
          </button>
          <button className="pc-compose-btn" data-testid="compose-rotate-right" disabled={!selectedFile} onClick={() => workbench.rotateSelectedImage(90)} title="向右旋转 90°" type="button">
            ↻ 90°
          </button>
          <button className={`pc-compose-btn ${imageTransform.flipH ? "is-active" : ""}`} data-testid="compose-flip-horizontal" disabled={!selectedFile} onClick={() => workbench.flipSelectedImage("horizontal")} title="水平翻转" type="button">
            ↔ 翻转
          </button>
          <button className={`pc-compose-btn ${imageTransform.flipV ? "is-active" : ""}`} data-testid="compose-flip-vertical" disabled={!selectedFile} onClick={() => workbench.flipSelectedImage("vertical")} title="垂直翻转" type="button">
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
              onBlur={(event) =>
                workbench.updateSelectedImageTransform(
                  { ...imageTransform, rotation: Number(event.currentTarget.value) },
                  { interaction: "commit", description: "旋转角度" },
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
                  { interaction: "commit", description: "旋转角度" },
                )
              }
              onPointerDown={() => workbench.beginEdit()}
              onPointerUp={(event) =>
                workbench.updateSelectedImageTransform(
                  { ...imageTransform, rotation: Number(event.currentTarget.value) },
                  { interaction: "commit", description: "旋转角度" },
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
          重置旋转翻转
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
        title="透视校正"
      >
        <div className="pc-placeholder-panel">
          <p>待实现</p>
        </div>
      </PaneSection>
    </div>
  );
}
