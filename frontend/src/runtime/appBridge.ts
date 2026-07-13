import type { PhotoCalibratorAppBridge } from "./config";

export function getAppBridge(): PhotoCalibratorAppBridge | null {
  if (typeof window === "undefined") return null;
  return window.__PHOTO_CALIBRATOR_APP__ ?? null;
}
