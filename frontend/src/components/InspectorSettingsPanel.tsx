import type { WorkbenchController } from "../hooks/useWorkbench";
import { t } from "../i18n";
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

      <PaneSection density="compact" emphasis="primary" title={t("labels.runtimeStatus")}>
        <RuntimeStatusChips backendOk={workbench.backendOk} runtime={runtime} />
        <InfoGrid
          items={[
            { label: t("labels.runtimeMode"), value: runtime.mode },
            { label: t("labels.shellName"), value: runtime.shellName },
            { label: t("labels.nativeDialogs"), value: runtime.supportsNativeDialogs ? t("labels.enabled") : t("labels.disabled") },
            { label: t("labels.shellBridge"), value: runtime.supportsShellBridge ? t("labels.configured") : t("labels.notConfigured") },
            { label: t("labels.bridgeSource"), value: bridge?.source ?? t("labels.unavailable") },
            { label: t("labels.pickFilesBridge"), value: fileBridgeReady ? t("labels.ready") : t("labels.fallbackBrowserInput") },
            { label: t("labels.pickDirectoryBridge"), value: directoryBridgeReady ? t("labels.ready") : t("labels.fallbackBrowserInput") },
            { label: t("labels.fileStrategy"), value: fileAccessPlan.files },
            { label: t("labels.directoryStrategy"), value: fileAccessPlan.directory },
          ]}
        />
      </PaneSection>
      {workbench.capabilities?.accelerator ? (
        <PaneSection density="compact" title={t("labels.accelerator")}>
          <InfoGrid
            items={[
              { label: t("labels.backend"), value: workbench.capabilities.accelerator.backend ?? "auto" },
              { label: t("labels.requested"), value: workbench.capabilities.accelerator.requested_backend ?? "auto" },
              { label: t("labels.gpuOps"), value: (workbench.capabilities.accelerator.gpu_ops ?? []).join(", ") || "none" },
              { label: t("labels.cpuFallback"), value: (workbench.capabilities.accelerator.cpu_fallback_ops ?? []).join(", ") || "none" },
              { label: t("labels.opencl"), value: workbench.capabilities.accelerator.opencl_available ? t("labels.available") : t("labels.notAvailable") },
            ]}
          />
          {workbench.capabilities.accelerator.fallback_reason ? <DetailNote body={workbench.capabilities.accelerator.fallback_reason} title={t("labels.fallback")} /> : null}
        </PaneSection>
      ) : null}

      <PaneSection density="compact" title={t("labels.pluginsEvaluators")}>
        <PluginList evaluators={workbench.evaluators} plugins={workbench.plugins} />
      </PaneSection>
    </>
  );
}
