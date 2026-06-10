import { useEffect, useMemo, useRef } from "react";
import type { WorkspaceFile } from "../types";
import { FilmstripItem } from "./FilmstripItem";

type FilmstripProps = {
  files: WorkspaceFile[];
  selectedId?: string;
  onSelect: (id: string) => void;
  density?: "default" | "compact";
  showDetail?: boolean;
  showMeta?: boolean;
  showStateChip?: boolean;
};

export function Filmstrip({
  files,
  selectedId,
  onSelect,
  density = "default",
  showDetail = true,
  showMeta = true,
  showStateChip = true,
}: FilmstripProps) {
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (!selectedId) return;
    const node = itemRefs.current[selectedId];
    node?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [selectedId]);

  const loadingCount = useMemo(() => files.filter((f) => f.thumbnailLoading).length, [files]);
  const totalCount = files.length;
  const progressPercent = totalCount > 0 ? ((totalCount - loadingCount) / totalCount) * 100 : 100;

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>, index: number) {
    if (!files.length) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      onSelect(files[Math.max(0, index - 1)]!.id);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      onSelect(files[Math.min(files.length - 1, index + 1)]!.id);
    } else if (event.key === "Home") {
      event.preventDefault();
      onSelect(files[0]!.id);
    } else if (event.key === "End") {
      event.preventDefault();
      onSelect(files[files.length - 1]!.id);
    }
  }

  return (
    <div
      aria-label="Filmstrip"
      className={`pc-filmstrip pc-filmstrip-${density}`}
      data-testid="workbench-filmstrip"
      role="listbox"
    >
      {loadingCount > 0 ? (
        <div className="pc-filmstrip-progress" data-testid="filmstrip-progress">
          <div className="pc-filmstrip-progress-bar">
            <div className="pc-filmstrip-progress-fill" style={{ width: `${progressPercent}%` }} />
          </div>
          <span className="pc-filmstrip-progress-text">{totalCount - loadingCount}/{totalCount}</span>
        </div>
      ) : null}
      {files.map((item, index) => (
        <FilmstripItem
          buttonRef={(node) => {
            itemRefs.current[item.id] = node;
          }}
          density={density}
          index={index}
          item={item}
          key={item.id}
          onKeyDown={handleKeyDown}
          onSelect={onSelect}
          selected={item.id === selectedId}
          showDetail={showDetail}
          showMeta={showMeta}
          showStateChip={showStateChip}
        />
      ))}
    </div>
  );
}
