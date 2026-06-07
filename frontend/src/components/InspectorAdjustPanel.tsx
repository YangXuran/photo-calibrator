import { ACCELERATOR_OPTIONS, MODE_DESCRIPTIONS, MODE_OPTIONS } from "../constants";
import type { WorkbenchController } from "../hooks/useWorkbench";
import { getAuxiliarySectionPresentation } from "../lib/layoutPresets";
import { ActionStatusCard } from "./ActionStatusCard";
import { CropCard } from "./CropCard";
import { CurveEditor } from "./CurveEditor";
import { HistoryPanel } from "./HistoryPanel";
import { InspectorPanelSections } from "./InspectorPanelSections";
import { PaneSection } from "./PaneSection";
import { QuickActionsCard } from "./QuickActionsCard";

type InspectorAdjustPanelProps = {
  order?: string[];
  workbench: WorkbenchController;
};

export function InspectorAdjustPanel({ order, workbench }: InspectorAdjustPanelProps) {
  const selectedFile = workbench.selectedFile;
  const canRunSessionActions = Boolean(selectedFile?.sessionId);
  const canExportOriginal = Boolean(selectedFile?.file);
  const collapseScope = `preset:${workbench.activeLayoutPreset}`;
  const quickActionsPresentation = getAuxiliarySectionPresentation(workbench.activeLayoutPreset, "quick-actions");
  const actionStatusPresentation = getAuxiliarySectionPresentation(workbench.activeLayoutPreset, "action-status");
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
              title="主校准"
              meta="参数更改后自动刷新后端预览"
            >
              <div className="pc-form-stack">
                <label className="pc-field">
                  <span>模式</span>
                  <select data-testid="mode-select" onChange={(event) => workbench.setMode(event.target.value)} value={workbench.mode}>
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
                  <input data-testid="strength-input" max={1.2} min={0} onChange={(event) => workbench.setStrength(Number(event.target.value))} step={0.05} type="range" value={workbench.strength} />
                </label>
                <label className="pc-field">
                  <span>加速后端</span>
                  <select data-testid="accelerator-select" onChange={(event) => workbench.setAccelerator(event.target.value)} value={workbench.accelerator}>
                    {ACCELERATOR_OPTIONS.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                {workbench.mode === "rgb-curves" ? (
                  <label className="pc-field">
                    <span>RGB 曲线</span>
                    <CurveEditor
                      curves={{ r: workbench.rCurve, g: workbench.gCurve, b: workbench.bCurve }}
                      onChange={workbench.setCurves}
                    />
                  </label>
                ) : null}
              </div>
            </PaneSection>
          ),
        },
        {
          key: "quick-actions",
          visible: workbench.preferences.showAdjustQuickActions,
          content: (
            <QuickActionsCard
              canExportOriginal={canExportOriginal}
              canRunSessionActions={canRunSessionActions}
              density={quickActionsPresentation.density}
              emphasis={quickActionsPresentation.emphasis}
              onExport={workbench.runExport}
              onRenderDocument={workbench.renderDocument}
              onRunAI={workbench.runAIEvaluation}
              onSaveSession={workbench.saveSession}
              onSuggestCrop={workbench.runFilmScan}
            />
          ),
        },
        {
          key: "action-status",
          visible: workbench.preferences.showAdjustStatus,
          content: <ActionStatusCard density={actionStatusPresentation.density} emphasis={actionStatusPresentation.emphasis} states={workbench.actionStates} />,
        },
        {
          key: "crop",
          visible: workbench.preferences.showCropPanel,
          content: <CropCard collapseScope={collapseScope} crop={selectedFile?.crop} cropEdited={selectedFile?.cropEdited} onReset={workbench.resetSelectedCrop} onSuggest={workbench.runFilmScan} />,
        },
        {
          key: "history",
          content: (
            <PaneSection
              collapseStorageScope={collapseScope}
              collapseStorageKey="inspector-adjust-history"
              collapsible
              testId="history-section"
              title="操作历史"
              meta="撤销 / 重做校准参数变更"
            >
              <HistoryPanel
                entries={workbench.history}
                currentIndex={workbench.historyIndex}
                onUndo={workbench.undo}
                onRedo={workbench.redo}
              />
            </PaneSection>
          ),
        },
      ]}
    />
  );
}
