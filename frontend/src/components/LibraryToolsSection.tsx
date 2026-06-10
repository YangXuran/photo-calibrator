import type { WorkbenchController } from "../hooks/useWorkbench";
import { ActivityPanel } from "./ActivityPanel";
import { PaneGroup } from "./PaneGroup";
import { PaneSection } from "./PaneSection";
import { PluginList } from "./PluginList";

type LibraryToolsSectionProps = {
  workbench: WorkbenchController;
  density?: "default" | "compact";
  emphasis?: "default" | "primary" | "muted";
  meta?: string;
  title?: string;
};

export function LibraryToolsSection({
  workbench,
  density = "compact",
  emphasis = "default",
  meta = "后端注册与最近动作",
  title = "Tools",
}: LibraryToolsSectionProps) {
  return (
    <PaneGroup density={density} emphasis={emphasis} testId="library-tools-group">
      {workbench.preferences.showPluginsPanel ? (
        <PaneSection density="compact" title="插件与评估器" meta="后端注册表">
          <PluginList evaluators={workbench.evaluators} plugins={workbench.plugins} />
        </PaneSection>
      ) : null}
      {workbench.preferences.showActivityPanel ? <ActivityPanel items={workbench.activityLog} /> : null}
    </PaneGroup>
  );
}
