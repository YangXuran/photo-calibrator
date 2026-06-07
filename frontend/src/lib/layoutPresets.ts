import type { ActiveLayoutPreset, CompareMode, InspectorTab, LayoutPresetId, ViewerWorkspaceState, WorkbenchPreferences } from "../types";

export type LayoutPresetDefinition = {
  id: LayoutPresetId;
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

export const LAYOUT_PRESET_ORDER: LayoutPresetId[] = ["balanced", "review", "edit", "analyze"];

export const WORKBENCH_LAYOUT_PRESETS: Record<LayoutPresetId, LayoutPresetDefinition> = {
  balanced: {
    id: "balanced",
    label: "平衡工作台",
    shortLabel: "平衡",
    description: "保留三栏、底部缩略图和结果面板，适合通用浏览与调参。",
    preferences: DEFAULT_WORKBENCH_PREFERENCES,
  },
  review: {
    id: "review",
    label: "审片布局",
    shortLabel: "审片",
    description: "优先看图和资源列表，收起右侧 Inspector，减少分析噪音。",
    preferences: {
      ...DEFAULT_WORKBENCH_PREFERENCES,
      showInspectorPane: false,
      showPluginsPanel: false,
      showActivityPanel: false,
      showViewerHud: false,
    },
  },
  edit: {
    id: "edit",
    label: "编辑布局",
    shortLabel: "编辑",
    description: "收起左侧资源栏，保留右侧调参与裁切，适合连续编辑。",
    preferences: {
      ...DEFAULT_WORKBENCH_PREFERENCES,
      showLibraryPane: false,
      showPluginsPanel: false,
      showSelectionStatus: false,
      showSavedSessions: false,
      showActivityPanel: false,
      showAnalysisMetrics: false,
      showAnalysisCharts: false,
      showAnalysisContext: false,
      showAnalysisAIReview: false,
      showWorkflowFeed: false,
    },
  },
  analyze: {
    id: "analyze",
    label: "分析布局",
    shortLabel: "分析",
    description: "集中 viewer 和 Inspector，把分析图表与结果区作为主要工作面。",
    preferences: {
      ...DEFAULT_WORKBENCH_PREFERENCES,
      showLibraryPane: false,
      showPluginsPanel: false,
      showSelectionStatus: false,
      showSavedSessions: false,
      showActivityPanel: false,
      showAdjustQuickActions: false,
      showCropPanel: false,
    },
  },
};

export const LAYOUT_PRESET_DEFAULT_INSPECTOR_TAB: Record<LayoutPresetId, InspectorTab> = {
  balanced: "adjust",
  review: "analysis",
  edit: "adjust",
  analyze: "analysis",
};

export const LAYOUT_PRESET_DEFAULT_VIEWER_STATE: Record<LayoutPresetId, ViewerWorkspaceState> = {
  balanced: {
    compareMode: "side-by-side",
    splitPosition: 50,
    zoomMode: "fit",
    zoomScale: 1,
    pan: { x: 0, y: 0 },
  },
  review: {
    compareMode: "side-by-side",
    splitPosition: 50,
    zoomMode: "fit",
    zoomScale: 1,
    pan: { x: 0, y: 0 },
  },
  edit: {
    compareMode: "split",
    splitPosition: 55,
    zoomMode: "fit",
    zoomScale: 1,
    pan: { x: 0, y: 0 },
  },
  analyze: {
    compareMode: "calibrated-only",
    splitPosition: 50,
    zoomMode: "fill",
    zoomScale: 1,
    pan: { x: 0, y: 0 },
  },
};

export function getLayoutPresetDefinition(preset: ActiveLayoutPreset) {
  if (preset === "custom") {
    return {
      label: "自定义布局",
      shortLabel: "自定义",
      description: "当前布局来自手动开关，不完全匹配预设。",
    };
  }
  return WORKBENCH_LAYOUT_PRESETS[preset];
}

export function getLayoutPresetPreferences(preset: LayoutPresetId): WorkbenchPreferences {
  return WORKBENCH_LAYOUT_PRESETS[preset].preferences;
}

export function getMatchingLayoutPreset(preferences: WorkbenchPreferences): ActiveLayoutPreset {
  const matched = LAYOUT_PRESET_ORDER.find((presetId) => {
    const candidate = WORKBENCH_LAYOUT_PRESETS[presetId].preferences;
    return (Object.keys(candidate) as Array<keyof WorkbenchPreferences>).every((key) => candidate[key] === preferences[key]);
  });
  return matched ?? "custom";
}

export function getDefaultInspectorTabForPreset(preset: ActiveLayoutPreset): InspectorTab {
  if (preset === "custom") return "adjust";
  return LAYOUT_PRESET_DEFAULT_INSPECTOR_TAB[preset];
}

export function getDefaultViewerStateForPreset(preset: ActiveLayoutPreset): ViewerWorkspaceState {
  if (preset === "custom") {
    return {
      compareMode: "side-by-side",
      splitPosition: 50,
      zoomMode: "fit",
      zoomScale: 1,
      pan: { x: 0, y: 0 },
    };
  }
  return LAYOUT_PRESET_DEFAULT_VIEWER_STATE[preset];
}

export function getAuxiliarySectionPresentation(
  preset: ActiveLayoutPreset,
  section: "quick-actions" | "action-status" | "workflow-feed",
): AuxiliarySectionPresentation {
  if (section === "quick-actions") {
    if (preset === "edit") {
      return { density: "default", emphasis: "primary" };
    }
    return { density: "compact", emphasis: "muted" };
  }

  if (section === "action-status") {
    if (preset === "analyze" || preset === "edit") {
      return { density: "compact", emphasis: "default" };
    }
    return { density: "compact", emphasis: "muted" };
  }

  if (preset === "balanced") {
    return { density: "compact", emphasis: "default" };
  }
  return { density: "compact", emphasis: "muted" };
}

export function getInspectorPanePresentation(preset: ActiveLayoutPreset, tab: InspectorTab): InspectorPanePresentation {
  if (tab === "adjust") {
    if (preset === "edit") {
      return {
        density: "default",
        emphasis: "primary",
        meta: "主参数与常用操作优先",
        title: "Adjust Workspace",
      };
    }
    return {
      density: "default",
      emphasis: "default",
      meta: "校准与裁切",
    };
  }

  if (tab === "analysis") {
    if (preset === "analyze") {
      return {
        density: "compact",
        emphasis: "primary",
        meta: "图表、上下文与 AI 评估优先",
        title: "Analysis Workspace",
      };
    }
    return {
      density: "default",
      emphasis: "default",
      meta: "指标、图表与 AI 评估",
    };
  }

  if (tab === "export") {
    return {
      density: preset === "edit" ? "compact" : "default",
      emphasis: preset === "edit" ? "muted" : "default",
      meta: "导出设置与结果",
    };
  }

  if (preset === "analyze") {
    return {
      density: "compact",
      emphasis: "default",
      meta: "工作流回显优先，文档操作次级",
      title: "Session Workspace",
    };
  }

  return {
    density: "default",
    emphasis: "default",
    meta: "session、document 与工作流回显",
  };
}

export function getInspectorSectionOrder(preset: ActiveLayoutPreset, tab: InspectorTab): string[] | undefined {
  if (tab === "adjust" && preset === "edit") {
    return ["main-calibration", "quick-actions", "crop", "action-status"];
  }

  if (tab === "analysis" && preset === "analyze") {
    return ["metrics", "charts", "ai-review", "context"];
  }

  if (tab === "session" && preset === "analyze") {
    return ["workflow-feed", "session-card"];
  }

  return undefined;
}

export function getLibraryPanePresentation(
  preset: ActiveLayoutPreset,
  section: LibraryPaneSectionId,
): LibraryPanePresentation {
  if (section === "workspace") {
    if (preset === "review") {
      return {
        density: "default",
        emphasis: "primary",
        meta: "浏览、筛选与缩略图导航优先",
        title: "Review Workspace",
      };
    }
    if (preset === "edit") {
      return {
        density: "compact",
        emphasis: "default",
        meta: "保留最小浏览与选择入口",
      };
    }
    if (preset === "analyze") {
      return {
        density: "compact",
        emphasis: "default",
        meta: "保留当前项目与筛选入口",
      };
    }
    return {
      density: "default",
      emphasis: "default",
      meta: "项目浏览、筛选与缩略图导航",
    };
  }

  if (section === "context") {
    if (preset === "review") {
      return {
        density: "compact",
        emphasis: "muted",
        meta: "来源、恢复与运行时上下文",
        title: "Context",
      };
    }
    return {
      density: "default",
      emphasis: "default",
      meta: "来源、恢复与运行时上下文",
      title: "Context",
    };
  }

  if (section === "tools") {
    if (preset === "review") {
      return {
        density: "compact",
        emphasis: "default",
        meta: "导出、会话与工具入口",
        title: "Tools",
      };
    }
    return {
      density: "compact",
      emphasis: "default",
      meta: "导出、会话与工具入口",
      title: "Tools",
    };
  }

  return {
    density: "default",
    emphasis: "default",
    meta: "项目浏览",
  };
}

export function getLibrarySectionOrder(preset: ActiveLayoutPreset): LibraryPaneSectionId[] {
  if (preset === "review") {
    return ["workspace", "tools", "context"];
  }
  return ["workspace", "context", "tools"];
}

export function getFilmstripPresentation(preset: ActiveLayoutPreset): FilmstripPresentation {
  if (preset === "review") {
    return {
      density: "default",
      emphasis: "primary",
      title: "Review Strip",
      meta: "保留更完整的缩略图状态，适合快速审片。",
      showStateChip: true,
      showMeta: true,
      showDetail: true,
    };
  }

  if (preset === "edit") {
    return {
      density: "compact",
      emphasis: "default",
      title: "Edit Strip",
      meta: "缩略图导航优先，减少元信息噪音。",
      showStateChip: true,
      showMeta: true,
      showDetail: false,
    };
  }

  if (preset === "analyze") {
    return {
      density: "compact",
      emphasis: "muted",
      title: "Analysis Strip",
      meta: "保留来源与结果状态，弱化浏览噪音。",
      showStateChip: true,
      showMeta: true,
      showDetail: false,
    };
  }

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

export function getViewerPanePresentation(preset: ActiveLayoutPreset): ViewerPanePresentation {
  if (preset === "review") {
    return {
      controlsDensity: "default",
      controlsEmphasis: "primary",
      statusDensity: "default",
      statusEmphasis: "default",
      compareTone: "primary",
      zoomTone: "muted",
      title: "Review Viewer",
      meta: "对比与浏览优先，保留清晰的查看状态。",
      showStageHint: true,
      visibleCompareModes: ["side-by-side", "split"],
      visibleZoomPresets: ["fit", "fill"],
      showZoomStepper: false,
      showZoomReset: false,
    };
  }

  if (preset === "edit") {
    return {
      controlsDensity: "default",
      controlsEmphasis: "primary",
      statusDensity: "compact",
      statusEmphasis: "default",
      compareTone: "muted",
      zoomTone: "primary",
      title: "Edit Viewer",
      meta: "参数调整优先，保留必要查看状态。",
      showStageHint: false,
      visibleCompareModes: ["split", "calibrated-only"],
      visibleZoomPresets: ["fit", "fill"],
      showZoomStepper: true,
      showZoomReset: true,
    };
  }

  if (preset === "analyze") {
    return {
      controlsDensity: "compact",
      controlsEmphasis: "muted",
      statusDensity: "compact",
      statusEmphasis: "muted",
      compareTone: "muted",
      zoomTone: "default",
      title: "Analysis Viewer",
      meta: "弱化查看控件，把注意力留给图像与分析面板。",
      showStageHint: false,
      visibleCompareModes: ["calibrated-only", "split"],
      visibleZoomPresets: ["fit", "fill"],
      showZoomStepper: false,
      showZoomReset: false,
    };
  }

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
