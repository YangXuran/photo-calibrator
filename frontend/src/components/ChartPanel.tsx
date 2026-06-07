import type { ReactNode } from "react";

type ChartPanelProps = {
  title: ReactNode;
  children: ReactNode;
};

export function ChartPanel({ title, children }: ChartPanelProps) {
  return (
    <div className="pc-chart-card">
      <span className="pc-chart-title">{title}</span>
      {children}
    </div>
  );
}
