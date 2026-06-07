import type { WorkbenchController } from "../hooks/useWorkbench";
import { resolveFileAccessPlan } from "../runtime/fileAccess";
import { useRuntimeConfig } from "../runtime/RuntimeProvider";
import { getShellBridge } from "../runtime/shellBridge";
import { ActivityPanel } from "./ActivityPanel";
import { DetailNote } from "./DetailNote";
import { DialogShell } from "./DialogShell";
import { InfoGrid } from "./InfoGrid";
import { PaneSection } from "./PaneSection";
import { PluginList } from "./PluginList";
import { RuntimeStatusChips } from "./RuntimeStatusChips";

type SettingsDialogProps = {
  open: boolean;
  onClose: () => void;
  workbench: Pick<WorkbenchController, "activityLog" | "evaluators" | "plugins">;
  backendOk: boolean | null;
};

export function SettingsDialog({ open, onClose, workbench, backendOk }: SettingsDialogProps) {
  const runtime = useRuntimeConfig();
  const bridge = getShellBridge();
  const fileBridgeReady = Boolean(bridge?.pickFiles);
  const directoryBridgeReady = Boolean(bridge?.pickDirectory);
  const fileAccessPlan = resolveFileAccessPlan(runtime, bridge);
  const bridgeSource = bridge?.source ?? "unavailable";

  return (
    <DialogShell
      ariaLabel="Settings"
      className="pc-settings-dialog"
      description="运行时状态、插件与工具配置"
      onClose={onClose}
      open={open}
      testId="runtime-settings-dialog"
      title="Runtime Settings"
    >
      <PaneSection density="compact" emphasis="primary" meta="后端连接与运行模式" title="Runtime Status">
        <RuntimeStatusChips backendOk={backendOk} runtime={runtime} />
        <InfoGrid
          items={[
            { label: "Runtime mode", value: runtime.mode },
            { label: "Shell name", value: runtime.shellName },
            { label: "Native dialogs", value: runtime.supportsNativeDialogs ? "Enabled" : "Disabled" },
            { label: "Shell bridge", value: runtime.supportsShellBridge ? "Configured" : "Not configured" },
            { label: "Bridge source", value: bridgeSource },
            { label: "Pick files bridge", value: fileBridgeReady ? "Ready" : "Fallback to browser input" },
            { label: "Pick directory bridge", value: directoryBridgeReady ? "Ready" : "Fallback to browser input" },
            { label: "File open strategy", value: fileAccessPlan.files },
            { label: "Directory open strategy", value: fileAccessPlan.directory },
          ]}
        />
        <DetailNote body={runtime.apiBaseUrl ? `当前通过 ${runtime.apiBaseUrl} 访问 backend。` : "当前使用 same-origin /api 路由访问 backend。"} title="API routing" />
      </PaneSection>

      <PaneSection density="compact" meta="后端注册的插件与评估器" title="Plugins & Evaluators">
        <PluginList evaluators={workbench.evaluators} plugins={workbench.plugins} />
      </PaneSection>

      <PaneSection density="compact" meta="最近操作记录" title="Activity Log">
        <ActivityPanel items={workbench.activityLog} />
      </PaneSection>

      <PaneSection density="compact" emphasis="muted" meta="桌面壳接入配置" title="Desktop Contract">
        <DetailNote body="Electron preload 后续只需要注入 `window.__PHOTO_CALIBRATOR_RUNTIME__` 和 `window.__PHOTO_CALIBRATOR_SHELL__`，前端工作流不需要再改入口。" title="Desktop contract" />
        <DetailNote body={runtime.enableMockShellBridge ? "当前已启用前端 mock shell bridge，desktop mock 模式会优先走 bridge API。" : "当前未启用 mock shell bridge。没有 preload 时会回退到浏览器 input。"} title="Mock bridge" />
        <pre className="pc-code-block">{`window.__PHOTO_CALIBRATOR_RUNTIME__ = {
  mode: "desktop-shell",
  shellName: "Photo Calibrator Desktop",
  apiBaseUrl: "http://127.0.0.1:8766",
  supportsNativeDialogs: true,
  supportsShellBridge: true,
  enableMockShellBridge: false,
}`}</pre>
        <pre className="pc-code-block">{`window.__PHOTO_CALIBRATOR_SHELL__ = {
  pickFiles: async () => File[],
  pickDirectory: async () => File[],
}`}</pre>
      </PaneSection>
    </DialogShell>
  );
}
