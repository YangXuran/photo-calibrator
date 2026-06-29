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
  { action: "切换上一张 / 下一张", keys: ["Left", "Right"] },
  { action: "放大 / 缩小", keys: ["+", "-"] },
  { action: "重置到适配", keys: ["F"] },
  { action: "切换 100% / 适配", keys: ["Double Click"] },
  { action: "滚轮缩放", keys: ["Wheel"] },
  { action: "手型平移", keys: ["Drag"] },
];

const FILMSTRIP_SHORTCUTS: ShortcutItem[] = [
  { action: "选择上一张 / 下一张", keys: ["Left", "Right"] },
  { action: "跳到首张 / 末张", keys: ["Home", "End"] },
  { action: "聚焦当前缩略图", keys: ["Tab"] },
];

const WORKSPACE_SHORTCUTS: ShortcutItem[] = [
  { action: "切换左侧 Analysis", keys: ["Alt", "1"] },
  { action: "切换底部 Filmstrip", keys: ["Alt", "2"] },
  { action: "切换右侧 Inspector", keys: ["Alt", "3"] },
  { action: "进入 / 退出 Viewer Focus", keys: ["Shift", "F"] },
  { action: "撤销校准参数", keys: ["Ctrl", "Z"] },
  { action: "重做校准参数", keys: ["Ctrl", "Shift", "Z"] },
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
      title="快捷键"
    >
      <DialogSectionCard title="Viewer">
        <ShortcutList items={VIEWER_SHORTCUTS} />
      </DialogSectionCard>

      <DialogSectionCard title="Filmstrip">
        <ShortcutList items={FILMSTRIP_SHORTCUTS} />
      </DialogSectionCard>

      <DialogSectionCard title="Workspace Layout">
        <ShortcutList items={WORKSPACE_SHORTCUTS} />
      </DialogSectionCard>

      <DialogSectionCard title="Desktop Runtime">
        <InfoGrid
          items={[
            { label: "Runtime mode", value: runtime.mode },
            { label: "Shell bridge", value: runtime.supportsShellBridge ? "Enabled" : "Disabled" },
            { label: "File open strategy", value: fileAccessPlan.files },
            { label: "Directory strategy", value: fileAccessPlan.directory },
          ]}
        />
      </DialogSectionCard>
    </DialogShell>
  );
}
