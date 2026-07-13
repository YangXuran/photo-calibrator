import { useState } from "react";
import type { WorkbenchController } from "../hooks/useWorkbench";
import { t } from "../i18n";
import { getAppBridge } from "../runtime/appBridge";
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
  const appBridge = getAppBridge();
  const [restartingBackend, setRestartingBackend] = useState(false);

  const reconnectBackend = async () => {
    if (!appBridge || restartingBackend) return;
    setRestartingBackend(true);
    try {
      await appBridge.restartBackend();
    } catch {
      // The runtime status event carries the supervisor error for display.
    } finally {
      setRestartingBackend(false);
    }
  };

  return (
    <>
      <AIProviderCard settings={aiSettings} onChange={onAISettingsChange} />

      <PaneSection
        actions={appBridge ? (
          <button
            className="pc-button pc-button-secondary pc-button-small"
            data-testid="backend-restart-button"
            disabled={restartingBackend || runtime.backend?.status === "starting"}
            onClick={() => void reconnectBackend()}
            type="button"
          >
            {restartingBackend ? t("labels.backendRestarting") : t("labels.backendReconnect")}
          </button>
        ) : null}
        density="compact"
        emphasis="primary"
        title={t("labels.runtimeStatus")}
      >
        <RuntimeStatusChips backendOk={workbench.backendOk} runtime={runtime} />
        <InfoGrid
          items={[
            { label: t("labels.runtimeMode"), value: runtime.mode },
            { label: t("labels.shellName"), value: runtime.shellName },
            { label: t("labels.appVersion"), value: runtime.appVersion ?? t("labels.unavailable") },
            { label: t("labels.nativeDialogs"), value: runtime.supportsNativeDialogs ? t("labels.enabled") : t("labels.disabled") },
            { label: t("labels.shellBridge"), value: runtime.supportsShellBridge ? t("labels.configured") : t("labels.notConfigured") },
            { label: t("labels.bridgeSource"), value: bridge?.source ?? t("labels.unavailable") },
            { label: t("labels.pickFilesBridge"), value: fileBridgeReady ? t("labels.ready") : t("labels.fallbackBrowserInput") },
            { label: t("labels.pickDirectoryBridge"), value: directoryBridgeReady ? t("labels.ready") : t("labels.fallbackBrowserInput") },
            { label: t("labels.fileStrategy"), value: fileAccessPlan.files },
            { label: t("labels.directoryStrategy"), value: fileAccessPlan.directory },
            { label: t("labels.backendState"), value: runtime.backend?.status ?? t("labels.unavailable") },
            { label: t("labels.backendOwnership"), value: runtime.backend?.ownership ?? t("labels.unavailable") },
            { label: t("labels.backendUrl"), value: runtime.backend?.url || runtime.apiBaseUrl },
          ]}
        />
        {runtime.backend?.lastError ? <DetailNote body={runtime.backend.lastError} title={t("labels.backendError")} /> : null}
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
