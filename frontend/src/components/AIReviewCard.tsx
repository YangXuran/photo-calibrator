import type { AIEvaluationPayload, ActionState, EvaluatorInfo } from "../types";
import { t } from "../i18n";
import { BarChart } from "./BarChart";
import { ChartPanel } from "./ChartPanel";
import { DetailList } from "./DetailList";
import { DetailNote } from "./DetailNote";
import { PaneSection } from "./PaneSection";
import { ResultSummary } from "./ResultSummary";

type AIReviewCardProps = {
  collapseScope?: string;
  evaluators: EvaluatorInfo[];
  selectedEvaluator: string;
  setSelectedEvaluator: (value: string) => void;
  context: string;
  setContext: (value: string) => void;
  result: AIEvaluationPayload | null;
  actionState: ActionState;
  onEvaluate: () => void;
};

export function AIReviewCard({ collapseScope, evaluators, selectedEvaluator, setSelectedEvaluator, context, setContext, result, actionState, onEvaluate }: AIReviewCardProps) {
  const summaryStatus = result ? (result.ok ? "success" : "error") : actionState.status;
  const summaryDetail =
    result?.evaluation?.summary ??
    result?.error ??
    actionState.detail ??
    "";
  const evaluation = result?.evaluation;

  return (
    <PaneSection
      actions={
        <button className="pc-button pc-button-secondary pc-button-small" data-testid="ai-evaluate-button" onClick={onEvaluate} type="button">
          {t("ai.evaluate")}
        </button>
      }
      collapseStorageScope={collapseScope}
      collapseStorageKey="inspector-analysis-ai-review"
      collapsible
      testId="ai-review-section"
      title={t("labels.aiReview")}
    >
      <div className="pc-form-stack">
        <label className="pc-field">
          <span>{t("labels.evaluator")}</span>
          <select data-testid="ai-evaluator-select" onChange={(event) => setSelectedEvaluator(event.target.value)} value={selectedEvaluator}>
            {evaluators.map((evaluator) => (
              <option key={evaluator.id} value={evaluator.id}>
                {evaluator.name}
              </option>
            ))}
          </select>
        </label>
        <label className="pc-field">
          <span>{t("ai.targetContext")}</span>
          <textarea className="pc-textarea" onChange={(event) => setContext(event.target.value)} rows={4} value={context} />
        </label>
      </div>
      {actionState.status !== "idle" || result ? (
        <div className="pc-stack">
          <ResultSummary
            detail={summaryDetail}
            meta={result ? `${result.evaluator_name} / ${result.elapsed_ms?.toFixed(1) ?? "-"} ms / ${result.request?.provider?.type ?? "plugin"}` : null}
            status={summaryStatus}
            testIds={{ root: "ai-result-summary", status: "ai-status-chip", detail: "ai-result-detail" }}
            title={t("labels.aiReview")}
          />
          {evaluation?.summary ? (
            <DetailNote body={evaluation.summary} title={t("labels.summary")} />
          ) : null}
          {evaluation?.rationale ? (
            <DetailNote body={evaluation.rationale} title={t("labels.rationale")} />
          ) : null}
          {evaluation?.scores?.length ? (
            <ChartPanel title={t("labels.scores")}>
              <BarChart format={(value) => value.toFixed(2)} items={evaluation.scores.map((score) => ({ name: score.name, value: score.value }))} />
            </ChartPanel>
          ) : null}
          {evaluation?.issues?.length ? (
            <DetailList
              items={evaluation.issues.map((issue) => ({
                title: issue.type ?? "issue",
                meta: issue.severity ?? "info",
                body: issue.message ?? "-",
              }))}
            />
          ) : null}
          {evaluation?.suggestions?.length ? (
            <DetailList
              items={evaluation.suggestions.map((suggestion) => ({
                title: suggestion.operation ?? "adjustment",
                meta: `confidence ${suggestion.confidence?.toFixed(2) ?? "-"}`,
                code: JSON.stringify(suggestion.params ?? {}, null, 2),
              }))}
            />
          ) : null}
          {result?.error ? <DetailNote body={result.error} title={t("labels.error")} tone="danger" /> : null}
        </div>
      ) : null}
    </PaneSection>
  );
}
