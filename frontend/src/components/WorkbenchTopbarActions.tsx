import { useRef } from "react";
import type { PickedFiles } from "../hooks/useWorkbench";
import type { RuntimeConfig } from "../runtime/config";
import type { WorkbenchController } from "../hooks/useWorkbench";
import { WorkbenchFileInputs } from "./WorkbenchFileInputs";
import { WorkbenchLayoutControls } from "./WorkbenchLayoutControls";
import { runOpenDirectoryAction, runOpenFilesAction } from "./WorkbenchOpenActions";
import { TopbarActionButton } from "./TopbarActionButton";
import { TopbarGroup } from "./TopbarGroup";

type WorkbenchTopbarActionsProps = {
  runtime: RuntimeConfig;
  focusMode: boolean;
  onPickFiles: (files: PickedFiles) => void;
  onOpenLayoutSettings: () => void;
  onOpenShortcutHelp: () => void;
  workbench: Pick<WorkbenchController, "activeLayoutPreset" | "applyLayoutPreset" | "layoutState" | "redo" | "toggleLayoutElement" | "toggleViewerFocusMode" | "undo">;
};

export function WorkbenchTopbarActions({
  runtime,
  focusMode,
  onPickFiles,
  onOpenLayoutSettings,
  onOpenShortcutHelp,
  workbench,
}: WorkbenchTopbarActionsProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const directoryInputRef = useRef<HTMLInputElement | null>(null);

  const bindDirectoryInput = (node: HTMLInputElement | null) => {
    directoryInputRef.current = node;
    if (!node) return;
    node.setAttribute("webkitdirectory", "");
    node.setAttribute("directory", "");
  };

  const actionButtons = [
    {
      label: runtime.supportsNativeDialogs ? "打开照片" : "导入照片",
      onClick: () =>
        void runOpenFilesAction({
          runtime,
          onPickFiles,
          openBrowserFiles: () => fileInputRef.current?.click(),
          openBrowserDirectory: () => directoryInputRef.current?.click(),
        }),
      testId: "open-files-button",
      tone: "primary" as const,
    },
    {
      label: runtime.supportsNativeDialogs ? "打开文件夹" : "导入文件夹",
      onClick: () =>
        void runOpenDirectoryAction({
          runtime,
          onPickFiles,
          openBrowserFiles: () => fileInputRef.current?.click(),
          openBrowserDirectory: () => directoryInputRef.current?.click(),
        }),
      testId: "open-directory-button",
    },
    {
      label: "布局",
      onClick: onOpenLayoutSettings,
      testId: "layout-settings-button",
    },
    {
      label: "帮助",
      onClick: onOpenShortcutHelp,
      testId: "shortcut-help-button",
    },
  ];

  return (
    <TopbarGroup className="pc-topbar-actions">
      <TopbarGroup className="pc-topbar-button-group">
        <TopbarActionButton onClick={() => workbench.undo()} testId="undo-button" tone="secondary">
          撤销
        </TopbarActionButton>
        <TopbarActionButton onClick={() => workbench.redo()} testId="redo-button" tone="secondary">
          重做
        </TopbarActionButton>
      </TopbarGroup>
      <WorkbenchLayoutControls workbench={workbench} />
      <TopbarGroup className="pc-topbar-button-group">
        {actionButtons.map((button) => (
          <TopbarActionButton key={button.testId} onClick={button.onClick} testId={button.testId} tone={button.tone}>
            {button.label}
          </TopbarActionButton>
        ))}
      </TopbarGroup>
      <WorkbenchFileInputs bindDirectoryInput={bindDirectoryInput} fileInputRef={fileInputRef} onPickFiles={onPickFiles} />
    </TopbarGroup>
  );
}
