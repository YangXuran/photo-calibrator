import type { HistoryEntry } from "../types";
import { EmptyPanel } from "./EmptyPanel";

type HistoryPanelProps = {
  entries: HistoryEntry[];
  currentIndex: number;
  onUndo: () => void;
  onRedo: () => void;
};

const OPERATION_COLORS: Record<string, string> = {
  "rgb-curves": "#60a5fa",
  global: "#34d399",
  "skin-priority": "#f59e0b",
  "highlights-only": "#fb7185",
  matrix: "#a78bfa",
  lut3d: "#f472b6",
  film: "#38bdf8",
  "negative-film": "#22d3ee",
};

function resolveDotColor(entry: HistoryEntry): string {
  for (const [key, color] of Object.entries(OPERATION_COLORS)) {
    if (entry.description.includes(key) || entry.current_op_name.includes(key)) {
      return color;
    }
  }
  return "var(--accent)";
}

export function HistoryPanel({ entries, currentIndex, onUndo, onRedo }: HistoryPanelProps) {
  const canUndo = currentIndex > 0;
  const canRedo = currentIndex < entries.length - 1;

  if (!entries.length) {
    return (
      <div className="pc-history-panel" data-testid="history-panel">
        <div className="pc-history-toolbar">
          <button className="pc-history-btn" disabled data-testid="history-undo-btn" type="button">
            ←
          </button>
          <button className="pc-history-btn" disabled data-testid="history-redo-btn" type="button">
            →
          </button>
        </div>
        <EmptyPanel>No modifications yet</EmptyPanel>
      </div>
    );
  }

  return (
    <div className="pc-history-panel" data-testid="history-panel">
      <div className="pc-history-toolbar">
        <button
          className="pc-history-btn"
          disabled={!canUndo}
          onClick={onUndo}
          data-testid="history-undo-btn"
          type="button"
        >
          ←
        </button>
        <button
          className="pc-history-btn"
          disabled={!canRedo}
          onClick={onRedo}
          data-testid="history-redo-btn"
          type="button"
        >
          →
        </button>
        <span className="pc-history-count">
          {currentIndex + 1} / {entries.length}
        </span>
      </div>
      <div className="pc-history-list">
        {entries.map((entry, index) => {
          const isCurrent = index === currentIndex;
          return (
            <div
              key={`${entry.timestamp}-${index}`}
              className={`pc-history-entry ${isCurrent ? "is-current" : ""} ${index > currentIndex ? "is-future" : ""}`}
            >
              <span className="pc-history-dot" style={{ backgroundColor: resolveDotColor(entry) }} />
              <span className="pc-history-time">{entry.timestamp}</span>
              <span className="pc-history-desc">{entry.description}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
