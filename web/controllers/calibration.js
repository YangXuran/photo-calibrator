export function createCalibrationController({
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
  renderCropOverlay,
  syncCompareImages,
  fmt,
  fileToDataUrl,
}) {
  async function loadCapabilities(backend) {
    const payload = await fetchCapabilities(backend);
    renderAcceleratorPayload(els, payload.accelerator);
    return payload.accelerator;
  }

  async function runAcceleratorBenchmark() {
    els.benchmarkButton.disabled = true;
    els.benchmarkButton.textContent = "Testing...";
    els.benchmarkRows.innerHTML = "";
    try {
      const payload = await fetchAcceleratorBenchmark(els.acceleratorSelect.value || "auto");
      renderAcceleratorPayload(els, payload.benchmark?.accelerator);
      renderBenchmark(els, payload.benchmark, fmt);
    } catch (error) {
      els.fallbackReason.textContent = "Benchmark failed";
      console.error(error);
    } finally {
      els.benchmarkButton.disabled = false;
      els.benchmarkButton.textContent = "Benchmark";
    }
  }

  function applyCalibrationPayload(file, payload, imageData) {
    const document = ensureDocumentState(file);
    if (payload.session_id) {
      document.sessionId = payload.session_id;
    }
    document.lastPayload = payload;

    els.sessionStatus.textContent = payload.session_id ? "Cached" : "Done";
    els.calibratedImage.src = payload.calibrated_image;
    if (payload.original_preview || imageData) {
      els.originalImage.src = payload.original_preview || imageData;
    }
    syncCompareImages();
    els.beforeStrength.textContent = fmt(payload.input.lab.strength);
    els.afterStrength.textContent = fmt(payload.output.lab.strength);
    els.reduction.textContent = `${fmt(payload.reduction_pct, 0)}%`;
    els.direction.textContent = payload.input.direction;

    const processing = payload.processing || {};
    els.analysisSize.textContent = processing.analysis_width
      ? `${processing.analysis_width}x${processing.analysis_height}`
      : "-";
    els.castSource.textContent = processing.auto_cast_source || "-";
    els.previewSource.textContent = processing.preview_source || "-";
    renderAccelerator(els, processing);
    els.cccValue.textContent = fmt(payload.charts?.ccc?.d_sigma);
    els.pciValue.textContent = fmt(payload.charts?.pci?.value);
    renderZones(els, payload.input.zones, fmt);
    renderSkin(els, payload.input, fmt);
    renderCharts(els, payload.charts);
    renderCropOverlay();
  }

  async function runCalibration(file, requestId) {
    setBusyMetrics(els);
    const document = ensureDocumentState(file);
    const cachedSession = document.sessionId;
    let body = {
      session_id: cachedSession,
      mode: els.modeSelect.value,
      strength: Number(els.strengthInput.value),
      include_original: false,
    };
    let imageData = null;

    if (!cachedSession) {
      imageData = await fileToDataUrl(file);
      if (requestId !== state.requestId) return;
      body = {
        image_data: imageData,
        file_name: file.name,
        mode: els.modeSelect.value,
        strength: Number(els.strengthInput.value),
      };
    }

    let payload;
    try {
      payload = cachedSession ? await postCalibrationSession(body) : await postCalibration(body);
    } catch (error) {
      if (cachedSession) {
        document.sessionId = null;
        return runCalibration(file, requestId);
      }
      throw error;
    }
    if (requestId !== state.requestId) return;
    applyCalibrationPayload(file, payload, imageData);
  }

  async function rerunCurrentCalibration({ preserveImages = false, reselectCurrent } = {}) {
    if (state.selectedIndex < 0) return;
    if (!preserveImages && reselectCurrent) {
      reselectCurrent(state.selectedIndex);
      return;
    }
    const file = currentFile();
    if (!file) return;
    const requestId = ++state.requestId;
    try {
      await runCalibration(file, requestId);
    } catch (error) {
      if (requestId !== state.requestId) return;
      els.afterStrength.textContent = "Failed";
      els.reduction.textContent = "-";
      els.direction.textContent = "API error";
      console.error(error);
    }
  }

  async function changeAccelerator(reselectCurrent) {
    const requestId = ++state.requestId;
    setBusyMetrics(els);
    try {
      await loadCapabilities(els.acceleratorSelect.value);
      clearAllSessions();
      if (requestId !== state.requestId) return;
      if (state.selectedIndex >= 0 && reselectCurrent) {
        reselectCurrent(state.selectedIndex);
      }
    } catch (error) {
      els.fallbackReason.textContent = "Accelerator switch failed";
      console.error(error);
    }
  }

  function canPreviewCurrentStrength() {
    const file = currentFile();
    const document = currentDocument();
    return !!(file && document?.sessionId);
  }

  return {
    applyCalibrationPayload,
    canPreviewCurrentStrength,
    changeAccelerator,
    loadCapabilities,
    rerunCurrentCalibration,
    runAcceleratorBenchmark,
    runCalibration,
  };
}
