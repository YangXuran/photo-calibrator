import type { ReactNode } from "react";

type TopbarStatusPillTone = "default" | "ok" | "bad" | "shell";

type TopbarStatusPillProps = {
  children: ReactNode;
  testId?: string;
  tone?: TopbarStatusPillTone;
};

export function TopbarStatusPill({ children, testId, tone = "default" }: TopbarStatusPillProps) {
  const toneClass = tone === "default" ? "" : ` is-${tone}`;

  return (
    <span className={`pc-status-pill pc-status-pill-compact${toneClass}`} data-testid={testId}>
      {children}
    </span>
  );
}
