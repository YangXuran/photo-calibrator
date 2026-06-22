const DEFAULT_TEMP_DIR = "/tmp";

function resolveTempDir(): string {
  if (typeof window === "undefined") return DEFAULT_TEMP_DIR;
  const injected = window.__PHOTO_CALIBRATOR_RUNTIME__;
  if (typeof injected?.tempDir === "string" && injected.tempDir.trim().length > 0) {
    return injected.tempDir;
  }
  return DEFAULT_TEMP_DIR;
}

function joinTempPath(fileName: string): string {
  const tempDir = resolveTempDir().replace(/[\\/]$/, "");
  return `${tempDir}/${fileName}`;
}

function normalizeDir(dir: string): string {
  const trimmed = dir.trim();
  if (!trimmed) return resolveTempDir();
  return trimmed.replace(/[\\/]$/, "") || "/";
}

export function suggestExportPath(fileName: string, format: string): string {
  return suggestExportPathInDirectory(fileName, format, resolveTempDir());
}

export function suggestExportPathInDirectory(fileName: string, format: string, directory: string): string {
  const ext =
    format === "jpeg" ? "jpg" :
    format === "png" ? "png" :
    format === "tiff16" ? "tiff" :
    format === "sidecar" ? "json" :
    format === "cube" ? "cube" :
    format;
  const stem = fileName.replace(/\.[^.]+$/, "") || "photo";
  return `${normalizeDir(directory)}/${stem}-calibrated.${ext}`;
}

export function suggestSessionPath(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, "") || "session";
  return joinTempPath(`${stem}-session.json`);
}

export function directoryFromPath(filePath: string): string {
  const normalized = filePath.trim().replace(/[\\/]+$/, "");
  if (!normalized) return resolveTempDir();
  const slash = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  if (slash <= 0) return resolveTempDir();
  return normalized.slice(0, slash);
}

export function replaceDirectoryInPath(filePath: string, directory: string): string {
  const normalizedDirectory = normalizeDir(directory);
  const normalizedPath = filePath.trim().replace(/[\\/]+$/, "");
  const slash = Math.max(normalizedPath.lastIndexOf("/"), normalizedPath.lastIndexOf("\\"));
  const fileName = slash >= 0 ? normalizedPath.slice(slash + 1) : normalizedPath;
  return fileName ? `${normalizedDirectory}/${fileName}` : normalizedDirectory;
}
