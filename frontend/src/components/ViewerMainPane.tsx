import type { ReactNode } from "react";
import { ViewerPaneHeader } from "./ViewerPaneHeader";

type ViewerMainPaneProps = {
  title?: string;
  meta?: string;
  controls?: ReactNode;
  status?: ReactNode;
  stage: ReactNode;
  focusMode?: boolean;
  density?: "default" | "compact";
  emphasis?: "default" | "primary" | "muted";
};

export function ViewerMainPane({
  title,
  meta,
  controls,
  status,
  stage,
  focusMode = false,
  density = "default",
  emphasis = "default",
}: ViewerMainPaneProps) {
  return (
    <main className="pc-pane pc-pane-center" data-testid="viewer-pane">
      <ViewerPaneHeader
        controls={controls}
        density={density}
        emphasis={emphasis}
        focusMode={focusMode}
        meta={meta}
        status={status}
        title={title}
      />
      {stage}
    </main>
  );
}
