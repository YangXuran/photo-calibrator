import type { WorkbenchController } from "../hooks/useWorkbench";
import { resolveFileAccessPlan } from "../runtime/fileAccess";
import { useRuntimeConfig } from "../runtime/RuntimeProvider";
import { getShellBridge } from "../runtime/shellBridge";
import { ActivityPanel } from "./ActivityPanel";
import { DetailNote } from "./DetailNote";
import { InfoGrid } from "./InfoGrid";
import { PaneSection } from "./PaneSection";
import { PluginList } from "./PluginList";
import { RuntimeStatusChips } from "./RuntimeStatusChips";

type InspectorSettingsPanelProps = {
  workbench: WorkbenchController;
};

export function InspectorSettingsPanel({ workbench }: InspectorSettingsPanelProps) {
  const runtime = useRuntimeConfig();
  const bridge = getShellBridge();
  const fileBridgeReady = Boolean(bridge?.pickFiles);
  const directoryBridgeReady = Boolean(bridge?.pickDirectory);
  const fileAccessPlan = resolveFileAccessPlan(runtime, bridge);

  return (
    <>
      <PaneSection density="compact" emphasis="primary" meta="后端连接与运行模式" title="Runtime Status">
        <RuntimeStatusChips backendOk={workbench.backendOk} runtime={runtime} />
        <InfoGrid
          items={[
            { label: "Runtime mode", value: runtime.mode },
            { label: "Shell name", value: runtime.shellName },
            { label: "Native dialogs", value: runtime.supportsNativeDialogs ? "Enabled" : "Disabled" },
            { label: "Shell bridge", value: runtime.supportsShellBridge ? "Configured" : "Not configured" },
            { label: "Bridge source", value: bridge?.source ?? "unavailable" },
            { label: "Pick files bridge", value: fileBridgeReady ? "Ready" : "Fallback to browser input" },
            { label: "Pick directory bridge", value: directoryBridgeReady ? "Ready" : "Fallback to browser input" },
            { label: "File strategy", value: fileAccessPlan.files },
            { label: "Dir strategy", value: fileAccessPlan.directory },
          ]}
        />
      </PaneSection>

      {workbench.capabilities?.accelerator ? (
        <PaneSection density="compact" meta="加速器后端与可用操作" title="Accelerator">
          <InfoGrid
            items={[
              { label: "Backend", value: workbench.capabilities.accelerator.backend ?? "auto" },
              { label: "Requested", value: workbench.capabilities.accelerator.requested_backend ?? "auto" },
              { label: "GPU ops", value: (workbench.capabilities.accelerator.gpu_ops ?? []).join(", ") || "none" },
              { label: "CPU fallback", value: (workbench.capabilities.accelerator.cpu_fallback_ops ?? []).join(", ") || "none" },
              { label: "OpenCL", value: workbench.capabilities.accelerator.opencl_available ? "Available" : "Not available" },
            ]}
          />
          {workbench.capabilities.accelerator.fallback_reason ? <DetailNote>{workbench.capabilities.accelerator.fallback_reason}</DetailNote> : null}
        </PaneSection>
      ) : null}

      <PaneSection density="compact" meta="后端注册表" title="Plugins & Evaluators">
        <PluginList evaluators={workbench.evaluators} plugins={workbench.plugins} />
      </PaneSection>

      <PaneSection density="compact" meta="最近动作日志" title="Activity">
        <ActivityPanel items={workbench.activityLog} />
      </PaneSection>
    </>
  );
}
