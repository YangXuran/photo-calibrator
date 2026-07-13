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
  const managedStatus = runtime.backend?.status;
  const backendLabel = managedStatus === "starting"
    ? "Backend Starting"
    : managedStatus === "failed"
      ? "Backend Failed"
      : managedStatus === "stopped"
        ? "Backend Stopped"
        : backendOk
          ? "Backend Online"
          : backendOk === false
            ? "Backend Offline"
            : "Checking";
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
      label: backendLabel,
      tone: managedStatus === "failed" || managedStatus === "stopped"
        ? "bad"
        : managedStatus === "starting"
          ? "default"
          : backendOk
            ? "ok"
            : backendOk === false
              ? "bad"
              : "default",
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
