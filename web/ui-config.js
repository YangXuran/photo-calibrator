export const TOOL_DEFINITIONS = [
  { id: "inspect", label: "检查", panel: "analysis" },
  { id: "crop", label: "裁切", panel: "crop" },
  { id: "tone", label: "色调", panel: "adjust" },
  { id: "export", label: "导出", panel: "adjust" },
];

export const INSPECTOR_PANELS = [
  { id: "adjust", label: "调整" },
  { id: "analysis", label: "分析" },
  { id: "crop", label: "翻拍" },
];

export function panelForTool(toolId) {
  return TOOL_DEFINITIONS.find((tool) => tool.id === toolId)?.panel || "adjust";
}
