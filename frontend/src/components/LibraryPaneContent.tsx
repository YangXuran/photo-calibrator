import type { WorkbenchController } from "../hooks/useWorkbench";
import { getLibraryPanePresentation, getLibrarySectionOrder, type LibraryPaneSectionId } from "../lib/layoutPresets";
import { LibraryContextSection } from "./LibraryContextSection";
import { LibraryToolsSection } from "./LibraryToolsSection";
import { LibraryWorkspaceSection } from "./LibraryWorkspaceSection";

type LibraryPaneContentProps = {
  workbench: WorkbenchController;
};

export function LibraryPaneContent({ workbench }: LibraryPaneContentProps) {
  const sectionOrder = getLibrarySectionOrder(workbench.activeLayoutPreset);
  const sections: Partial<Record<LibraryPaneSectionId, JSX.Element>> = {
    workspace: (
      <LibraryWorkspaceSection
        workbench={workbench}
        {...getLibraryPanePresentation(workbench.activeLayoutPreset, "workspace")}
      />
    ),
    context: (
      <LibraryContextSection
        workbench={workbench}
        {...getLibraryPanePresentation(workbench.activeLayoutPreset, "context")}
      />
    ),
    tools: (
      <LibraryToolsSection
        workbench={workbench}
        {...getLibraryPanePresentation(workbench.activeLayoutPreset, "tools")}
      />
    ),
  };

  return (
    <>
      {sectionOrder.map((sectionId) => (
        <div key={sectionId}>{sections[sectionId]}</div>
      ))}
    </>
  );
}
