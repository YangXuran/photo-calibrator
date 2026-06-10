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

function getEnv(key: string): string | undefined {
  // Next.js: process.env.NEXT_PUBLIC_*
  if (typeof process !== "undefined" && process.env) {
    return (process.env as Record<string, string | undefined>)["NEXT_PUBLIC_" + key];
  }
  return undefined;
}

export function resolveRuntimeConfig(): RuntimeConfig {
  const injected =
    typeof window !== "undefined" ? (window.__PHOTO_CALIBRATOR_RUNTIME__ ?? {}) : {};

  const apiBaseUrl = normalizeBaseUrl(
    injected.apiBaseUrl ?? getEnv("VITE_API_BASE_URL") ?? "http://127.0.0.1:8766",
  );
  const mode: RuntimeMode =
    injected.mode ??
    (getEnv("VITE_RUNTIME_MODE") as RuntimeMode | undefined) ??
    (getEnv("VITE_RUNTIME_MODE") === "desktop-shell" ? "desktop-shell" : "browser");
  const shellName = injected.shellName ?? getEnv("VITE_SHELL_NAME") ?? "Photo Calibrator";
  const supportsNativeDialogs =
    injected.supportsNativeDialogs ??
    parseBoolean(getEnv("VITE_SUPPORTS_NATIVE_DIALOGS")) ??
    mode === "desktop-shell";
  const supportsShellBridge =
    injected.supportsShellBridge ??
    parseBoolean(getEnv("VITE_SUPPORTS_SHELL_BRIDGE")) ??
    false;
  const enableMockShellBridge =
    parseBoolean(getEnv("VITE_ENABLE_MOCK_SHELL_BRIDGE")) ?? false;

  return {
    apiBaseUrl,
    mode: mode === "desktop-shell" ? "desktop-shell" : "browser",
    shellName,
    supportsNativeDialogs: Boolean(supportsNativeDialogs),
    supportsShellBridge: Boolean(supportsShellBridge),
    enableMockShellBridge: Boolean(enableMockShellBridge),
  };
}
