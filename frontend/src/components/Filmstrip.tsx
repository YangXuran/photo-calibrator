import { useEffect, useRef } from "react";
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
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    if (!selectedId) return;
    const node = itemRefs.current[selectedId];
    node?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [selectedId]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
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
