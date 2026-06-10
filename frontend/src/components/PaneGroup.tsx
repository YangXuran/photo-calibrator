import type { ReactNode } from "react";

type PaneGroupProps = {
  children: ReactNode;
  density?: "default" | "compact";
  emphasis?: "default" | "primary" | "muted";
  testId?: string;
};

export function PaneGroup({ children, density = "default", emphasis = "default", testId }: PaneGroupProps) {
  return (
    <section className={`pc-pane-group pc-pane-group-${density} pc-pane-group-${emphasis}`} data-testid={testId}>
      <div className="pc-pane-group-body">{children}</div>
    </section>
  );
}
