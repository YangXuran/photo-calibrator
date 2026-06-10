import { ACCELERATOR_OPTIONS, MODE_DESCRIPTIONS, MODE_OPTIONS } from "../constants";
import type { WorkbenchController } from "../hooks/useWorkbench";
import { PaneSection } from "./PaneSection";

type ColorToolPanelProps = {
  workbench: WorkbenchController;
};

const COLOR_MODES = [
  "global",
  "skin-priority",
  "highlights-only",
  "preserve-split-tone",
  "selective",
  "film",
] as const;

export function ColorToolPanel({ workbench }: ColorToolPanelProps) {
  const collapseScope = "workbench";
  const modeDescription = MODE_DESCRIPTIONS[workbench.mode];

  return (
    <div className="pc-tool-panel" data-testid="color-tool-panel">
      <PaneSection
        collapseStorageScope={collapseScope}
        collapseStorageKey="tool-color-balance"
        collapsible
        emphasis="primary"
        testId="color-balance-section"
        title="色彩平衡"
        meta=""
      >
        <div className="pc-form-stack">
          <label className="pc-field">
            <span>色彩模式</span>
            <select
              data-testid="color-mode-select"
              onChange={(event) => workbench.setMode(event.target.value)}
              value={COLOR_MODES.includes(workbench.mode as typeof COLOR_MODES[number]) ? workbench.mode : "global"}
            >
              {MODE_OPTIONS.filter(([value]) => COLOR_MODES.includes(value as typeof COLOR_MODES[number])).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            {modeDescription ? (
              <span className="pc-field-hint" data-testid="color-mode-description">{modeDescription}</span>
            ) : null}
          </label>
          <label className="pc-field">
            <span>校准强度 {workbench.strength.toFixed(2)}</span>
            <input
              data-testid="color-strength-input"
              max={1.2}
              min={0}
              onChange={(event) => workbench.setStrength(Number(event.target.value))}
              step={0.05}
              type="range"
              value={workbench.strength}
            />
          </label>
        </div>
      </PaneSection>
    </div>
  );
}
