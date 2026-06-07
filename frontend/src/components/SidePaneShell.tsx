import type { ReactNode } from "react";

type SidePaneShellProps = {
  children: ReactNode;
  header: ReactNode;
  side: "left" | "right";
  testId: string;
};

export function SidePaneShell({ children, header, side, testId }: SidePaneShellProps) {
  return (
    <aside className={`pc-pane pc-pane-${side}`} data-testid={testId}>
      <div className="pc-pane-scroll">
        {header}
        {children}
      </div>
    </aside>
  );
}
