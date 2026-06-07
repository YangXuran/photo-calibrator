import type { WorkspaceFile } from "../types";
import { getWorkspaceStateSummary } from "../lib/workspaceStatus";

type FilmstripItemMetaProps = {
  item: WorkspaceFile;
  showDetail: boolean;
  showMeta: boolean;
};

function itemDetail(item: WorkspaceFile) {
  const parts = [];
  const summary = getWorkspaceStateSummary(item);
  if (summary.sizeLabel !== "-") parts.push(summary.sizeLabel);
  return parts.join(" · ");
}

export function FilmstripItemMeta({ item, showDetail, showMeta }: FilmstripItemMetaProps) {
  const summary = getWorkspaceStateSummary(item);
  return (
    <>
      {showMeta ? (
        <div className="pc-thumb-meta" data-testid="filmstrip-item-meta">
          {item.kind === "session" ? <span className="pc-thumb-badge is-session">Session</span> : null}
          {summary.cropLabel !== "No crop" ? <span className={`pc-thumb-badge ${item.cropEdited ? "is-accent" : ""}`}>{summary.cropLabel}</span> : null}
          {summary.colorSpaceLabel !== "-" && summary.colorSpaceLabel !== "sRGB" ? <span className="pc-thumb-badge">{summary.colorSpaceLabel}</span> : null}
        </div>
      ) : null}
      {showDetail && itemDetail(item) ? (
        <span className="pc-thumb-detail" data-testid="filmstrip-item-detail">
          {itemDetail(item)}
        </span>
      ) : null}
    </>
  );
}
