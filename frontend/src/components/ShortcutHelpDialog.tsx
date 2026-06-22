import { resolveFileAccessPlan } from "../runtime/fileAccess";
import { useRuntimeConfig } from "../runtime/RuntimeProvider";
import { getShellBridge } from "../runtime/shellBridge";
import { DetailNote } from "./DetailNote";
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
  note?: string;
};

const VIEWER_SHORTCUTS: ShortcutItem[] = [
  { action: "切换上一张 / 下一张", keys: ["Left", "Right"] },
  { action: "放大 / 缩小", keys: ["+", "-"] },
  { action: "重置到适配", keys: ["F"], note: "也支持 Ctrl/Cmd + 0" },
  { action: "切换 100% / 适配", keys: ["Double Click"] },
  { action: "滚轮缩放", keys: ["Wheel"] },
  { action: "手型平移", keys: ["Drag"] },
];

const FILMSTRIP_SHORTCUTS: ShortcutItem[] = [
  { action: "选择上一张 / 下一张", keys: ["Left", "Right"] },
  { action: "跳到首张 / 末张", keys: ["Home", "End"] },
  { action: "聚焦当前缩略图", keys: ["Tab"], note: "焦点进入 filmstrip 后可连续导航" },
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
            {item.note ? <span>{item.note}</span> : null}
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
      description="把 viewer、filmstrip 和 desktop runtime 的实际交互集中到一个入口里。"
      onClose={onClose}
      open={open}
      testId="shortcut-help-dialog"
      title="快捷键与工作区帮助"
    >
      <DialogSectionCard description="图像查看、缩放和平移" title="Viewer">
        <ShortcutList items={VIEWER_SHORTCUTS} />
      </DialogSectionCard>

      <DialogSectionCard description="缩略图选择和浏览" title="Filmstrip">
        <ShortcutList items={FILMSTRIP_SHORTCUTS} />
      </DialogSectionCard>

      <DialogSectionCard description="整栏显示和 viewer focus" title="Workspace Layout">
        <ShortcutList items={WORKSPACE_SHORTCUTS} />
      </DialogSectionCard>

      <DialogSectionCard description="当前壳层能力和文件访问分叉" title="Desktop Runtime">
        <InfoGrid
          items={[
            { label: "Runtime mode", value: runtime.mode },
            { label: "Shell bridge", value: runtime.supportsShellBridge ? "Enabled" : "Disabled" },
            { label: "File open strategy", value: fileAccessPlan.files },
            { label: "Directory strategy", value: fileAccessPlan.directory },
          ]}
        />
        <DetailNote
          body={`${fileAccessPlan.files === "shell-bridge" ? "打开照片优先走桌面壳 bridge。" : "打开照片仍回退到浏览器 input。"} ${fileAccessPlan.directory === "shell-bridge" ? "打开文件夹优先走桌面壳 bridge。" : "打开文件夹仍回退到浏览器 input。"}`}
          title="当前行为"
        />
      </DialogSectionCard>
    </DialogShell>
  );
}
