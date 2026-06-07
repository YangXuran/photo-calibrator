export type RuntimeMode = "browser" | "desktop-shell";

export type RuntimeConfig = {
  apiBaseUrl: string;
  mode: RuntimeMode;
  shellName: string;
  supportsNativeDialogs: boolean;
  supportsShellBridge: boolean;
  enableMockShellBridge: boolean;
};

declare global {
  interface Window {
    __PHOTO_CALIBRATOR_RUNTIME__?: Partial<RuntimeConfig>;
  }
}

function normalizeBaseUrl(value?: string) {
  if (!value) return "";
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function parseBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  return undefined;
}

export function resolveRuntimeConfig(): RuntimeConfig {
  const injected = window.__PHOTO_CALIBRATOR_RUNTIME__ ?? {};
  const apiBaseUrl = normalizeBaseUrl(injected.apiBaseUrl ?? import.meta.env.VITE_API_BASE_URL);
  const mode = injected.mode ?? (import.meta.env.VITE_RUNTIME_MODE as RuntimeMode | undefined) ?? "browser";
  const shellName = injected.shellName ?? import.meta.env.VITE_SHELL_NAME ?? "Workbench";
  const supportsNativeDialogs =
    injected.supportsNativeDialogs ?? parseBoolean(import.meta.env.VITE_SUPPORTS_NATIVE_DIALOGS) ?? mode === "desktop-shell";
  const supportsShellBridge = injected.supportsShellBridge ?? parseBoolean(import.meta.env.VITE_SUPPORTS_SHELL_BRIDGE) ?? false;
  const enableMockShellBridge = parseBoolean(import.meta.env.VITE_ENABLE_MOCK_SHELL_BRIDGE) ?? false;
  return {
    apiBaseUrl,
    mode: mode === "desktop-shell" ? "desktop-shell" : "browser",
    shellName,
    supportsNativeDialogs: Boolean(supportsNativeDialogs),
    supportsShellBridge: Boolean(supportsShellBridge),
    enableMockShellBridge: Boolean(enableMockShellBridge),
  };
}
