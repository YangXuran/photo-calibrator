import type { ReactNode } from "react";

export type InfoGridItem = {
  label: ReactNode;
  value: ReactNode;
};

type InfoGridProps = {
  items: InfoGridItem[];
};

export function InfoGrid({ items }: InfoGridProps) {
  return (
    <div className="pc-info-grid">
      {items.map((item, index) => (
        <div className="pc-info-cell" key={`${index}`}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}
