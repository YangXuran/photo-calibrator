export function isBrowserDisplayable(file: File): boolean {
  const mime = file.type.toLowerCase();
  if (mime.startsWith("image/") && !mime.includes("tiff")) return true;
  return /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(file.name);
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export function workspaceFileId(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}
