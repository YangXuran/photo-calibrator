import type { PickedFiles } from "../hooks/useWorkbench";
import { openDirectoryWithRuntime, openFilesWithRuntime } from "../runtime/fileAccess";
import { getShellBridge } from "../runtime/shellBridge";
import type { RuntimeConfig } from "../runtime/config";

type WorkbenchOpenActionsProps = {
  runtime: RuntimeConfig;
  onPickFiles: (files: PickedFiles) => void;
  openBrowserFiles: () => void;
  openBrowserDirectory: () => void;
};

export async function runOpenFilesAction({ runtime, onPickFiles, openBrowserFiles }: WorkbenchOpenActionsProps) {
  const bridge = getShellBridge();
  const picked = await openFilesWithRuntime(runtime, bridge, () => {
    openBrowserFiles();
    return null;
  });
  if (picked) onPickFiles(picked);
}

export async function runOpenDirectoryAction({ runtime, onPickFiles, openBrowserDirectory }: WorkbenchOpenActionsProps) {
  const bridge = getShellBridge();
  const picked = await openDirectoryWithRuntime(runtime, bridge, () => {
    openBrowserDirectory();
    return null;
  });
  if (picked) onPickFiles(picked);
}
