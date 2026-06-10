import type { AIEvaluationPayload, ActionState, EvaluatorInfo } from "../types";
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
    "等待 AI 评估结果。";
  const evaluation = result?.evaluation;

  return (
    <PaneSection
      actions={
        <button className="pc-button pc-button-secondary pc-button-small" data-testid="ai-evaluate-button" onClick={onEvaluate} type="button">
          AI 评估
        </button>
      }
      collapseStorageScope={collapseScope}
      collapseStorageKey="inspector-analysis-ai-review"
      collapsible
      meta=""
      testId="ai-review-section"
      title="AI Review"
    >
      <div className="pc-form-stack">
        <label className="pc-field">
          <span>Evaluator</span>
          <select data-testid="ai-evaluator-select" onChange={(event) => setSelectedEvaluator(event.target.value)} value={selectedEvaluator}>
            {evaluators.map((evaluator) => (
              <option key={evaluator.id} value={evaluator.id}>
                {evaluator.name}
              </option>
            ))}
          </select>
        </label>
        <label className="pc-field">
          <span>目标上下文</span>
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
            title="AI Review"
          />
          {evaluation?.summary ? (
            <DetailNote body={evaluation.summary} title="Summary" />
          ) : null}
          {evaluation?.rationale ? (
            <DetailNote body={evaluation.rationale} title="Rationale" />
          ) : null}
          {evaluation?.scores?.length ? (
            <ChartPanel title="Scores">
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
          {result?.error ? <DetailNote body={result.error} title="Error" tone="danger" /> : null}
        </div>
      ) : null}
    </PaneSection>
  );
}
