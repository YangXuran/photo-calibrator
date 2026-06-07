import type { ReactNode } from "react";

type PaneGroupProps = {
  title: string;
  meta?: string;
  children: ReactNode;
  density?: "default" | "compact";
  emphasis?: "default" | "primary" | "muted";
  testId?: string;
};

export function PaneGroup({ title, meta, children, density = "default", emphasis = "default", testId }: PaneGroupProps) {
  return (
    <section className={`pc-pane-group pc-pane-group-${density} pc-pane-group-${emphasis}`} data-testid={testId}>
      <header className="pc-pane-group-header">
        <span className="pc-pane-group-title">{title}</span>
        {meta ? <span className="pc-pane-group-meta">{meta}</span> : null}
      </header>
      <div className="pc-pane-group-body">{children}</div>
    </section>
  );
}
