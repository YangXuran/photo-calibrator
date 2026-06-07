import type { ActionState } from "../types";
import { StatusChip } from "./StatusChip";

type ResultSummaryProps = {
  title: string;
  status: ActionState["status"] | "success" | "error";
  detail: string;
  meta?: string | null;
  testIds?: {
    root?: string;
    status?: string;
    detail?: string;
  };
};

export function ResultSummary({ title, status, detail, meta, testIds }: ResultSummaryProps) {
  return (
    <div className="pc-result-summary" data-testid={testIds?.root}>
      <div className="pc-result-header">
        <strong>{title}</strong>
        <StatusChip status={status} testId={testIds?.status} />
      </div>
      <span className="pc-body-text" data-testid={testIds?.detail}>
        {detail}
      </span>
      {meta ? <span className="pc-body-text">{meta}</span> : null}
    </div>
  );
}
