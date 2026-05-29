export const TOOL_DEFINITIONS = [
  { id: "inspect", label: "Inspect", panel: "analysis" },
  { id: "crop", label: "Crop", panel: "crop" },
  { id: "tone", label: "Tone", panel: "adjust" },
  { id: "export", label: "Export", panel: "adjust" },
];

export const INSPECTOR_PANELS = [
  { id: "adjust", label: "Adjust" },
  { id: "analysis", label: "Analysis" },
  { id: "crop", label: "Film Scan" },
];

export function panelForTool(toolId) {
  return TOOL_DEFINITIONS.find((tool) => tool.id === toolId)?.panel || "adjust";
}
