import type { WorkbenchController } from "../hooks/useWorkbench";
import { getFilmstripPresentation } from "../lib/layoutPresets";
import { Filmstrip } from "./Filmstrip";

type ViewerFilmstripPaneProps = {
  workbench: WorkbenchController;
};

export function ViewerFilmstripPane({ workbench }: ViewerFilmstripPaneProps) {
  const presentation = getFilmstripPresentation();
  return (
    <section
      className={`pc-pane pc-filmstrip-pane pc-filmstrip-pane-${presentation.density} pc-filmstrip-pane-${presentation.emphasis}`}
      data-testid="filmstrip-pane"
    >
      <Filmstrip
        density={presentation.density}
        files={workbench.filteredFiles}
        onSelect={workbench.setSelectedId}
        selectedId={workbench.selectedId}
        showDetail={presentation.showDetail}
        showMeta={presentation.showMeta}
        showStateChip={presentation.showStateChip}
      />
    </section>
  );
}
