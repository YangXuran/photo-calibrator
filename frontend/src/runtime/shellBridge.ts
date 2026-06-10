export type ShellFileInfo = { name: string; path: string };
export type ShellPickedFiles = ShellFileInfo[] | File[] | null;

export type PhotoCalibratorShellBridge = {
  source?: "electron-preload" | "mock-browser";
  pickFiles?: () => Promise<ShellPickedFiles>;
  pickDirectory?: () => Promise<ShellPickedFiles>;
};

declare global {
  interface Window {
    __PHOTO_CALIBRATOR_SHELL__?: PhotoCalibratorShellBridge;
  }
}

export function getShellBridge(): PhotoCalibratorShellBridge | null {
  return window.__PHOTO_CALIBRATOR_SHELL__ ?? null;
}

export function setShellBridge(bridge: PhotoCalibratorShellBridge | null) {
  if (bridge) {
    window.__PHOTO_CALIBRATOR_SHELL__ = bridge;
  } else {
    delete window.__PHOTO_CALIBRATOR_SHELL__;
  }
}
