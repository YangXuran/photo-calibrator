import type { SessionListItem } from "../types";
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
          刷新
        </button>
      }
      meta="受管 session 存储"
      testId="saved-sessions-section"
      title="Saved Sessions"
    >
      <div className="pc-list">
        {sessions.map((item) => (
          <SessionListItemCard item={item} key={item.path} onDelete={onDelete} onLoad={onLoad} />
        ))}
        {!sessions.length ? <div className="pc-empty-panel">暂无已保存 session。</div> : null}
      </div>
    </PaneSection>
  );
}
