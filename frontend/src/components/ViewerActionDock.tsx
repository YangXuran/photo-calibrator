import type { ReactNode } from "react";

type ViewerActionDockProps = {
  cropPriority?: "primary" | "secondary" | "hidden";
  status?: string;
  actions?: ReactNode;
};

export function ViewerActionDock({ status, actions, cropPriority = "secondary" }: ViewerActionDockProps) {
  if (!status && !actions) return null;

  return (
    <div className="pc-action-dock" data-testid="focus-action-dock">
      {status ? (
        <div className="pc-action-dock-block">
          <span className="pc-action-dock-label">Crop</span>
          <strong className="pc-action-dock-value" data-testid="focus-crop-value">
            {status}
          </strong>
        </div>
      ) : null}
      {actions ? (
        <div className="pc-action-dock-block">
          <span className="pc-action-dock-label">Actions</span>
          <div className="pc-action-dock-buttons">{actions}</div>
        </div>
      ) : null}
    </div>
  );
}
