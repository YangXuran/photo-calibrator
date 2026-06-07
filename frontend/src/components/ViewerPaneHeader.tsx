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
      <div
        className={`pc-pane-header pc-viewer-pane-header pc-viewer-pane-header-${density} pc-viewer-pane-header-${emphasis} ${focusMode ? "is-focus" : ""}`}
        data-testid="viewer-pane-header"
      >
        <div className="pc-stage-meta">
          <span className="pc-overline">Viewer</span>
          <strong>{title ?? "未选择照片"}</strong>
          {meta ? (
            <span className="pc-stage-hint" data-testid="viewer-pane-meta">
              {meta}
            </span>
          ) : null}
        </div>
        {!focusMode ? <div className="pc-toolbar-cluster">{controls}</div> : null}
      </div>
      {!focusMode ? status : null}
    </>
  );
}
