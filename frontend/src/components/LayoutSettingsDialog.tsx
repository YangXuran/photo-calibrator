import type { WorkbenchController } from "../hooks/useWorkbench";
import { getLayoutPresetDefinition, LAYOUT_PRESET_ORDER } from "../lib/layoutPresets";
import { DetailNote } from "./DetailNote";
import { DialogSectionCard } from "./DialogSectionCard";
import { DialogShell } from "./DialogShell";

type LayoutSettingsDialogProps = {
  open: boolean;
  onClose: () => void;
  workbench: Pick<
    WorkbenchController,
    "activeLayoutPreset" | "applyLayoutPreset" | "layoutState" | "preferences" | "resetPreferences" | "toggleViewerFocusMode" | "updatePreference"
  >;
};

type PreferenceToggleKey =
  | "showLibraryPane"
  | "showInspectorPane"
  | "showPluginsPanel"
  | "showSelectionStatus"
  | "showSavedSessions"
  | "showActivityPanel"
  | "showFilmstrip"
  | "showViewerHud"
  | "showAdjustStatus"
  | "showAdjustQuickActions"
  | "showCropPanel"
  | "showAnalysisMetrics"
  | "showAnalysisCharts"
  | "showAnalysisContext"
  | "showAnalysisAIReview"
  | "showSessionCard"
  | "showWorkflowFeed";

const LIBRARY_TOGGLES: Array<{ key: PreferenceToggleKey; label: string; note: string }> = [
  { key: "showLibraryPane", label: "显示左侧 Library", note: "控制整个左侧资源栏是否参与工作台布局。" },
  { key: "showPluginsPanel", label: "插件与评估器", note: "显示 backend 注册的插件和 AI evaluator 面板。" },
  { key: "showSelectionStatus", label: "当前选择状态", note: "显示当前选中项的来源和导出能力。" },
  { key: "showSavedSessions", label: "已保存 Session", note: "显示受管 session 列表和加载入口。" },
  { key: "showActivityPanel", label: "活动历史", note: "显示最近的导入、导出、AI 和文档操作记录。" },
];

const VIEWER_TOGGLES: Array<{ key: PreferenceToggleKey; label: string; note: string }> = [
  { key: "showFilmstrip", label: "底部 Filmstrip", note: "显示可独立滚动的缩略图条。" },
  { key: "showViewerHud", label: "Viewer HUD", note: "显示 viewer 内部的状态和快捷动作浮层。" },
];

const INSPECTOR_TOGGLES: Array<{ key: PreferenceToggleKey; label: string; note: string }> = [
  { key: "showInspectorPane", label: "显示右侧 Inspector", note: "控制整个右侧工具栏是否参与工作台布局。" },
  { key: "showAdjustStatus", label: "动作状态卡片", note: "显示 calibration / export / AI / session 的动作状态。" },
  { key: "showAdjustQuickActions", label: "快速操作卡片", note: "显示导出、AI、文档和 session 的快捷动作入口。" },
  { key: "showCropPanel", label: "裁切卡片", note: "显示 film scan 建议和裁切恢复入口。" },
  { key: "showAnalysisMetrics", label: "分析指标网格", note: "显示 dE、CCC、PCI、分析尺寸等摘要指标。" },
  { key: "showAnalysisCharts", label: "分析图表", note: "显示直方图、Lab 向量和偏色强度图表。" },
  { key: "showAnalysisContext", label: "处理上下文", note: "显示 session、accelerator、color space 和 neutral coverage。" },
  { key: "showAnalysisAIReview", label: "AI Review", note: "显示 evaluator 选择和 AI 评估结果卡片。" },
  { key: "showSessionCard", label: "Session / Document 卡片", note: "显示 document render 和 session save 主卡片。" },
  { key: "showWorkflowFeed", label: "Workflow Feed", note: "显示导出、AI、document 和 session 的结果汇总。" },
];

function PreferenceToggle({
  checked,
  label,
  note,
  onChange,
  testId,
}: {
  checked: boolean;
  label: string;
  note: string;
  onChange: (value: boolean) => void;
  testId: string;
}) {
  return (
    <label className="pc-preference-toggle" data-testid={`${testId}-row`}>
      <div className="pc-preference-copy">
        <strong>{label}</strong>
        <span>{note}</span>
      </div>
      <input checked={checked} data-testid={testId} onChange={(event) => onChange(event.target.checked)} type="checkbox" />
    </label>
  );
}

export function LayoutSettingsDialog({ open, onClose, workbench }: LayoutSettingsDialogProps) {
  const currentPreset = getLayoutPresetDefinition(workbench.activeLayoutPreset);

  return (
    <DialogShell
      ariaLabel="Layout settings"
      className="pc-layout-dialog"
      description="工作台区块开关保存在本地，避免再靠单独 CSS 或硬编码布局收口。"
      headerActions={
        <button className="pc-button pc-button-secondary pc-button-small" data-testid="layout-settings-reset" onClick={workbench.resetPreferences} type="button">
          重置
        </button>
      }
      onClose={onClose}
      open={open}
      testId="layout-settings-dialog"
      title="布局偏好"
    >
      <DetailNote
        body={workbench.layoutState.viewerFocusMode ? "当前已进入 viewer focus，左右栏和 filmstrip 会临时隐藏。" : "当前是标准工作台布局。可用顶栏 Focus 或 Shift + F 切换。"}
        compact
        title="Viewer Focus"
      />
      <div className="pc-inline-actions">
        <button className="pc-button pc-button-secondary pc-button-small" data-testid="layout-settings-focus-toggle" onClick={workbench.toggleViewerFocusMode} type="button">
          {workbench.layoutState.viewerFocusMode ? "退出 Focus" : "进入 Focus"}
        </button>
      </div>

      <DialogSectionCard description={currentPreset.description} title={`布局预设 · ${currentPreset.label}`}>
        <div className="pc-preset-grid" data-testid="layout-preset-section">
          {LAYOUT_PRESET_ORDER.map((presetId) => {
            const preset = getLayoutPresetDefinition(presetId);
            const active = workbench.activeLayoutPreset === presetId;
            return (
              <button
                className={`pc-preset-card${active ? " is-active" : ""}`}
                data-testid={`layout-preset-${presetId}-card`}
                key={presetId}
                onClick={() => workbench.applyLayoutPreset(presetId)}
                type="button"
              >
                <strong>{preset.label}</strong>
                <span>{preset.description}</span>
              </button>
            );
          })}
        </div>
        <DetailNote body={currentPreset.description} compact testId="layout-preset-current" title={currentPreset.label} />
      </DialogSectionCard>

      <DialogSectionCard description="左侧资源区块显示策略" title="Library Pane">
        {LIBRARY_TOGGLES.map((item) => (
          <PreferenceToggle
            checked={workbench.preferences[item.key]}
            key={item.key}
            label={item.label}
            note={item.note}
            onChange={(value) => workbench.updatePreference(item.key, value)}
            testId={`layout-pref-${item.key}`}
          />
        ))}
      </DialogSectionCard>

      <DialogSectionCard description="中央工作区显示策略" title="Viewer Pane">
        {VIEWER_TOGGLES.map((item) => (
          <PreferenceToggle
            checked={workbench.preferences[item.key]}
            key={item.key}
            label={item.label}
            note={item.note}
            onChange={(value) => workbench.updatePreference(item.key, value)}
            testId={`layout-pref-${item.key}`}
          />
        ))}
      </DialogSectionCard>

      <DialogSectionCard description="右侧工具区和结果区块显示策略" title="Inspector Pane">
        {INSPECTOR_TOGGLES.map((item) => (
          <PreferenceToggle
            checked={workbench.preferences[item.key]}
            key={item.key}
            label={item.label}
            note={item.note}
            onChange={(value) => workbench.updatePreference(item.key, value)}
            testId={`layout-pref-${item.key}`}
          />
        ))}
      </DialogSectionCard>
    </DialogShell>
  );
}
