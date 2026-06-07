import type { ReactNode } from "react";

type TopbarGroupProps = {
  children: ReactNode;
  className?: string;
  testId?: string;
};

export function TopbarGroup({ children, className, testId }: TopbarGroupProps) {
  return (
    <div className={`pc-topbar-group${className ? ` ${className}` : ""}`} data-testid={testId}>
      {children}
    </div>
  );
}
