import type { WorkbenchController } from "../hooks/useWorkbench";
import { resolveFileAccessPlan } from "../runtime/fileAccess";
import { useRuntimeConfig } from "../runtime/RuntimeProvider";
import { getShellBridge } from "../runtime/shellBridge";
import { AIProviderCard, type AIProviderSettings } from "./AIProviderCard";
import { DetailNote } from "./DetailNote";
import { InfoGrid } from "./InfoGrid";
import { PaneSection } from "./PaneSection";
import { PluginList } from "./PluginList";
import { RuntimeStatusChips } from "./RuntimeStatusChips";

type InspectorSettingsPanelProps = {
  workbench: WorkbenchController;
  aiSettings: AIProviderSettings;
  onAISettingsChange: (s: AIProviderSettings) => void;
};

export function InspectorSettingsPanel({ workbench, aiSettings, onAISettingsChange }: InspectorSettingsPanelProps) {
  const runtime = useRuntimeConfig();
  const bridge = getShellBridge();
  const fileBridgeReady = Boolean(bridge?.pickFiles);
  const directoryBridgeReady = Boolean(bridge?.pickDirectory);
  const fileAccessPlan = resolveFileAccessPlan(runtime, bridge);

  return (
    <>
      <AIProviderCard settings={aiSettings} onChange={onAISettingsChange} />

      <PaneSection density="compact" emphasis="primary" meta="" title="Runtime Status">
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
        <PaneSection density="compact" meta="" title="Accelerator">
          <InfoGrid
            items={[
              { label: "Backend", value: workbench.capabilities.accelerator.backend ?? "auto" },
              { label: "Requested", value: workbench.capabilities.accelerator.requested_backend ?? "auto" },
              { label: "GPU ops", value: (workbench.capabilities.accelerator.gpu_ops ?? []).join(", ") || "none" },
              { label: "CPU fallback", value: (workbench.capabilities.accelerator.cpu_fallback_ops ?? []).join(", ") || "none" },
              { label: "OpenCL", value: workbench.capabilities.accelerator.opencl_available ? "Available" : "Not available" },
            ]}
          />
          {workbench.capabilities.accelerator.fallback_reason ? <DetailNote body={workbench.capabilities.accelerator.fallback_reason} title="Fallback" /> : null}
        </PaneSection>
      ) : null}

      <PaneSection density="compact" meta="" title="Plugins & Evaluators">
        <PluginList evaluators={workbench.evaluators} plugins={workbench.plugins} />
      </PaneSection>
    </>
  );
}
