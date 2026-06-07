import type { RuntimeConfig } from "../runtime/config";
import { getRuntimePresentation } from "../runtime/presentation";
import { ShimmerText } from "./reactbits";
import { TopbarGroup } from "./TopbarGroup";
import { TopbarStatusPill } from "./TopbarStatusPill";

type RuntimeStatusChipsProps = {
  backendOk: boolean | null;
  runtime: RuntimeConfig;
};

export function RuntimeStatusChips({ backendOk, runtime }: RuntimeStatusChipsProps) {
  const presentation = getRuntimePresentation(runtime);
  const chips = [
    {
      label: presentation.shellLineLabel,
      tone: runtime.mode === "desktop-shell" ? "shell" : "default",
    },
    {
      label: runtime.supportsShellBridge ? "Bridge ready" : "Bridge pending",
      tone: runtime.supportsShellBridge ? "ok" : "default",
    },
    {
      label: backendOk ? "Backend Online" : backendOk === false ? "Backend Offline" : "Checking",
      tone: backendOk ? "ok" : backendOk === false ? "bad" : "default",
    },
  ] as const;

  return (
    <TopbarGroup className="pc-runtime-row" testId="runtime-status-chips">
      {chips.map((chip) => (
        <TopbarStatusPill key={chip.label} tone={chip.tone}>
          {chip.label === "Checking" ? (
            <ShimmerText text="Checking" />
          ) : (
            chip.label
          )}
        </TopbarStatusPill>
      ))}
    </TopbarGroup>
  );
}
