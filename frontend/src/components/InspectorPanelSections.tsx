import type { ReactNode } from "react";

type InspectorPanelSection = {
  key: string;
  visible?: boolean;
  content: ReactNode;
};

type InspectorPanelSectionsProps = {
  order?: string[];
  sections: InspectorPanelSection[];
};

export function InspectorPanelSections({ order, sections }: InspectorPanelSectionsProps) {
  const visibleSections = sections.filter((section) => section.visible !== false);
  const orderedSections = order?.length
    ? [...visibleSections].sort((left, right) => {
        const leftIndex = order.indexOf(left.key);
        const rightIndex = order.indexOf(right.key);
        const resolvedLeft = leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex;
        const resolvedRight = rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex;
        return resolvedLeft - resolvedRight;
      })
    : visibleSections;

  if (!orderedSections.length) return null;

  return (
    <div className="pc-stack">
      {orderedSections.map((section) => (
        <div key={section.key}>{section.content}</div>
      ))}
    </div>
  );
}
