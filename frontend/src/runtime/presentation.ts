import type { RuntimeConfig } from "./config";

type RuntimePresentation = {
  brandSubtitle: string;
  shellLineLabel: string;
};

export function getRuntimePresentation(runtime: RuntimeConfig): RuntimePresentation {
  const isDesktop = runtime.mode === "desktop-shell";

  return {
    brandSubtitle: isDesktop ? "Desktop Workbench Preview" : "Browser Workbench Preview",
    shellLineLabel: `${isDesktop ? "Desktop" : "Browser"} · ${runtime.shellName}`,
  };
}
