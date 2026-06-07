import type { ReactNode } from "react";

type ViewerFocusToolbarBlockTone = "primary" | "secondary" | "tertiary";

type ViewerFocusToolbarBlockProps = {
  children: ReactNode;
  label: string;
  testId?: string;
  tone?: ViewerFocusToolbarBlockTone;
  value: ReactNode;
  valueTestId?: string;
};

export function ViewerFocusToolbarBlock({
  children,
  label,
  testId,
  tone = "primary",
  value,
  valueTestId,
}: ViewerFocusToolbarBlockProps) {
  return (
    <div className={`pc-focus-toolbar-block is-${tone}`} data-testid={testId}>
      <div className="pc-focus-toolbar-meta">
        <span className="pc-focus-toolbar-label">{label}</span>
        <strong className="pc-focus-toolbar-value" data-testid={valueTestId}>
          {value}
        </strong>
      </div>
      {children}
    </div>
  );
}
