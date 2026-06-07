import type { ReactNode } from "react";

type EmptyPanelProps = {
  children: ReactNode;
};

export function EmptyPanel({ children }: EmptyPanelProps) {
  return <div className="pc-empty-panel">{children}</div>;
}
