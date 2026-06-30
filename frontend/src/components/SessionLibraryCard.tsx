import type { SessionListItem } from "../types";
import { t } from "../i18n";
import { PaneSection } from "./PaneSection";
import { SessionListItemCard } from "./SessionListItemCard";

type SessionLibraryCardProps = {
  sessions: SessionListItem[];
  onRefresh: () => void;
  onLoad: (item: SessionListItem) => void;
  onDelete: (item: SessionListItem) => void;
};

export function SessionLibraryCard({ sessions, onRefresh, onLoad, onDelete }: SessionLibraryCardProps) {
  return (
    <PaneSection
      density="compact"
      actions={
        <button className="pc-button pc-button-secondary pc-button-small" data-testid="saved-sessions-refresh" onClick={onRefresh} type="button">
          {t("session.refresh")}
        </button>
      }
      testId="saved-sessions-section"
      title={t("session.savedTitle")}
    >
      <div className="pc-list">
        {sessions.map((item) => (
          <SessionListItemCard item={item} key={item.path} onDelete={onDelete} onLoad={onLoad} />
        ))}
        {!sessions.length ? <div className="pc-empty-panel">{t("common.none")}</div> : null}
      </div>
    </PaneSection>
  );
}
