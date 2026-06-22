import type { DocumentRenderPayload, WorkspaceFile } from "../types";

export function getWorkbenchViewerSources(selectedFile?: WorkspaceFile, documentRender?: DocumentRenderPayload | null) {
  const result = selectedFile?.result;

  return {
    originalSrc: selectedFile?.cropApplied || result?.processing?.crop_applied
      ? result?.original_preview ?? result?.calibrated_image
      : selectedFile?.highResPreview?.original_preview ?? selectedFile?.preview?.original_preview ?? selectedFile?.displayUrl,
    calibratedSrc: documentRender?.calibrated_image ?? result?.calibrated_image,
  };
}
