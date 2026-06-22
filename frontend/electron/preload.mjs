import { contextBridge, ipcRenderer } from "electron";

function filePathToFileInfo(filePath, workspaceRoot) {
  const name = filePath.split(/[\\/]/).pop() || "photo";
  return { name, path: filePath, workspaceRoot };
}

const runtime = await ipcRenderer.invoke("photo-calibrator:get-runtime");

contextBridge.exposeInMainWorld("__PHOTO_CALIBRATOR_RUNTIME__", runtime);

contextBridge.exposeInMainWorld("__PHOTO_CALIBRATOR_SHELL__", {
  source: "electron-preload",
  pickFiles: async () => {
    const filePaths = await ipcRenderer.invoke("photo-calibrator:pick-files");
    return filePaths.map((filePath) => filePathToFileInfo(filePath, filePath.replace(/[\\/][^\\/]+$/, "")));
  },
  pickDirectory: async () => {
    const directoryPaths = await ipcRenderer.invoke("photo-calibrator:pick-directory");
    const allEntries = await Promise.all(
      directoryPaths.map(async (directoryPath) => {
        const entries = await ipcRenderer.invoke("photo-calibrator:list-directory-files", directoryPath);
        return entries.map((entry) => filePathToFileInfo(entry, directoryPath));
      }),
    );
    return allEntries.flat();
  },
  pickOutputDirectory: async (currentOutputPath) => (
    ipcRenderer.invoke("photo-calibrator:pick-output-directory", currentOutputPath)
  ),
});

// Bridge for macOS menu events sent from main process
contextBridge.exposeInMainWorld("__PHOTO_CALIBRATOR_MENU__", {
  onFilesPicked: (callback) => {
    const handler = (_event, files) => callback(files);
    ipcRenderer.on("menu:files-picked", handler);
    return () => { ipcRenderer.removeListener("menu:files-picked", handler); };
  },
});
