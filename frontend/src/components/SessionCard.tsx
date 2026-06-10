import type { DocumentRenderPayload, SessionSavePayload } from "../types";
import { DetailList } from "./DetailList";
import { InfoGrid } from "./InfoGrid";
import { PaneSection } from "./PaneSection";
import { ResultSummary } from "./ResultSummary";

type SessionCardProps = {
  collapseScope?: string;
  sessionId?: string;
  savePath: string;
  setSavePath: (value: string) => void;
  saveResult: SessionSavePayload | null;
  documentRender: DocumentRenderPayload | null;
  sessionActionState: {
    status: "idle" | "running" | "success" | "error";
    detail?: string;
  };
  documentActionState: {
    status: "idle" | "running" | "success" | "error";
    detail?: string;
  };
  onSave: () => void;
  onRenderDocument: () => void;
};

export function SessionCard({ collapseScope, sessionId, savePath, setSavePath, saveResult, documentRender, sessionActionState, documentActionState, onSave, onRenderDocument }: SessionCardProps) {
  const sessionSummaryStatus = saveResult ? "success" : sessionActionState.status;
  const documentSummaryStatus = documentRender ? "success" : documentActionState.status;
  return (
    <div className="pc-stack">
      <PaneSection
        actions={
          <div className="pc-inline-actions">
            <button className="pc-button pc-button-secondary pc-button-small" data-testid="document-render-button" onClick={onRenderDocument} type="button">
              重放文档
            </button>
            <button className="pc-button pc-button-secondary pc-button-small" data-testid="session-save-button" onClick={onSave} type="button">
              保存 Session
            </button>
          </div>
        }
        collapseStorageScope={collapseScope}
        collapseStorageKey="inspector-session-document-context"
        collapsible
        meta=""
        testId="document-context-section"
        title="文档上下文"
      >
        <div className="pc-form-stack">
          <InfoGrid
            items={[
              { label: "Session ID", value: sessionId ?? "-" },
              { label: "Replayable Ops", value: documentRender?.processing?.document_replayable_ops ?? "-" },
            ]}
          />
          <label className="pc-field">
            <span>Session 保存路径</span>
            <input onChange={(event) => setSavePath(event.target.value)} type="text" value={savePath} />
          </label>
        </div>
        {sessionActionState.status !== "idle" || saveResult ? (
          <ResultSummary
            detail={saveResult?.path ?? sessionActionState.detail ?? "等待保存结果。"}
            meta={saveResult ? `${(saveResult.size / 1024).toFixed(1)} KB` : null}
            status={sessionSummaryStatus}
            testIds={{ root: "session-save-summary", status: "session-save-status-chip", detail: "session-save-path" }}
            title="Session Save"
          />
        ) : null}
        {documentActionState.status !== "idle" || documentRender ? (
          <ResultSummary
            detail={documentRender?.session_id ?? documentActionState.detail ?? "等待文档重放结果。"}
            meta={documentRender ? `${documentRender.processing?.document_replayable_ops ?? 0} replayable ops` : null}
            status={documentSummaryStatus}
            testIds={{ root: "document-render-summary", status: "document-render-status-chip", detail: "document-render-detail" }}
            title="Document Render"
          />
        ) : null}
      </PaneSection>
      {documentRender?.calibrated_image ? (
      <PaneSection
        collapseStorageScope={collapseScope}
        collapseStorageKey="inspector-session-document-preview"
        collapsible
        defaultCollapsed
        meta=""
        testId="document-preview-section"
        title="文档预览"
      >
          <div className="pc-render-preview">
            <img alt="Document render preview" src={documentRender.calibrated_image} />
          </div>
        </PaneSection>
      ) : null}
      <PaneSection
        collapseStorageScope={collapseScope}
        collapseStorageKey="inspector-session-document-operations"
        collapsible
        defaultCollapsed
        meta=""
        testId="document-operations-section"
        title="文档操作"
      >
        <DetailList
          empty="当前 session 还没有 document operation。"
          items={(documentRender?.document?.operations ?? []).map((operation) => ({
            title: operation.name,
            meta: operation.replayable ? "replayable" : "non-replayable",
            code: operation.params ? JSON.stringify(operation.params, null, 2) : null,
          }))}
        />
      </PaneSection>
    </div>
  );
}
