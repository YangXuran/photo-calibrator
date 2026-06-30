import { t } from "../i18n";
import { resolveFileAccessPlan } from "../runtime/fileAccess";
import { useRuntimeConfig } from "../runtime/RuntimeProvider";
import { getShellBridge } from "../runtime/shellBridge";
import { DialogSectionCard } from "./DialogSectionCard";
import { DialogShell } from "./DialogShell";
import { InfoGrid } from "./InfoGrid";

type ShortcutHelpDialogProps = {
  open: boolean;
  onClose: () => void;
};

type ShortcutItem = {
  action: string;
  keys: string[];
};

const VIEWER_SHORTCUTS: ShortcutItem[] = [
  { action: t("shortcuts.viewerPrevNext"), keys: ["Left", "Right"] },
  { action: t("shortcuts.zoomInOut"), keys: ["+", "-"] },
  { action: t("shortcuts.resetFit"), keys: ["F"] },
  { action: t("shortcuts.toggleActualFit"), keys: ["Double Click"] },
  { action: t("shortcuts.wheelZoom"), keys: ["Wheel"] },
  { action: t("shortcuts.panDrag"), keys: ["Drag"] },
];

const FILMSTRIP_SHORTCUTS: ShortcutItem[] = [
  { action: t("shortcuts.filmstripPrevNext"), keys: ["Left", "Right"] },
  { action: t("shortcuts.filmstripHomeEnd"), keys: ["Home", "End"] },
  { action: t("shortcuts.focusThumb"), keys: ["Tab"] },
];

const WORKSPACE_SHORTCUTS: ShortcutItem[] = [
  { action: t("shortcuts.toggleAnalysis"), keys: ["Alt", "1"] },
  { action: t("shortcuts.toggleFilmstrip"), keys: ["Alt", "2"] },
  { action: t("shortcuts.toggleInspector"), keys: ["Alt", "3"] },
  { action: t("shortcuts.toggleViewerFocus"), keys: ["Shift", "F"] },
  { action: t("shortcuts.undoCalibration"), keys: ["Ctrl", "Z"] },
  { action: t("shortcuts.redoCalibration"), keys: ["Ctrl", "Shift", "Z"] },
];

function ShortcutList({ items }: { items: ShortcutItem[] }) {
  return (
    <div className="pc-shortcut-list">
      {items.map((item) => (
        <div className="pc-shortcut-row" key={`${item.action}-${item.keys.join("-")}`}>
          <div className="pc-shortcut-copy">
            <strong>{item.action}</strong>
          </div>
          <div className="pc-shortcut-keys">
            {item.keys.map((key) => (
              <kbd className="pc-kbd" key={key}>
                {key}
              </kbd>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ShortcutHelpDialog({ open, onClose }: ShortcutHelpDialogProps) {
  const runtime = useRuntimeConfig();
  const bridge = getShellBridge();
  const fileAccessPlan = resolveFileAccessPlan(runtime, bridge);

  return (
    <DialogShell
      ariaLabel="Shortcut help"
      className="pc-help-dialog"
      onClose={onClose}
      open={open}
      testId="shortcut-help-dialog"
      title={t("shortcuts.title")}
    >
      <DialogSectionCard title={t("labels.viewer")}>
        <ShortcutList items={VIEWER_SHORTCUTS} />
      </DialogSectionCard>

      <DialogSectionCard title={t("labels.filmstrip")}>
        <ShortcutList items={FILMSTRIP_SHORTCUTS} />
      </DialogSectionCard>

      <DialogSectionCard title={t("labels.workspaceLayout")}>
        <ShortcutList items={WORKSPACE_SHORTCUTS} />
      </DialogSectionCard>

      <DialogSectionCard title={t("labels.desktopRuntime")}>
        <InfoGrid
          items={[
            { label: t("labels.runtimeMode"), value: runtime.mode },
            { label: t("labels.shellBridge"), value: runtime.supportsShellBridge ? t("labels.enabled") : t("labels.disabled") },
            { label: t("labels.fileOpenStrategy"), value: fileAccessPlan.files },
            { label: t("labels.directoryStrategy"), value: fileAccessPlan.directory },
          ]}
        />
      </DialogSectionCard>
    </DialogShell>
  );
}
