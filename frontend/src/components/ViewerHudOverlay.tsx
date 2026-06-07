import type { ReactNode } from "react";
import { ViewerActionDock } from "./ViewerActionDock";
import { ViewerContextHud } from "./ViewerContextHud";
import type { ActiveLayoutPreset } from "../types";

type ViewerHudOverlayProps = {
  primary: string[];
  secondary?: string[];
  status?: string;
  actions?: ReactNode;
  hudCropPriority?: "primary" | "secondary" | "hidden";
  preset?: ActiveLayoutPreset;
  toolbar?: ReactNode;
  docked?: boolean;
  active?: boolean;
  onWake?: () => void;
  onScheduleHide?: () => void;
};

export function ViewerHudOverlay({ primary, secondary = [], status, actions, hudCropPriority = "secondary", preset, toolbar, docked = false, active = true, onWake, onScheduleHide }: ViewerHudOverlayProps) {
  if (!primary.length && !secondary.length && !status && !actions && !toolbar) return null;
  return (
    <div
      className={`pc-stage-hud ${docked ? "is-docked" : ""} ${active ? "is-active" : "is-dimmed"}`}
      data-testid="viewer-hud-overlay"
      onFocus={onWake}
      onMouseEnter={onWake}
      onMouseLeave={onScheduleHide}
      onMouseMove={onWake}
    >
      {toolbar ? <div className="pc-stage-hud-toolbar" data-testid="focus-overlay-toolbar">{toolbar}</div> : null}
      {docked ? (
        <>
          {status || actions ? (
            <div className="pc-stage-hud-dock pc-stage-hud-dock-left" data-testid="focus-overlay-left-dock">
              <ViewerActionDock actions={hudCropPriority !== "hidden" ? actions : undefined} cropPriority={hudCropPriority} status={hudCropPriority !== "hidden" ? status : undefined} />
            </div>
          ) : null}
          {primary.length || secondary.length ? (
            <div className="pc-stage-hud-dock pc-stage-hud-dock-right" data-testid="focus-overlay-right-dock">
              <ViewerContextHud preset={preset} primary={primary} secondary={secondary} />
            </div>
          ) : null}
        </>
      ) : primary.length ? (
        <div className="pc-stage-hud-group">
          {primary.map((item) => (
            <span className="pc-stage-hud-chip" key={`primary:${item}`}>
              {item}
            </span>
          ))}
        </div>
      ) : null}
      {!docked && secondary.length ? (
        <div className="pc-stage-hud-group is-secondary">
          {secondary.map((item) => (
            <span className="pc-stage-hud-chip is-secondary" key={`secondary:${item}`}>
              {item}
            </span>
          ))}
        </div>
      ) : null}
      {!docked && (status || actions) ? (
        <div className="pc-stage-hud-actions">
          {status ? <span className="pc-stage-hud-status">{status}</span> : null}
          {actions ? <div className="pc-stage-hud-buttons">{actions}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
