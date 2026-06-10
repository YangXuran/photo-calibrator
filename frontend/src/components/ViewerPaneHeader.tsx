import type { ReactNode } from "react";

type ViewerPaneHeaderProps = {
  title?: string;
  meta?: string;
  controls?: ReactNode;
  focusMode?: boolean;
  status?: ReactNode;
  density?: "default" | "compact";
  emphasis?: "default" | "primary" | "muted";
};

export function ViewerPaneHeader({
  title,
  meta,
  controls,
  focusMode = false,
  status,
  density = "default",
  emphasis = "default",
}: ViewerPaneHeaderProps) {
  return (
    <>
      {!focusMode && controls ? (
        <div
          className={`pc-pane-header pc-viewer-pane-header pc-viewer-pane-header-${density} pc-viewer-pane-header-${emphasis}`}
          data-testid="viewer-pane-header"
        >
          <div className="pc-toolbar-cluster">{controls}</div>
        </div>
      ) : null}
      {!focusMode ? status : null}
    </>
  );
}
