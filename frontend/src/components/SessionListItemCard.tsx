import type { SessionListItem } from "../types";

type SessionListItemCardProps = {
  item: SessionListItem;
  onLoad: (item: SessionListItem) => void;
  onDelete: (item: SessionListItem) => void;
};

function fmtTime(value?: number) {
  if (!value) return "-";
  return new Date(value * 1000).toLocaleString();
}

function sessionPathName(path: string) {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export function SessionListItemCard({ item, onLoad, onDelete }: SessionListItemCardProps) {
  return (
    <article className="pc-list-item pc-session-item" data-testid="saved-session-item">
      <div className="pc-list-main">
        <strong data-testid="saved-session-id">{item.session_id}</strong>
        <span title={item.path}>{sessionPathName(item.path)}</span>
      </div>
      <div className="pc-tag-row">
        {item.preview_source ? <span className="pc-tag">{item.preview_source}</span> : null}
        {item.analysis_width && item.analysis_height ? <span className="pc-tag">{`${item.analysis_width}×${item.analysis_height}`}</span> : null}
        <span className="pc-tag">{`${(item.size / 1024).toFixed(1)} KB`}</span>
      </div>
      <div className="pc-meta-row">
        <span>{fmtTime(item.saved_at)}</span>
      </div>
      <div className="pc-inline-actions">
        <button className="pc-button pc-button-secondary pc-button-small" data-testid="saved-session-load" onClick={() => onLoad(item)} type="button">
          加载
        </button>
        <button className="pc-button pc-button-secondary pc-button-small" data-testid="saved-session-delete" onClick={() => onDelete(item)} type="button">
          删除
        </button>
      </div>
    </article>
  );
}
