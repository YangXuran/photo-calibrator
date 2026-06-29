import type { CompareMode, WorkbenchPreferences } from "../types";

export type LayoutPresetDefinition = {
  id: string;
  label: string;
  shortLabel: string;
  description: string;
  preferences: WorkbenchPreferences;
};

export type InspectorPanePresentation = {
  density: "default" | "compact";
  emphasis: "default" | "primary" | "muted";
  meta?: string;
  title?: string;
};

export type FilmstripPresentation = {
  density: "default" | "compact";
  emphasis: "default" | "primary" | "muted";
  title: string;
  meta?: string;
  showStateChip: boolean;
  showMeta: boolean;
  showDetail: boolean;
};

export type ViewerPanePresentation = {
  controlsDensity: "default" | "compact";
  controlsEmphasis: "default" | "primary" | "muted";
  statusDensity: "default" | "compact";
  statusEmphasis: "default" | "muted";
  compareTone: "default" | "primary" | "muted";
  zoomTone: "default" | "primary" | "muted";
  title: string;
  meta?: string;
  showStageHint: boolean;
  visibleCompareModes: CompareMode[];
  visibleZoomPresets: Array<"fit" | "fill">;
  showZoomStepper: boolean;
  showZoomReset: boolean;
};

export const DEFAULT_WORKBENCH_PREFERENCES: WorkbenchPreferences = {
  showAnalysisPane: true,
  showInspectorPane: true,
  showFilmstrip: true,
  showViewerHud: true,
};

/* All presentation functions now return the "balanced" (unified) variant */

export function getInspectorPanePresentation(_tab: string): InspectorPanePresentation {
  return {
    density: "default",
    emphasis: "default",
  };
}

export function getInspectorSectionOrder(_tab: string): string[] | undefined {
  return undefined;
}

export function getFilmstripPresentation(): FilmstripPresentation {
  return {
    density: "default",
    emphasis: "default",
    title: "Filmstrip",
    showStateChip: true,
    showMeta: true,
    showDetail: true,
  };
}

export function getViewerPanePresentation(): ViewerPanePresentation {
  return {
    controlsDensity: "default",
    controlsEmphasis: "default",
    statusDensity: "default",
    statusEmphasis: "default",
    compareTone: "default",
    zoomTone: "default",
    title: "Viewer",
    showStageHint: false,
    visibleCompareModes: ["side-by-side", "split", "calibrated-only"],
    visibleZoomPresets: ["fit", "fill"],
    showZoomStepper: true,
    showZoomReset: true,
  };
}
