import type { AIEvaluationPayload, DocumentRenderPayload, ExportPayload, SessionSavePayload } from "../types";
import { buildWorkflowFeedItems } from "../lib/workflowStatus";
import { PaneSection } from "./PaneSection";
import { StatusChip } from "./StatusChip";

type WorkflowFeedCardProps = {
  density?: "default" | "compact";
  emphasis?: "default" | "primary" | "muted";
  exportResult: ExportPayload | null;
  sessionSaveResult: SessionSavePayload | null;
  documentRender: DocumentRenderPayload | null;
  aiResult: AIEvaluationPayload | null;
};

export function WorkflowFeedCard({
  aiResult,
  density = "compact",
  documentRender,
  emphasis = "default",
  exportResult,
  sessionSaveResult,
}: WorkflowFeedCardProps) {
  const items = buildWorkflowFeedItems({ exportResult, sessionSaveResult, documentRender, aiResult });

  return (
    <PaneSection density={density} emphasis={emphasis} meta="最近工作流事件" testId="workflow-feed-section" title="Workflow Feed">
      <div className="pc-list">
        {items.map((item, index) => (
          <article className="pc-list-item" key={`${item.title}-${index}`}>
            <div className="pc-list-main">
              <strong>{item.title}</strong>
              <span>{item.meta}</span>
            </div>
            <div className="pc-meta-row">
              <StatusChip status={item.status} />
            </div>
            <span className="pc-body-text">{item.detail}</span>
          </article>
        ))}
        {!items.length ? <div className="pc-empty-panel">还没有工作流事件。</div> : null}
      </div>
    </PaneSection>
  );
}
