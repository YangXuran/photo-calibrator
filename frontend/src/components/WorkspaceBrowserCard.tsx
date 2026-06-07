import type { SourceFilter } from "../types";
import { PaneSection } from "./PaneSection";

type WorkspaceBrowserCardProps = {
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  sourceFilter: SourceFilter;
  setSourceFilter: (value: SourceFilter) => void;
  counts: {
    all: number;
    file: number;
    session: number;
  };
  canRemoveSelected: boolean;
  canClearWorkspace: boolean;
  onRemoveSelected: () => void;
  onClearWorkspace: () => void;
};

const FILTERS: Array<{ id: SourceFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "file", label: "文件" },
  { id: "session", label: "Session" },
];

export function WorkspaceBrowserCard({
  searchQuery,
  setSearchQuery,
  sourceFilter,
  setSourceFilter,
  counts,
  canRemoveSelected,
  canClearWorkspace,
  onRemoveSelected,
  onClearWorkspace,
}: WorkspaceBrowserCardProps) {
  return (
    <PaneSection density="compact" meta="浏览、筛选和清理当前工作区" testId="workspace-browser-section" title="Workspace Browser">
      <div className="pc-form-stack">
        <label className="pc-field">
          <span>搜索</span>
          <input data-testid="workspace-search-input" onChange={(event) => setSearchQuery(event.target.value)} placeholder="按文件名筛选" type="text" value={searchQuery} />
        </label>
        <div className="pc-filter-row">
          {FILTERS.map((filter) => (
            <button
              className={`pc-filter-pill ${sourceFilter === filter.id ? "is-active" : ""}`}
              data-testid={`workspace-filter-${filter.id}`}
              key={filter.id}
              onClick={() => setSourceFilter(filter.id)}
              type="button"
            >
              <span>{filter.label}</span>
              <strong>{counts[filter.id]}</strong>
            </button>
          ))}
        </div>
        <div className="pc-inline-actions">
          <button className="pc-button pc-button-secondary pc-button-small" data-testid="workspace-remove-selected" disabled={!canRemoveSelected} onClick={onRemoveSelected} type="button">
            移除当前项
          </button>
          <button className="pc-button pc-button-secondary pc-button-small" data-testid="workspace-clear-all" disabled={!canClearWorkspace} onClick={onClearWorkspace} type="button">
            清空工作区
          </button>
        </div>
      </div>
    </PaneSection>
  );
}
