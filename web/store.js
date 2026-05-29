import { t } from "../i18n.js";

export const rawExtensions = [".dng", ".cr2", ".cr3", ".nef", ".arw", ".raf", ".rw2", ".orf", ".pef", ".srw"];

export const state = {
  files: [],
  selectedIndex: -1,
  objectUrls: new Map(),
  documents: new Map(),
  requestId: 0,
  strengthPreviewTimer: null,
  compareMode: "side-by-side",
  inspectorPanel: "adjust",
  activeTool: "inspect",
  splitPosition: 50,
  cropDrag: null,
};

export function imageFiles(fileList) {
  return Array.from(fileList)
    .filter((file) => {
      const name = file.name.toLowerCase();
      return (
        file.type.startsWith("image/") ||
        name.endsWith(".tif") ||
        name.endsWith(".tiff") ||
        rawExtensions.some((ext) => name.endsWith(ext))
      );
    })
    .sort((a, b) => {
      const ap = a.webkitRelativePath || a.name;
      const bp = b.webkitRelativePath || b.name;
      return ap.localeCompare(bp, undefined, { numeric: true });
    });
}

export function objectUrlFor(file) {
  if (!state.objectUrls.has(file)) {
    state.objectUrls.set(file, URL.createObjectURL(file));
  }
  return state.objectUrls.get(file);
}

export function isBrowserDisplayable(file) {
  const name = file.name.toLowerCase();
  return !name.endsWith(".tif") && !name.endsWith(".tiff") && !rawExtensions.some((ext) => name.endsWith(ext));
}

export function folderName(files) {
  const first = files.find((file) => file.webkitRelativePath);
  if (!first) return t("store.manualSelection");
  return first.webkitRelativePath.split("/")[0] || t("store.folder");
}

export function defaultCropRect() {
  return { left: 0.12, top: 0.1, width: 0.76, height: 0.8 };
}

export function documentKey(file) {
  return file.webkitRelativePath || file.name;
}

export function createDocumentState() {
  return {
    sessionId: null,
    cropOverlayEnabled: false,
    cropRect: defaultCropRect(),
    lastPayload: null,
  };
}

export function ensureDocumentState(file) {
  const key = documentKey(file);
  if (!state.documents.has(key)) {
    state.documents.set(key, createDocumentState());
  }
  return state.documents.get(key);
}

export function currentFile() {
  return state.files[state.selectedIndex] || null;
}

export function currentDocument() {
  const file = currentFile();
  return file ? ensureDocumentState(file) : null;
}

export function replaceFiles(files) {
  const nextDocuments = new Map();
  files.forEach((file) => {
    const key = documentKey(file);
    nextDocuments.set(key, state.documents.get(key) || createDocumentState());
  });
  state.documents = nextDocuments;
  state.files = files;
  state.selectedIndex = files.length ? 0 : -1;
}

export function resetCropRectForCurrent() {
  const document = currentDocument();
  if (!document) return;
  document.cropRect = defaultCropRect();
}

export function clearAllSessions() {
  state.documents.forEach((document) => {
    document.sessionId = null;
  });
}
