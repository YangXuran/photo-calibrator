import { useState } from "react";
import type { WorkspaceFile } from "../types";
import { getWorkspaceStateSummary } from "../lib/workspaceStatus";
import { FilmstripItemMeta } from "./FilmstripItemMeta";

type FilmstripItemProps = {
  item: WorkspaceFile;
  index: number;
  selected: boolean;
  onSelect: (id: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => void;
  buttonRef: (node: HTMLButtonElement | null) => void;
  density: "default" | "compact";
  showDetail: boolean;
  showMeta: boolean;
  showStateChip: boolean;
};

function itemStateTone(item: WorkspaceFile) {
  const tone = getWorkspaceStateSummary(item).stateTone;
  if (tone === "accent") return "is-accent";
  if (tone === "warning") return "is-warning";
  if (tone === "success") return "is-success";
  return "is-neutral";
}


export function FilmstripItem({
  item,
  index,
  selected,
  onSelect,
  onKeyDown,
  buttonRef,
  density,
  showDetail,
  showMeta,
  showStateChip,
}: FilmstripItemProps) {
  const summary = getWorkspaceStateSummary(item);
  const [imgError, setImgError] = useState(false);
  const src = item.thumbnailUrl || item.displayUrl;

  return (
    <button
      aria-selected={selected}
      className={`pc-thumb pc-thumb-${density} ${selected ? "is-active" : ""}`}
      data-testid="filmstrip-item"
      onKeyDown={(event) => onKeyDown(event, index)}
      onClick={() => onSelect(item.id)}
      ref={buttonRef}
      role="option"
      tabIndex={selected || index === 0 ? 0 : -1}
      type="button"
    >
      <div className="pc-thumb-image-wrap">
        {src && !imgError ? (
          <img
            alt={item.name}
            src={src}
            loading="lazy"
            decoding="async"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="pc-thumb-placeholder" aria-label={item.name}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          </div>
        )}
        {showStateChip ? (
          <span className={`pc-thumb-statechip ${itemStateTone(item)}`}>{summary.stateLabel}</span>
        ) : null}
      </div>
      <FilmstripItemMeta item={item} showDetail={showDetail} showMeta={showMeta} />
      <span>{item.name}</span>
    </button>
  );
}
