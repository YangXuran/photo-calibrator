import type { DocumentRenderPayload, SessionSavePayload } from "../types";
import { t } from "../i18n";
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
              {t("session.replay")}
            </button>
            <button className="pc-button pc-button-secondary pc-button-small" data-testid="session-save-button" onClick={onSave} type="button">
              {t("session.save")}
            </button>
          </div>
        }
        collapseStorageScope={collapseScope}
        collapseStorageKey="inspector-session-document-context"
        collapsible
        testId="document-context-section"
        title={t("session.documentContext")}
      >
        <div className="pc-form-stack">
          <InfoGrid
            items={[
              { label: "Session ID", value: sessionId ?? "-" },
              { label: "Replayable Ops", value: documentRender?.processing?.document_replayable_ops ?? "-" },
            ]}
          />
          <label className="pc-field">
            <span>{t("session.savePath")}</span>
            <input onChange={(event) => setSavePath(event.target.value)} type="text" value={savePath} />
          </label>
        </div>
        {sessionActionState.status !== "idle" || saveResult ? (
          <ResultSummary
            detail={saveResult?.path ?? sessionActionState.detail ?? ""}
            meta={saveResult ? `${(saveResult.size / 1024).toFixed(1)} KB` : null}
            status={sessionSummaryStatus}
            testIds={{ root: "session-save-summary", status: "session-save-status-chip", detail: "session-save-path" }}
            title={t("labels.sessionSave")}
          />
        ) : null}
        {documentActionState.status !== "idle" || documentRender ? (
          <ResultSummary
            detail={documentRender?.session_id ?? documentActionState.detail ?? ""}
            meta={documentRender ? `${documentRender.processing?.document_replayable_ops ?? 0} replayable ops` : null}
            status={documentSummaryStatus}
            testIds={{ root: "document-render-summary", status: "document-render-status-chip", detail: "document-render-detail" }}
            title={t("labels.documentRender")}
          />
        ) : null}
      </PaneSection>
      {documentRender?.calibrated_image ? (
      <PaneSection
        collapseStorageScope={collapseScope}
        collapseStorageKey="inspector-session-document-preview"
        collapsible
        defaultCollapsed
        testId="document-preview-section"
        title={t("session.documentPreview")}
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
        testId="document-operations-section"
        title={t("session.documentOperations")}
      >
        <DetailList
          empty={t("common.none")}
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
