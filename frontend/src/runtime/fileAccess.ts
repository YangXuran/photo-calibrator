import type { PickedFiles } from "../hooks/useWorkbench";
import type { RuntimeConfig } from "./config";
import type { PhotoCalibratorShellBridge } from "./shellBridge";

export type FileAccessStrategy = "shell-bridge" | "browser-input";

export type FileAccessPlan = {
  directory: FileAccessStrategy;
  files: FileAccessStrategy;
};

export function resolveFileAccessPlan(runtime: RuntimeConfig, bridge: PhotoCalibratorShellBridge | null): FileAccessPlan {
  const files = runtime.supportsShellBridge && bridge?.pickFiles ? "shell-bridge" : "browser-input";
  const directory = runtime.supportsShellBridge && bridge?.pickDirectory ? "shell-bridge" : "browser-input";
  return { files, directory };
}

export async function openFilesWithRuntime(
  runtime: RuntimeConfig,
  bridge: PhotoCalibratorShellBridge | null,
  fallback: () => PickedFiles | Promise<PickedFiles>,
): Promise<PickedFiles> {
  if (runtime.supportsShellBridge && bridge?.pickFiles) {
    return bridge.pickFiles();
  }
  return fallback();
}

export async function openDirectoryWithRuntime(
  runtime: RuntimeConfig,
  bridge: PhotoCalibratorShellBridge | null,
  fallback: () => PickedFiles | Promise<PickedFiles>,
): Promise<PickedFiles> {
  if (runtime.supportsShellBridge && bridge?.pickDirectory) {
    return bridge.pickDirectory();
  }
  return fallback();
}
