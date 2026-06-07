export function suggestExportPath(fileName: string, format: string): string {
  const ext =
    format === "jpeg" ? "jpg" :
    format === "png" ? "png" :
    format === "tiff16" ? "tiff" :
    format === "sidecar" ? "json" :
    format === "cube" ? "cube" :
    format;
  const stem = fileName.replace(/\.[^.]+$/, "") || "photo";
  return `/tmp/${stem}-calibrated.${ext}`;
}

export function suggestSessionPath(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, "") || "session";
  return `/tmp/${stem}-session.json`;
}
