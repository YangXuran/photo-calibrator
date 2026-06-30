import type { AIEvaluationPayload, ActionState, DocumentRenderPayload, ExportPayload, SessionSavePayload } from "../types";
import { t } from "../i18n";

export type WorkflowActionKey = "calibration" | "filmScan" | "export" | "ai" | "session" | "document";

export type WorkflowFeedItem = {
  detail: string;
  key: WorkflowActionKey;
  meta: string;
  status: Exclude<ActionState["status"], "idle" | "running">;
  title: string;
};

const WORKFLOW_LABELS: Record<WorkflowActionKey, string> = {
  calibration: t("labels.calibration"),
  filmScan: t("labels.filmScan"),
  export: t("labels.export"),
  ai: t("labels.aiReview"),
  session: t("labels.session"),
  document: t("labels.document"),
};

const ACTION_STATUS_LABELS: Record<ActionState["status"], string> = {
  idle: t("labels.idle"),
  running: t("labels.running"),
  success: t("labels.complete"),
  error: t("labels.failed"),
};

export function getWorkflowActionLabel(key: WorkflowActionKey) {
  return WORKFLOW_LABELS[key];
}

export function getActionStatusLabel(status: ActionState["status"]) {
  return ACTION_STATUS_LABELS[status];
}

export function buildWorkflowFeedItems(input: {
  exportResult: ExportPayload | null;
  sessionSaveResult: SessionSavePayload | null;
  documentRender: DocumentRenderPayload | null;
  aiResult: AIEvaluationPayload | null;
}): WorkflowFeedItem[] {
  const items: WorkflowFeedItem[] = [];

  if (input.exportResult) {
    items.push({
      key: "export",
      title: getWorkflowActionLabel("export"),
      status: "success",
      meta: `${input.exportResult.format.toUpperCase()} / ${(input.exportResult.size / 1024).toFixed(1)} KB`,
      detail: input.exportResult.path,
    });
  }

  if (input.sessionSaveResult) {
    items.push({
      key: "session",
      title: getWorkflowActionLabel("session"),
      status: "success",
      meta: `${(input.sessionSaveResult.size / 1024).toFixed(1)} KB`,
      detail: input.sessionSaveResult.path,
    });
  }

  if (input.documentRender) {
    items.push({
      key: "document",
      title: getWorkflowActionLabel("document"),
      status: "success",
      meta: `${input.documentRender.processing?.document_replayable_ops ?? 0} replayable ops`,
      detail: input.documentRender.session_id,
    });
  }

  if (input.aiResult) {
    items.push({
      key: "ai",
      title: getWorkflowActionLabel("ai"),
      status: input.aiResult.ok ? "success" : "error",
      meta: `${input.aiResult.evaluator_name} / ${input.aiResult.elapsed_ms?.toFixed(1) ?? "-"} ms`,
      detail: input.aiResult.evaluation?.summary ?? input.aiResult.error ?? "No summary",
    });
  }

  return items;
}
