import { PaneSection } from "./PaneSection";
import { SpotlightCard } from "./reactbits";

type QuickActionsCardProps = {
  canExportOriginal: boolean;
  canRunSessionActions: boolean;
  density?: "default" | "compact";
  emphasis?: "default" | "primary" | "muted";
  onSuggestCrop: () => void;
  onRunAI: () => void;
  onRenderDocument: () => void;
  onSaveSession: () => void;
  onExport: () => void;
};

export function QuickActionsCard({
  canExportOriginal,
  canRunSessionActions,
  density = "compact",
  emphasis = "muted",
  onSuggestCrop,
  onRunAI,
  onRenderDocument,
  onSaveSession,
  onExport,
}: QuickActionsCardProps) {
  return (
    <PaneSection density={density} emphasis={emphasis} testId="quick-actions-section" title="Quick Actions">
      <div className="pc-action-grid">
        <SpotlightCard className="pc-action-button-wrapper">
          <button className="pc-action-button" onClick={onSuggestCrop} type="button">
            <strong>裁切建议</strong>
            <span>Film</span>
          </button>
        </SpotlightCard>
        <SpotlightCard className="pc-action-button-wrapper">
          <button className="pc-action-button" disabled={!canRunSessionActions} onClick={onRunAI} type="button">
            <strong>AI 评估</strong>
            <span>Session</span>
          </button>
        </SpotlightCard>
        <SpotlightCard className="pc-action-button-wrapper">
          <button className="pc-action-button" disabled={!canRunSessionActions} onClick={onRenderDocument} type="button">
            <strong>文档重放</strong>
            <span>Replay</span>
          </button>
        </SpotlightCard>
        <SpotlightCard className="pc-action-button-wrapper">
          <button className="pc-action-button" disabled={!canRunSessionActions} onClick={onSaveSession} type="button">
            <strong>保存 Session</strong>
            <span>Store</span>
          </button>
        </SpotlightCard>
        <SpotlightCard className="pc-action-button-wrapper">
          <button className="pc-action-button" disabled={!canExportOriginal} onClick={onExport} type="button">
            <strong>导出文件</strong>
            <span>{canExportOriginal ? "Full-res" : "Local only"}</span>
          </button>
        </SpotlightCard>
      </div>
    </PaneSection>
  );
}
