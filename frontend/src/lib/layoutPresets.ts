import type { CompareMode, WorkbenchPreferences } from "../types";

export type LayoutPresetDefinition = {
  id: string;
  label: string;
  shortLabel: string;
  description: string;
  preferences: WorkbenchPreferences;
};

export type AuxiliarySectionPresentation = {
  density: "default" | "compact";
  emphasis: "default" | "primary" | "muted";
};

export type InspectorPanePresentation = {
  density: "default" | "compact";
  emphasis: "default" | "primary" | "muted";
  meta?: string;
  title?: string;
};

export type LibraryPaneSectionId = "workspace" | "context" | "tools";

export type LibraryPanePresentation = {
  density: "default" | "compact";
  emphasis: "default" | "primary" | "muted";
  meta?: string;
  title?: string;
};

export type FilmstripPresentation = {
  density: "default" | "compact";
  emphasis: "default" | "primary" | "muted";
  title: string;
  meta: string;
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
  meta: string;
  showStageHint: boolean;
  visibleCompareModes: CompareMode[];
  visibleZoomPresets: Array<"fit" | "fill">;
  showZoomStepper: boolean;
  showZoomReset: boolean;
};

export const DEFAULT_WORKBENCH_PREFERENCES: WorkbenchPreferences = {
  showLibraryPane: true,
  showInspectorPane: true,
  showPluginsPanel: true,
  showSelectionStatus: true,
  showSavedSessions: true,
  showActivityPanel: true,
  showFilmstrip: true,
  showViewerHud: true,
  showAdjustStatus: true,
  showAdjustQuickActions: true,
  showCropPanel: true,
  showAnalysisMetrics: true,
  showAnalysisCharts: true,
  showAnalysisContext: true,
  showAnalysisAIReview: true,
  showSessionCard: true,
  showWorkflowFeed: true,
};

/* All presentation functions now return the "balanced" (unified) variant */

export function getAuxiliarySectionPresentation(
  _section: "quick-actions" | "action-status" | "workflow-feed",
): AuxiliarySectionPresentation {
  return { density: "compact", emphasis: "muted" };
}

export function getInspectorPanePresentation(_tab: string): InspectorPanePresentation {
  return {
    density: "default",
    emphasis: "default",
    meta: "校准与裁切",
  };
}

export function getInspectorSectionOrder(_tab: string): string[] | undefined {
  return undefined;
}

export function getLibraryPanePresentation(
  _section: LibraryPaneSectionId,
): LibraryPanePresentation {
  return {
    density: "default",
    emphasis: "default",
    meta: "项目浏览、筛选与缩略图导航",
  };
}

export function getLibrarySectionOrder(): LibraryPaneSectionId[] {
  return ["workspace", "context", "tools"];
}

export function getFilmstripPresentation(): FilmstripPresentation {
  return {
    density: "default",
    emphasis: "default",
    title: "Filmstrip",
    meta: "缩略图浏览",
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
    meta: "图像预览与对比控制",
    showStageHint: true,
    visibleCompareModes: ["side-by-side", "split", "calibrated-only"],
    visibleZoomPresets: ["fit", "fill"],
    showZoomStepper: true,
    showZoomReset: true,
  };
}
