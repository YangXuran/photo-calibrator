import type { ViewerStatusPresentation } from "./viewerStatusPresentation";

type ViewerStatusStripProps = {
  mode?: "full" | "minimal" | "compact";
  presentation: ViewerStatusPresentation;
  density?: "default" | "compact";
  emphasis?: "default" | "muted";
};

export function ViewerStatusStrip({ mode = "full", presentation, density = "default", emphasis = "default" }: ViewerStatusStripProps) {
  const { summary, zoomLabel } = presentation;

  return (
    <div
      className={`pc-viewer-statusbar pc-viewer-statusbar-${density} pc-viewer-statusbar-${emphasis}`}
      data-testid="viewer-statusbar"
    >
      <span className={`pc-source-pill pc-source-pill-state pc-source-pill-${summary.stateTone}`} data-testid="viewer-status-state">
        {summary.stateLabel}
      </span>
      {mode !== "compact" && mode !== "minimal" ? (
        <span className={summary.hasOriginalFile ? "pc-source-pill" : "pc-source-pill is-muted"} data-testid="viewer-status-export">
          {summary.exportLabel}
        </span>
      ) : null}
      {mode !== "minimal" ? (
        <span className="pc-source-pill is-muted" data-testid="viewer-status-zoom">
          {zoomLabel}
        </span>
      ) : null}
    </div>
  );
}
