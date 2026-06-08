import type { InspectorTab } from "../types";

type InspectorTabsProps = {
  active: InspectorTab;
  onChange: (value: InspectorTab) => void;
};

const TABS: Array<{ id: InspectorTabsProps["active"]; label: string }> = [
  { id: "adjust", label: "校准" },
  { id: "analysis", label: "分析" },
  { id: "export", label: "导出" },
  { id: "session", label: "文档" },
  { id: "settings", label: "设置" },
];

export function InspectorTabs({ active, onChange }: InspectorTabsProps) {
  return (
    <div className="pc-inspector-tabs" data-testid="inspector-tabs">
      {TABS.map((tab) => (
        <button className={active === tab.id ? "is-active" : ""} data-testid={`inspector-tab-${tab.id}`} key={tab.id} onClick={() => onChange(tab.id)} type="button">
          {tab.label}
        </button>
      ))}
    </div>
  );
}
