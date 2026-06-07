import type { DocumentRenderPayload, WorkspaceFile } from "../types";

export function getWorkbenchViewerSources(selectedFile?: WorkspaceFile, documentRender?: DocumentRenderPayload | null) {
  const result = selectedFile?.result;

  return {
    originalSrc: result?.original_preview ?? selectedFile?.preview?.original_preview ?? selectedFile?.displayUrl,
    calibratedSrc: documentRender?.calibrated_image ?? result?.calibrated_image,
  };
}
