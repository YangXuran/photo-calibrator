import type { ActionState } from "../types";
import { getWorkflowActionLabel, type WorkflowActionKey } from "../lib/workflowStatus";
import { PaneSection } from "./PaneSection";
import { StatusChip } from "./StatusChip";

type ActionStatusCardProps = {
  density?: "default" | "compact";
  emphasis?: "default" | "primary" | "muted";
  states: {
    calibration: ActionState;
    filmScan: ActionState;
    export: ActionState;
    ai: ActionState;
    session: ActionState;
    document: ActionState;
  };
};

export function ActionStatusCard({ density = "compact", emphasis = "muted", states }: ActionStatusCardProps) {
  const entries = Object.entries(states).filter(([, value]) => value.status !== "idle");

  return (
    <PaneSection density={density} emphasis={emphasis} meta="当前动作状态" testId="action-status-section" title="Action Status">
      <div className="pc-action-status-list">
        {entries.map(([key, value]) => (
          <article className="pc-action-status-row" key={key}>
            <div className="pc-list-main">
              <strong>{getWorkflowActionLabel(key as WorkflowActionKey)}</strong>
              {value.detail ? <span>{value.detail}</span> : null}
            </div>
            <StatusChip status={value.status} />
          </article>
        ))}
        {!entries.length ? <div className="pc-empty-panel">Idle.</div> : null}
      </div>
    </PaneSection>
  );
}
