import type { ReactNode } from "react";

type DialogSectionCardProps = {
  title: string;
  description?: string;
  children: ReactNode;
};

export function DialogSectionCard({ title, description, children }: DialogSectionCardProps) {
  return (
    <div className="pc-panel-card">
      <div className="pc-panel-card-header">
        <h4>{title}</h4>
        {description ? <span>{description}</span> : null}
      </div>
      <div className="pc-panel-card-body pc-stack">{children}</div>
    </div>
  );
}
