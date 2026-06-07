import type { RuntimeConfig } from "./config";

type RuntimePresentation = {
  bannerModeLabel: string;
  brandSubtitle: string;
  shellLineLabel: string;
  apiLabel: string;
};

export function getRuntimePresentation(runtime: RuntimeConfig): RuntimePresentation {
  const isDesktop = runtime.mode === "desktop-shell";

  return {
    bannerModeLabel: isDesktop ? "Desktop Shell" : "Browser Runtime",
    brandSubtitle: isDesktop ? "Desktop Workbench Preview" : "Browser Workbench Preview",
    shellLineLabel: `${isDesktop ? "Desktop" : "Browser"} · ${runtime.shellName}`,
    apiLabel: runtime.apiBaseUrl ? `API ${runtime.apiBaseUrl}` : "API same-origin",
  };
}
