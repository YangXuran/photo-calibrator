import type { InspectorTab } from "../types";
import { getInspectorTabMeta } from "./inspectorTabMeta";

type InspectorTabsProps = {
  active: InspectorTab;
  onChange: (value: InspectorTab) => void;
};

const TOOL_TABS: InspectorTab[] = ["adjust", "look", "curves", "compose"];
const SECONDARY_TABS: InspectorTab[] = ["ai", "export", "session", "settings"];

function TabButton({ tabId, active, onChange }: { tabId: InspectorTab; active: InspectorTab; onChange: (value: InspectorTab) => void }) {
  const meta = getInspectorTabMeta(tabId);
  const isActive = active === tabId;

  return (
    <button
      className={`pc-tool-tab ${isActive ? "is-active" : ""}`}
      data-testid={`inspector-tab-${tabId}`}
      onClick={() => onChange(tabId)}
      title={meta.title}
      type="button"
    >
      <span className="pc-tool-tab-icon" dangerouslySetInnerHTML={{ __html: meta.icon }} />
    </button>
  );
}

export function InspectorTabs({ active, onChange }: InspectorTabsProps) {
  return (
    <div className="pc-inspector-tool-tabs" data-testid="inspector-tabs">
      <div className="pc-tool-tabs-group" data-testid="inspector-tool-tabs">
        {TOOL_TABS.map((tabId) => (
          <TabButton key={tabId} active={active} onChange={onChange} tabId={tabId} />
        ))}
      </div>
      <div className="pc-tool-tabs-divider" />
      <div className="pc-tool-tabs-group" data-testid="inspector-secondary-tabs">
        {SECONDARY_TABS.map((tabId) => (
          <TabButton key={tabId} active={active} onChange={onChange} tabId={tabId} />
        ))}
      </div>
    </div>
  );
}
