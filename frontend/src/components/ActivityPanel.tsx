import type { NotificationItem } from "../types";
import { t } from "../i18n";
import { PaneSection } from "./PaneSection";

type ActivityPanelProps = {
  items: NotificationItem[];
};

export function ActivityPanel({ items }: ActivityPanelProps) {
  return (
    <PaneSection density="compact" testId="activity-section" title={t("activity.title")}>
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
        {!items.length ? <div className="pc-empty-panel">{t("activity.empty")}</div> : null}
      </div>
    </PaneSection>
  );
}
