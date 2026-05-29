import { t } from "../i18n.js";

export const TOOL_DEFINITIONS = [
  { id: "inspect", labelKey: "tool.inspect", panel: "analysis" },
  { id: "crop", labelKey: "tool.crop", panel: "crop" },
  { id: "tone", labelKey: "tool.tone", panel: "adjust" },
  { id: "export", labelKey: "tool.export", panel: "adjust" },
];

export const INSPECTOR_PANELS = [
  { id: "adjust", labelKey: "panel.adjust" },
  { id: "analysis", labelKey: "panel.analysis" },
  { id: "crop", labelKey: "panel.filmScan" },
];

export function panelForTool(toolId) {
  return TOOL_DEFINITIONS.find((tool) => tool.id === toolId)?.panel || "adjust";
}

// Resolve translated label (call after i18n is ready)
export function toolLabel(tool) { return t(tool.labelKey); }
export function panelLabel(panel) { return t(panel.labelKey); }
