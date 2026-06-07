import type { ReactNode } from "react";

type DetailNoteProps = {
  title: ReactNode;
  body: ReactNode;
  tone?: "default" | "danger";
  compact?: boolean;
  testId?: string;
};

export function DetailNote({ title, body, testId, tone = "default", compact = false }: DetailNoteProps) {
  const className = [
    "pc-note",
    compact ? "pc-note-compact" : "",
    tone === "danger" ? "pc-note-danger" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={className} data-testid={testId}>
      <strong>{title}</strong>
      <span>{body}</span>
    </div>
  );
}
