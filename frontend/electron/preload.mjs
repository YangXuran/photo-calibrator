import { contextBridge, ipcRenderer } from "electron";

async function filePathToFile(filePath) {
  const data = await window.fetch(`file://${filePath}`).then((response) => response.arrayBuffer());
  const name = filePath.split(/[\\/]/).pop() || "photo";
  const file = new File([data], name);
  // Attach the absolute path so the frontend can send it to the backend
  // instead of re-reading the file content as a data URL.
  file.path = filePath;
  return file;
}

async function filePathsToFiles(filePaths) {
  const files = await Promise.all(filePaths.map((filePath) => filePathToFile(filePath)));
  return files;
}

const runtime = await ipcRenderer.invoke("photo-calibrator:get-runtime");

contextBridge.exposeInMainWorld("__PHOTO_CALIBRATOR_RUNTIME__", runtime);

contextBridge.exposeInMainWorld("__PHOTO_CALIBRATOR_SHELL__", {
  source: "electron-preload",
  pickFiles: async () => {
    const filePaths = await ipcRenderer.invoke("photo-calibrator:pick-files");
    return filePathsToFiles(filePaths);
  },
  pickDirectory: async () => {
    const directoryPaths = await ipcRenderer.invoke("photo-calibrator:pick-directory");
    const fileHandles = await Promise.all(
      directoryPaths.map(async (directoryPath) => {
        const entries = await ipcRenderer.invoke("photo-calibrator:list-directory-files", directoryPath);
        return filePathsToFiles(entries);
      }),
    );
    return fileHandles.flat();
  },
});
