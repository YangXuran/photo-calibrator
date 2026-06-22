import type { NotificationItem } from "../types";
import { PaneSection } from "./PaneSection";

type ActivityPanelProps = {
  items: NotificationItem[];
};

export function ActivityPanel({ items }: ActivityPanelProps) {
  return (
    <PaneSection density="compact" testId="activity-section" title="活动记录">
      <div className="pc-list">
        {items.map((item) => (
          <article className="pc-list-item" data-testid="activity-item" key={item.id}>
            <div className="pc-list-main">
              <strong>{item.title}</strong>
              <span>{item.tone}</span>
            </div>
            <span className="pc-body-text">{item.message}</span>
          </article>
        ))}
        {!items.length ? <div className="pc-empty-panel">还没有活动记录。</div> : null}
      </div>
    </PaneSection>
  );
}
