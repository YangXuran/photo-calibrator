import { MODE_OPTIONS } from "../constants";
import type { WorkbenchController } from "../hooks/useWorkbench";
import { t } from "../i18n";
import { InspectorPanelSections } from "./InspectorPanelSections";
import { PaneSection } from "./PaneSection";

type InspectorAdjustPanelProps = {
  order?: string[];
  workbench: WorkbenchController;
};

export function InspectorAdjustPanel({ order, workbench }: InspectorAdjustPanelProps) {
  const collapseScope = "workbench";
  const autoBest = workbench.selectedFile?.result?.processing?.auto_best;
  const selectedAutoMode = workbench.selectedFile?.result?.processing?.auto_best_selected_mode;
  const tone = workbench.toneRecovery;
  const toneAnalysis = workbench.selectedFile?.result?.processing?.tone_recovery;

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
              title={t("adjust.title")}
            >
              <div className="pc-form-stack">
                <label className="pc-field pc-field-checkbox">
                  <input
                    checked={workbench.negativeBaseEnabled}
                    data-testid="negative-base-toggle"
                    onChange={(event) => workbench.setNegativeBaseCommitted(event.currentTarget.checked)}
                    type="checkbox"
                  />
                  <span>{t("adjust.negativeBase")}</span>
                </label>
                <label className="pc-field">
                  <span>{t("adjust.mode")}</span>
                  <select data-testid="mode-select" onChange={(event) => workbench.setModeCommitted(event.target.value)} value={workbench.mode}>
                    {MODE_OPTIONS.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  {workbench.mode === "auto-best" && selectedAutoMode ? (
                    <span className="pc-field-hint" data-testid="auto-best-result">
                      {t("adjust.selectedModeScore", { mode: selectedAutoMode, score: workbench.selectedFile?.result?.processing?.auto_best_score?.toFixed(2) ?? "-" })}
                    </span>
                  ) : null}
                  {workbench.mode === "auto-best" && autoBest?.candidates?.length ? (
                    <span className="pc-field-hint" data-testid="auto-best-candidates">
                      {t("adjust.candidates", { candidates: autoBest.candidates.slice(0, 3).map((item) => `${item.mode} ${item.score.toFixed(1)}`).join(" / ") })}
                    </span>
                  ) : null}
                </label>
                <label className="pc-field">
                  <span>{t("adjust.strength", { value: workbench.strength.toFixed(2) })}</span>
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
        {
          key: "tone-recovery",
          content: (
            <PaneSection
              collapseStorageScope={collapseScope}
              collapseStorageKey="inspector-adjust-tone-recovery"
              collapsible
              testId="tone-recovery-section"
              title={t("adjust.toneTitle")}
            >
              <div className="pc-form-stack">
                <label className="pc-field pc-field-checkbox">
                  <input
                    checked={tone.enabled}
                    data-testid="tone-recovery-toggle"
                    onChange={(event) => workbench.setToneRecoveryCommitted({ ...tone, enabled: event.currentTarget.checked })}
                    type="checkbox"
                  />
                  <span>{t("adjust.toneEnable")}</span>
                </label>
                <label className="pc-field">
                  <span>{t("adjust.toneStrength", { value: tone.strength.toFixed(2) })}</span>
                  <input
                    data-testid="tone-recovery-strength"
                    disabled={!tone.enabled}
                    max={1}
                    min={0}
                    onBlur={(event) => workbench.commitToneRecovery({ ...tone, strength: Number(event.currentTarget.value) })}
                    onChange={(event) => workbench.previewToneRecovery({ ...tone, strength: Number(event.target.value) })}
                    onKeyDown={() => workbench.beginEdit()}
                    onKeyUp={(event) => workbench.commitToneRecovery({ ...tone, strength: Number(event.currentTarget.value) })}
                    onPointerDown={() => workbench.beginEdit()}
                    onPointerUp={(event) => workbench.commitToneRecovery({ ...tone, strength: Number(event.currentTarget.value) })}
                    step={0.05}
                    type="range"
                    value={tone.strength}
                  />
                </label>
                {toneAnalysis?.enabled ? (
                  <span className="pc-field-hint" data-testid="tone-recovery-analysis">
                    {t("adjust.toneAnalysis", {
                      range: Math.round((toneAnalysis.dynamic_range ?? 0) * 100),
                      black: Math.round((toneAnalysis.black_point ?? 0) * 100),
                      white: Math.round((toneAnalysis.white_point ?? 1) * 100),
                      strength: Number(toneAnalysis.recommended_strength ?? 0).toFixed(2),
                    })}
                  </span>
                ) : null}
              </div>
            </PaneSection>
          ),
        },
      ]}
    />
  );
}
