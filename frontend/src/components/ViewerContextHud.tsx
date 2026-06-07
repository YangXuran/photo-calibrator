import type { ActiveLayoutPreset } from "../types";

type ViewerContextHudProps = {
  primary: string[];
  secondary?: string[];
  preset?: ActiveLayoutPreset;
};

type ContextEntry = {
  label: string;
  value: string;
};

type SectionGroup = {
  title: string;
  entries: ContextEntry[];
};

function toEntries(items: string[]): ContextEntry[] {
  return items.map((item) => {
    const parts = item.split(":");
    if (parts.length >= 2) {
      const label = parts.shift() ?? "";
      return { label, value: parts.join(":").trim() };
    }
    return { label: "", value: item };
  });
}

function getSectionOrder(preset?: ActiveLayoutPreset): string[] {
  if (preset === "review") return ["Preview", "Image", "Crop", "Context"];
  if (preset === "edit") return ["Crop", "Preview", "Image", "Context"];
  return ["Image", "Preview", "Crop", "Context"]; // balanced / analyze / custom
}

function groupEntries(entries: ContextEntry[], preset?: ActiveLayoutPreset): SectionGroup[] {
  const image: ContextEntry[] = [];
  const preview: ContextEntry[] = [];
  const crop: ContextEntry[] = [];
  const other: ContextEntry[] = [];

  for (const entry of entries) {
    const label = entry.label.toLowerCase();
    if (label === "source" || label === "size" || label === "color") {
      image.push(entry);
    } else if (label === "preview" || label === "zoom" || label === "compare") {
      preview.push(entry);
    } else if (label === "crop") {
      crop.push(entry);
    } else {
      other.push(entry);
    }
  }

  const sections: SectionGroup[] = [
    { title: "Image", entries: image },
    { title: "Preview", entries: preview },
    { title: "Crop", entries: crop },
    { title: "Context", entries: other },
  ].filter((group) => group.entries.length);

  const order = getSectionOrder(preset);
  return sections.sort((a, b) => {
    const ai = order.indexOf(a.title);
    const bi = order.indexOf(b.title);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });
}

export function ViewerContextHud({ primary, secondary = [], preset }: ViewerContextHudProps) {
  const primaryEntries = toEntries(primary);
  const secondaryEntries = toEntries(secondary);
  const groups = groupEntries([...primaryEntries, ...secondaryEntries], preset);

  return (
    <div className="pc-context-hud" data-testid="focus-context-hud">
      {groups.map((group) => (
        <div className="pc-context-hud-section" key={group.title}>
          <span className="pc-context-hud-section-title">{group.title}</span>
          <div className="pc-context-hud-grid">
            {group.entries.map((entry) => (
              <div className="pc-context-hud-row" key={`${group.title}:${entry.label}:${entry.value}`}>
                {entry.label ? <span className="pc-context-hud-label">{entry.label}</span> : null}
                <strong className="pc-context-hud-value">{entry.value}</strong>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
