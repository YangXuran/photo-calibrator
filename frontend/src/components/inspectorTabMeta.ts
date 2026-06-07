import type { InspectorTab } from "../types";

const INSPECTOR_TAB_META: Record<InspectorTab, { title: string; meta: string }> = {
  adjust: {
    title: "Adjust",
    meta: "校准与裁切",
  },
  analysis: {
    title: "Analysis",
    meta: "指标、图表与 AI 评估",
  },
  export: {
    title: "Export",
    meta: "导出设置与结果",
  },
  session: {
    title: "Session",
    meta: "session、document 与工作流回显",
  },
};

export function getInspectorTabMeta(tab: InspectorTab) {
  return INSPECTOR_TAB_META[tab];
}
