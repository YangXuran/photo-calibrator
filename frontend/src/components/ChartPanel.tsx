import type { ReactNode } from "react";

type ChartPanelProps = {
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
};

export function ChartPanel({ title, actions, children }: ChartPanelProps) {
  return (
    <div className="pc-chart-card">
      <div className="pc-chart-header">
        <span className="pc-chart-title">{title}</span>
        {actions ? <div className="pc-chart-actions">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}
