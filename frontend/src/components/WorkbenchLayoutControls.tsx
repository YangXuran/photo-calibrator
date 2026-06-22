import type { WorkbenchController } from "../hooks/useWorkbench";
import { TopbarGroup } from "./TopbarGroup";

type LayoutToggleButtonProps = {
  active: boolean;
  children: string;
  onClick: () => void;
  testId: string;
  tone?: "default" | "focus";
};

function LayoutToggleButton({ active, children, onClick, testId, tone = "default" }: LayoutToggleButtonProps) {
  return (
    <button
      className={`pc-layout-toggle ${active ? "is-active" : ""}${active && tone === "focus" ? " is-focus" : ""}`}
      data-testid={testId}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

type WorkbenchLayoutControlsProps = {
  workbench: Pick<WorkbenchController, "layoutState" | "toggleLayoutElement" | "toggleViewerFocusMode">;
};

export function WorkbenchLayoutControls({ workbench }: WorkbenchLayoutControlsProps) {
  const toggles = [
    {
      active: workbench.layoutState.showAnalysisPane,
      label: "Analysis",
      onClick: () => workbench.toggleLayoutElement("analysis"),
      testId: "toggle-analysis-pane",
    },
    {
      active: workbench.layoutState.showFilmstrip,
      label: "Filmstrip",
      onClick: () => workbench.toggleLayoutElement("filmstrip"),
      testId: "toggle-filmstrip-pane",
    },
    {
      active: workbench.layoutState.showInspectorPane,
      label: "Inspector",
      onClick: () => workbench.toggleLayoutElement("inspector"),
      testId: "toggle-inspector-pane",
    },
    {
      active: workbench.layoutState.viewerFocusMode,
      label: workbench.layoutState.viewerFocusMode ? "Exit Focus" : "Focus",
      onClick: workbench.toggleViewerFocusMode,
      testId: "toggle-viewer-focus",
      tone: "focus" as const,
    },
  ];

  return (
    <div className="pc-layout-controls" data-testid="layout-quick-controls">
      <TopbarGroup className="pc-layout-toggles">
        {toggles.map((toggle) => (
          <LayoutToggleButton active={toggle.active} key={toggle.testId} onClick={toggle.onClick} testId={toggle.testId} tone={toggle.tone}>
            {toggle.label}
          </LayoutToggleButton>
        ))}
      </TopbarGroup>
    </div>
  );
}
