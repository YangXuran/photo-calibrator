import { els } from "./dom.js";
import { fetchAcceleratorBenchmark, fetchCapabilities, postCalibration, postCalibrationSession } from "./api/client.js";
import { createCalibrationController } from "./controllers/calibration.js";
import { createWorkspaceController } from "./controllers/workspace.js";
import { mountRegisteredInspectorExtensions } from "./extensions.js";
import { registerBuiltinPanelExtensions } from "./panel-extensions.js";
import { panelForTool } from "./ui-config.js";
import {
  clearAllSessions,
  currentDocument,
  currentFile,
  ensureDocumentState,
  folderName,
  imageFiles,
  isBrowserDisplayable,
  objectUrlFor,
  replaceFiles,
  resetCropRectForCurrent,
  state,
} from "./store.js";
import { renderCharts } from "./ui/charts.js";
import {
  renderAccelerator,
  renderAcceleratorPayload,
  renderBenchmark,
  renderInspectorPanels,
  renderInspectorTabs,
  renderSkin,
  renderToolButtons,
  renderZones,
  setBusyMetrics,
} from "./ui/inspector.js";
import { createPanelRegistry, renderPanelVisibility } from "./ui/panels.js";
import { applyCropDrag, beginCropDrag, renderCompareMode, renderCropOverlay, syncCompareImages } from "./ui/viewer.js";

const panelRegistry = createPanelRegistry(els);
registerBuiltinPanelExtensions({ state });
mountRegisteredInspectorExtensions(panelRegistry, { state });

function fmt(value, digits = 1) {
  return Number.isFinite(value) ? value.toFixed(digits) : "-";
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function clearStrengthPreviewTimer() {
  if (state.strengthPreviewTimer) {
    clearTimeout(state.strengthPreviewTimer);
    state.strengthPreviewTimer = null;
  }
}

function renderActiveTool() {
  renderToolButtons(els, state, setActiveTool);
}

function renderInspectorPanel() {
  renderInspectorTabs(els, state, setInspectorPanel);
  renderInspectorPanels(els, state);
  renderPanelVisibility(panelRegistry, state.inspectorPanel);
  panelRegistry.renderExtensions({ state });
}

const calibration = createCalibrationController({
  els,
  state,
  currentDocument,
  currentFile,
  ensureDocumentState,
  clearAllSessions,
  fetchCapabilities,
  fetchAcceleratorBenchmark,
  postCalibration,
  postCalibrationSession,
  setBusyMetrics,
  renderAccelerator,
  renderAcceleratorPayload,
  renderBenchmark,
  renderZones,
  renderSkin,
  renderCharts,
  renderCropOverlay: () => renderCropOverlay(els, state),
  syncCompareImages: () => syncCompareImages(els),
  fmt,
  fileToDataUrl,
});

const workspace = createWorkspaceController({
  els,
  state,
  folderName,
  objectUrlFor,
  replaceFiles,
  ensureDocumentState,
  isBrowserDisplayable,
  clearStrengthPreviewTimer,
  renderActiveTool,
  renderInspectorPanel,
  renderCompareMode: () => renderCompareMode(els, state),
  renderCropOverlay: () => renderCropOverlay(els, state),
  syncCompareImages: () => syncCompareImages(els),
  onSelectForCalibration(file, index, requestId) {
    calibration.runCalibration(file, requestId).catch((error) => {
      if (index !== state.selectedIndex) return;
      els.afterStrength.textContent = "Failed";
      els.reduction.textContent = "-";
      els.direction.textContent = "API error";
      console.error(error);
    });
  },
});

function setCompareMode(mode) {
  state.compareMode = mode;
  renderCompareMode(els, state);
}

function setInspectorPanel(panel) {
  state.inspectorPanel = panel;
  renderInspectorPanel();
}

function setActiveTool(tool) {
  state.activeTool = tool;
  renderActiveTool();
  setInspectorPanel(panelForTool(tool));
}

function suggestCropRect() {
  const document = currentDocument();
  if (!document) return;
  document.cropOverlayEnabled = true;
  document.cropRect = { left: 0.08, top: 0.08, width: 0.84, height: 0.84 };
  renderCropOverlay(els, state);
}

function rerunCurrentCalibration({ preserveImages = false } = {}) {
  return calibration.rerunCurrentCalibration({
    preserveImages,
    reselectCurrent: (index) => workspace.selectFile(index),
  });
}

function scheduleStrengthPreview() {
  clearStrengthPreviewTimer();
  if (!calibration.canPreviewCurrentStrength()) return;
  state.strengthPreviewTimer = setTimeout(() => {
    state.strengthPreviewTimer = null;
    rerunCurrentCalibration({ preserveImages: true });
  }, 160);
}

function commitStrengthPreview() {
  clearStrengthPreviewTimer();
  rerunCurrentCalibration({ preserveImages: true });
}

async function changeAccelerator() {
  clearStrengthPreviewTimer();
  return calibration.changeAccelerator((index) => workspace.selectFile(index));
}

els.folderInput.addEventListener("change", (event) => {
  workspace.setFiles(imageFiles(event.target.files));
});

els.fileInput.addEventListener("change", (event) => {
  workspace.setFiles(imageFiles(event.target.files));
});

els.modeSelect.addEventListener("change", () => rerunCurrentCalibration());
els.acceleratorSelect.addEventListener("change", changeAccelerator);
els.benchmarkButton.addEventListener("click", () => calibration.runAcceleratorBenchmark());
els.compareSideBySide.addEventListener("click", () => setCompareMode("side-by-side"));
els.compareSplit.addEventListener("click", () => setCompareMode("split"));
els.compareCalibrated.addEventListener("click", () => setCompareMode("calibrated-only"));
els.splitPositionInput.addEventListener("input", () => {
  state.splitPosition = Number(els.splitPositionInput.value);
  renderCompareMode(els, state);
});
els.toggleCropOverlay.addEventListener("click", () => {
  const document = currentDocument();
  if (!document) return;
  document.cropOverlayEnabled = !document.cropOverlayEnabled;
  renderCropOverlay(els, state);
});
els.suggestCropButton.addEventListener("click", suggestCropRect);
els.resetCropButton.addEventListener("click", () => {
  const document = currentDocument();
  if (!document) return;
  resetCropRectForCurrent();
  document.cropOverlayEnabled = false;
  renderCropOverlay(els, state);
});
els.cropBox.addEventListener("pointerdown", (event) => {
  if (event.target !== els.cropBox) return;
  beginCropDrag(els, state, event, "move");
});
els.cropBox.querySelectorAll(".crop-handle").forEach((handle) => {
  handle.addEventListener("pointerdown", (event) => beginCropDrag(els, state, event, handle.dataset.handle));
});
window.addEventListener("pointermove", (event) => applyCropDrag(els, state, event.clientX, event.clientY));
window.addEventListener("pointerup", () => {
  state.cropDrag = null;
});
els.strengthInput.addEventListener("input", () => {
  els.strengthValue.textContent = Number(els.strengthInput.value).toFixed(2);
  scheduleStrengthPreview();
});
els.strengthInput.addEventListener("change", commitStrengthPreview);

renderActiveTool();
renderInspectorPanel();
renderCompareMode(els, state);
renderCropOverlay(els, state);
calibration.loadCapabilities().catch((error) => {
  els.fallbackReason.textContent = "Cannot read accelerator status";
  console.error(error);
});
