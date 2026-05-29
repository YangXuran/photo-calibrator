import { currentDocument, defaultCropRect } from "../store.js";
import { t } from "../i18n.js";

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function renderCompareMode(els, state) {
  const modes = {
    "side-by-side": els.compareSideBySide,
    split: els.compareSplit,
    "calibrated-only": els.compareCalibrated,
  };
  Object.entries(modes).forEach(([mode, button]) => {
    button.classList.toggle("active", state.compareMode === mode);
  });
  els.imageGrid.classList.toggle("compare-split", state.compareMode === "split");
  els.imageGrid.classList.toggle("compare-calibrated", state.compareMode === "calibrated-only");
  els.originalFigure.classList.toggle("hidden", state.compareMode === "split" || state.compareMode === "calibrated-only");
  els.calibratedFigure.classList.toggle("hidden", state.compareMode === "split");
  els.splitCompare.classList.toggle("hidden", state.compareMode !== "split");
  els.splitControl.classList.toggle("hidden", state.compareMode !== "split");
  els.splitClip.style.width = `${state.splitPosition}%`;
  els.splitClip.style.setProperty("--split-ratio", String(state.splitPosition / 100));
  els.splitDivider.style.left = `${state.splitPosition}%`;
}

export function syncCompareImages(els) {
  els.splitOriginalImage.src = els.originalImage.src || "";
  els.splitCalibratedImage.src = els.calibratedImage.src || "";
}

export function renderCropOverlay(els, state) {
  const document = currentDocument();
  const rect = document?.cropRect || defaultCropRect();
  const left = rect.left * 100;
  const top = rect.top * 100;
  const width = rect.width * 100;
  const height = rect.height * 100;
  const right = 100 - left - width;
  const bottom = 100 - top - height;

  els.cropOverlay.classList.toggle("hidden", !(document?.cropOverlayEnabled) || state.selectedIndex < 0);
  els.cropBox.style.left = `${left}%`;
  els.cropBox.style.top = `${top}%`;
  els.cropBox.style.width = `${width}%`;
  els.cropBox.style.height = `${height}%`;
  els.cropOverlay.style.backgroundSize = `${left}% 100%, ${right}% 100%, 100% ${top}%, 100% ${bottom}%`;
  els.cropOverlay.style.backgroundPosition = `0 0, 100% 0, 0 0, 0 100%`;
  els.toggleCropOverlay.textContent = document?.cropOverlayEnabled ? t("crop.hideBox") : t("crop.showBox");
  els.cropStatus.textContent = document?.cropOverlayEnabled ? t("crop.manual") : t("crop.disabled");
  els.cropWidth.textContent = `${Math.round(width)}%`;
  els.cropHeight.textContent = `${Math.round(height)}%`;
  els.cropOffset.textContent = `${Math.round(left)} / ${Math.round(top)}`;
}

export function applyCropDrag(els, state, clientX, clientY) {
  const document = currentDocument();
  if (!state.cropDrag || !document) return;
  const rect = state.cropDrag.bounds;
  const pointX = clamp((clientX - rect.left) / rect.width, 0, 1);
  const pointY = clamp((clientY - rect.top) / rect.height, 0, 1);
  const minSize = 0.12;
  const next = { ...state.cropDrag.origin };

  if (state.cropDrag.handle === "move") {
    next.left = clamp(state.cropDrag.origin.left + pointX - state.cropDrag.startX, 0, 1 - state.cropDrag.origin.width);
    next.top = clamp(state.cropDrag.origin.top + pointY - state.cropDrag.startY, 0, 1 - state.cropDrag.origin.height);
  } else {
    const right = state.cropDrag.origin.left + state.cropDrag.origin.width;
    const bottom = state.cropDrag.origin.top + state.cropDrag.origin.height;
    if (state.cropDrag.handle.includes("w")) {
      const newLeft = clamp(pointX, 0, right - minSize);
      next.width = right - newLeft;
      next.left = newLeft;
    }
    if (state.cropDrag.handle.includes("e")) {
      next.width = clamp(pointX - state.cropDrag.origin.left, minSize, 1 - state.cropDrag.origin.left);
    }
    if (state.cropDrag.handle.includes("n")) {
      const newTop = clamp(pointY, 0, bottom - minSize);
      next.height = bottom - newTop;
      next.top = newTop;
    }
    if (state.cropDrag.handle.includes("s")) {
      next.height = clamp(pointY - state.cropDrag.origin.top, minSize, 1 - state.cropDrag.origin.top);
    }
  }

  document.cropRect = next;
  renderCropOverlay(els, state);
}

export function beginCropDrag(els, state, event, handle) {
  const document = currentDocument();
  if (!document?.cropOverlayEnabled) return;
  event.preventDefault();
  const bounds = els.cropOverlay.getBoundingClientRect();
  state.cropDrag = {
    handle,
    bounds,
    origin: { ...document.cropRect },
    startX: clamp((event.clientX - bounds.left) / bounds.width, 0, 1),
    startY: clamp((event.clientY - bounds.top) / bounds.height, 0, 1),
  };
}
