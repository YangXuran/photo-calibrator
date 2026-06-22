import { MODE_DESCRIPTIONS, MODE_OPTIONS } from "../constants";
import type { WorkbenchController } from "../hooks/useWorkbench";
import { InspectorPanelSections } from "./InspectorPanelSections";
import { PaneSection } from "./PaneSection";

type InspectorAdjustPanelProps = {
  order?: string[];
  workbench: WorkbenchController;
};

export function InspectorAdjustPanel({ order, workbench }: InspectorAdjustPanelProps) {
  const collapseScope = "workbench";
  const modeDescription = MODE_DESCRIPTIONS[workbench.mode];

  return (
    <InspectorPanelSections
      order={order}
      sections={[
        {
          key: "main-calibration",
          content: (
            <PaneSection
              collapseStorageScope={collapseScope}
              collapseStorageKey="inspector-adjust-main-calibration"
              collapsible
              emphasis="primary"
              testId="main-calibration-section"
              title="自动校准"
              meta="参数更改后自动刷新后端预览"
            >
              <div className="pc-form-stack">
                <label className="pc-field">
                  <span>模式</span>
                  <select data-testid="mode-select" onChange={(event) => workbench.setModeCommitted(event.target.value)} value={workbench.mode}>
                    {MODE_OPTIONS.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  {modeDescription ? (
                    <span className="pc-field-hint" data-testid="mode-description">{modeDescription}</span>
                  ) : null}
                </label>
                <label className="pc-field">
                  <span>强度 {workbench.strength.toFixed(2)}</span>
                  <input
                    data-testid="strength-input"
                    max={1.2}
                    min={0}
                    onBlur={(event) => workbench.commitStrength(Number(event.currentTarget.value))}
                    onChange={(event) => workbench.setStrength(Number(event.target.value))}
                    onKeyDown={() => workbench.beginEdit()}
                    onKeyUp={(event) => workbench.commitStrength(Number(event.currentTarget.value))}
                    onPointerDown={() => workbench.beginEdit()}
                    onPointerUp={(event) => workbench.commitStrength(Number(event.currentTarget.value))}
                    step={0.05}
                    type="range"
                    value={workbench.strength}
                  />
                </label>
              </div>
            </PaneSection>
          ),
        },
      ]}
    />
  );
}
