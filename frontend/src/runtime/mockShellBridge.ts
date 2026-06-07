import { setShellBridge, type PhotoCalibratorShellBridge, type ShellPickedFiles } from "./shellBridge";

function pickViaInput(options: { directory?: boolean } = {}): Promise<ShellPickedFiles> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.hidden = true;
    if (options.directory) {
      input.setAttribute("webkitdirectory", "");
      input.setAttribute("directory", "");
    }
    document.body.appendChild(input);

    let settled = false;

    const cleanup = () => {
      input.remove();
      window.removeEventListener("focus", onFocus, true);
    };

    const finish = (files: ShellPickedFiles) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(files);
    };

    const onFocus = () => {
      window.setTimeout(() => {
        if (!settled) finish(null);
      }, 0);
    };

    input.addEventListener(
      "change",
      () => {
        const files = input.files ? Array.from(input.files) : null;
        finish(files);
      },
      { once: true },
    );

    window.addEventListener("focus", onFocus, true);
    input.click();
  });
}

export function installMockShellBridge() {
  const bridge: PhotoCalibratorShellBridge = {
    source: "mock-browser",
    pickFiles: () => pickViaInput(),
    pickDirectory: () => pickViaInput({ directory: true }),
  };
  setShellBridge(bridge);
  return () => {
    const current = window.__PHOTO_CALIBRATOR_SHELL__;
    if (current?.source === "mock-browser") {
      setShellBridge(null);
    }
  };
}
