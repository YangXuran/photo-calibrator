import type { WorkbenchController } from "../hooks/useWorkbench";
import { getFilmstripPresentation } from "../lib/layoutPresets";
import { Filmstrip } from "./Filmstrip";

type ViewerFilmstripPaneProps = {
  workbench: WorkbenchController;
};

export function ViewerFilmstripPane({ workbench }: ViewerFilmstripPaneProps) {
  const presentation = getFilmstripPresentation(workbench.activeLayoutPreset);
  return (
    <section
      className={`pc-pane pc-filmstrip-pane pc-filmstrip-pane-${presentation.density} pc-filmstrip-pane-${presentation.emphasis}`}
      data-testid="filmstrip-pane"
    >
      <div className="pc-pane-header" data-testid="filmstrip-pane-header">
        <div className="pc-stage-meta">
          <span className="pc-overline">Filmstrip</span>
          <strong>{workbench.files.length ? presentation.title : "等待导入"}</strong>
          {workbench.files.length ? <span className="pc-stage-hint">{presentation.meta}</span> : null}
        </div>
      </div>
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
