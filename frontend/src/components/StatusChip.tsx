import { getActionStatusLabel } from "../lib/workflowStatus";
import type { ActionState } from "../types";

type StatusChipProps = {
  status: ActionState["status"] | "success" | "error";
  testId?: string;
};

export function StatusChip({ status, testId }: StatusChipProps) {
  const normalizedStatus = status === "idle" ? "running" : status;

  return (
    <span className={`pc-status-chip pc-status-chip-${normalizedStatus}`} data-testid={testId}>
      {getActionStatusLabel(normalizedStatus)}
    </span>
  );
}
