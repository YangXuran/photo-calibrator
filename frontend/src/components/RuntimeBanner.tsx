import type { RuntimeConfig } from "../runtime/config";
import { getRuntimePresentation } from "../runtime/presentation";

type RuntimeBannerProps = {
  runtime: RuntimeConfig;
};

export function RuntimeBanner({ runtime }: RuntimeBannerProps) {
  const presentation = getRuntimePresentation(runtime);

  return (
    <div className="pc-shell-banner" data-testid="runtime-banner">
      <span className="pc-shell-badge">{presentation.bannerModeLabel}</span>
      <span className="pc-shell-label">{runtime.shellName}</span>
      <span className="pc-shell-meta">{presentation.apiLabel}</span>
    </div>
  );
}
