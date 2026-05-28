const state = {
  files: [],
  selectedIndex: -1,
  objectUrls: new Map(),
  sessions: new Map(),
  requestId: 0,
  strengthPreviewTimer: null,
};

const rawExtensions = [".dng", ".cr2", ".cr3", ".nef", ".arw", ".raf", ".rw2", ".orf", ".pef", ".srw"];

const els = {
  folderInput: document.getElementById("folderInput"),
  fileInput: document.getElementById("fileInput"),
  filmstrip: document.getElementById("filmstrip"),
  folderLabel: document.getElementById("folderLabel"),
  countLabel: document.getElementById("countLabel"),
  fileTitle: document.getElementById("fileTitle"),
  emptyState: document.getElementById("emptyState"),
  imageGrid: document.getElementById("imageGrid"),
  originalImage: document.getElementById("originalImage"),
  calibratedImage: document.getElementById("calibratedImage"),
  modeSelect: document.getElementById("modeSelect"),
  strengthInput: document.getElementById("strengthInput"),
  strengthValue: document.getElementById("strengthValue"),
  acceleratorSelect: document.getElementById("acceleratorSelect"),
  benchmarkButton: document.getElementById("benchmarkButton"),
  beforeStrength: document.getElementById("beforeStrength"),
  afterStrength: document.getElementById("afterStrength"),
  reduction: document.getElementById("reduction"),
  direction: document.getElementById("direction"),
  analysisSize: document.getElementById("analysisSize"),
  castSource: document.getElementById("castSource"),
  previewSource: document.getElementById("previewSource"),
  acceleratorBackend: document.getElementById("acceleratorBackend"),
  acceleratorRequested: document.getElementById("acceleratorRequested"),
  acceleratedOps: document.getElementById("acceleratedOps"),
  fallbackOps: document.getElementById("fallbackOps"),
  fallbackReason: document.getElementById("fallbackReason"),
  benchmarkRows: document.getElementById("benchmarkRows"),
  openclStatus: document.getElementById("openclStatus"),
  lutPath: document.getElementById("lutPath"),
  cccValue: document.getElementById("cccValue"),
  pciValue: document.getElementById("pciValue"),
  zoneRows: document.getElementById("zoneRows"),
  skinStatus: document.getElementById("skinStatus"),
  skinPixels: document.getElementById("skinPixels"),
  skinA: document.getElementById("skinA"),
  skinB: document.getElementById("skinB"),
  skinDelta: document.getElementById("skinDelta"),
  rgbHistogram: document.getElementById("rgbHistogram"),
  labVector: document.getElementById("labVector"),
  strengthChart: document.getElementById("strengthChart"),
  zoneChart: document.getElementById("zoneChart"),
};

function imageFiles(fileList) {
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

function objectUrlFor(file) {
  if (!state.objectUrls.has(file)) {
    state.objectUrls.set(file, URL.createObjectURL(file));
  }
  return state.objectUrls.get(file);
}

function isBrowserDisplayable(file) {
  const name = file.name.toLowerCase();
  return !name.endsWith(".tif") && !name.endsWith(".tiff") && !rawExtensions.some((ext) => name.endsWith(ext));
}

function folderName(files) {
  const first = files.find((file) => file.webkitRelativePath);
  if (!first) return "手动选择";
  return first.webkitRelativePath.split("/")[0] || "文件夹";
}

function setFiles(files) {
  clearStrengthPreviewTimer();
  state.files = files;
  state.selectedIndex = files.length ? 0 : -1;
  els.folderLabel.textContent = files.length ? folderName(files) : "未加载文件夹";
  els.countLabel.textContent = `${files.length} 张`;
  renderFilmstrip();
  if (files.length) {
    selectFile(0);
  }
}

function clearStrengthPreviewTimer() {
  if (state.strengthPreviewTimer) {
    clearTimeout(state.strengthPreviewTimer);
    state.strengthPreviewTimer = null;
  }
}

function renderFilmstrip() {
  els.filmstrip.innerHTML = "";
  state.files.forEach((file, index) => {
    const button = document.createElement("button");
    button.className = `thumb${index === state.selectedIndex ? " active" : ""}`;
    button.type = "button";
    button.dataset.testid = "thumbnail";
    button.addEventListener("click", () => selectFile(index));

    const img = document.createElement("img");
    img.alt = file.name;
    img.src = objectUrlFor(file);
    const label = document.createElement("span");
    label.textContent = file.name;

    button.append(img, label);
    els.filmstrip.append(button);
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function fmt(value, digits = 1) {
  return Number.isFinite(value) ? value.toFixed(digits) : "-";
}

function renderZones(zones) {
  const names = ["global", "shadow", "midtone", "highlight"];
  els.zoneRows.innerHTML = "";
  for (const name of names) {
    const zone = zones[name];
    if (!zone) continue;
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${name}</td><td>${fmt(zone.a)}</td><td>${fmt(zone.b)}</td><td>${zone.pixels}</td>`;
    els.zoneRows.append(tr);
  }
}

function renderSkin(report) {
  const skin = report.skin;
  if (!skin) {
    els.skinStatus.textContent = "未检测到稳定肤色区域";
    els.skinStatus.classList.remove("detected");
    els.skinPixels.textContent = "-";
    els.skinA.textContent = "-";
    els.skinB.textContent = "-";
    els.skinDelta.textContent = "-";
    return;
  }
  const da = skin.a - report.lab.a;
  const db = skin.b - report.lab.b;
  els.skinStatus.textContent = "已检测";
  els.skinStatus.classList.add("detected");
  els.skinPixels.textContent = String(skin.pixels);
  els.skinA.textContent = fmt(skin.a);
  els.skinB.textContent = fmt(skin.b);
  els.skinDelta.textContent = `${da >= 0 ? "+" : ""}${fmt(da)}/${db >= 0 ? "+" : ""}${fmt(db)}`;
}

function clearCanvas(canvas) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#10120f";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawGrid(ctx, width, height, x0, y0, w, h) {
  ctx.strokeStyle = "#2f352d";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = y0 + (h * i) / 4;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x0 + w, y);
    ctx.stroke();
  }
  ctx.strokeStyle = "#596054";
  ctx.strokeRect(x0, y0, w, h);
}

function drawRgbHistogram(hist) {
  const canvas = els.rgbHistogram;
  const ctx = canvas.getContext("2d");
  clearCanvas(canvas);
  const pad = 22;
  const w = canvas.width - pad * 2;
  const h = canvas.height - pad * 2;
  drawGrid(ctx, canvas.width, canvas.height, pad, pad, w, h);
  const colors = { r: "#e96d5c", g: "#6fd1b5", b: "#6ea7e8" };
  const channels = hist.channels || hist;
  for (const key of ["r", "g", "b"]) {
    const channel = channels[key] || {};
    const values = channel.normalized || channel || [];
    ctx.strokeStyle = colors[key];
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    values.forEach((value, index) => {
      const x = pad + (index / Math.max(values.length - 1, 1)) * w;
      const y = pad + h - value * h;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
}

function drawLabVector(vectors) {
  const canvas = els.labVector;
  const ctx = canvas.getContext("2d");
  clearCanvas(canvas);
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const radius = Math.min(canvas.width, canvas.height) * 0.38;
  const maxAbs = Math.max(8, ...vectors.flatMap((v) => [Math.abs(v.a), Math.abs(v.b)]));
  ctx.strokeStyle = "#596054";
  ctx.beginPath();
  ctx.moveTo(cx - radius, cy);
  ctx.lineTo(cx + radius, cy);
  ctx.moveTo(cx, cy - radius);
  ctx.lineTo(cx, cy + radius);
  ctx.stroke();
  ctx.strokeStyle = "#3b4238";
  for (const r of [0.33, 0.66, 1]) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius * r, 0, Math.PI * 2);
    ctx.stroke();
  }
  const colors = ["#f0c15f", "#6fd1b5", "#f08aac"];
  vectors.forEach((v, index) => {
    const x = cx + (v.a / maxAbs) * radius;
    const y = cy - (v.b / maxAbs) * radius;
    ctx.strokeStyle = colors[index] || "#fff";
    ctx.fillStyle = colors[index] || "#fff";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillText(v.name, x + 7, y - 5);
  });
}

function drawStrengthChart(strengths) {
  const canvas = els.strengthChart;
  const ctx = canvas.getContext("2d");
  clearCanvas(canvas);
  const maxValue = Math.max(1, ...strengths.map((s) => s.value));
  const colors = ["#f0c15f", "#6fd1b5"];
  strengths.forEach((item, index) => {
    const x = 52 + index * 108;
    const barH = (item.value / maxValue) * 72;
    ctx.fillStyle = colors[index];
    ctx.fillRect(x, 98 - barH, 52, barH);
    ctx.fillStyle = "#f2f0ea";
    ctx.fillText(item.value.toFixed(1), x + 8, 88 - barH);
    ctx.fillStyle = "#b7b6ad";
    ctx.fillText(item.name, x + 4, 116);
  });
}

function drawZoneChart(zones) {
  const canvas = els.zoneChart;
  const ctx = canvas.getContext("2d");
  clearCanvas(canvas);
  const maxAbs = Math.max(3, ...zones.flatMap((z) => [Math.abs(z.a), Math.abs(z.b)]));
  const zero = canvas.height / 2;
  ctx.strokeStyle = "#596054";
  ctx.beginPath();
  ctx.moveTo(20, zero);
  ctx.lineTo(canvas.width - 12, zero);
  ctx.stroke();
  zones.forEach((zone, index) => {
    const x = 42 + index * 84;
    const ah = (zone.a / maxAbs) * 48;
    const bh = (zone.b / maxAbs) * 48;
    ctx.fillStyle = "#e96d5c";
    ctx.fillRect(x, zero - ah, 18, ah);
    ctx.fillStyle = "#6ea7e8";
    ctx.fillRect(x + 24, zero - bh, 18, bh);
    ctx.fillStyle = "#b7b6ad";
    ctx.fillText(zone.name, x - 4, 138);
  });
}

function renderCharts(charts) {
  if (!charts) return;
  drawRgbHistogram(charts.rgb_histogram || {});
  drawLabVector(charts.lab_vectors || []);
  drawStrengthChart(charts.strengths || []);
  drawZoneChart(charts.zones || []);
}

function setBusy() {
  els.afterStrength.textContent = "...";
  els.reduction.textContent = "...";
  els.direction.textContent = "...";
  els.analysisSize.textContent = "...";
  els.castSource.textContent = "...";
  els.previewSource.textContent = "...";
  els.acceleratorBackend.textContent = "...";
  els.acceleratorRequested.textContent = "...";
  els.acceleratedOps.textContent = "...";
  els.fallbackOps.textContent = "...";
  els.fallbackReason.textContent = "...";
  els.openclStatus.textContent = "...";
  els.lutPath.textContent = "...";
  els.cccValue.textContent = "...";
  els.pciValue.textContent = "...";
}

function renderAccelerator(processing) {
  const accelerated = processing.accelerated_ops || [];
  const fallback = processing.cpu_fallback_ops || [];
  const gpu = processing.gpu_ops || [];
  els.acceleratorBackend.textContent = processing.accelerator_backend || "-";
  els.acceleratorRequested.textContent = processing.accelerator_requested || "-";
  els.acceleratedOps.textContent = gpu.length ? gpu.join(", ") : "无";
  els.fallbackOps.textContent = fallback.length ? fallback.join(", ") : "-";
  els.fallbackReason.textContent = processing.fallback_reason || "无";
  els.openclStatus.textContent = processing.opencl_available
    ? processing.opencl_enabled
      ? "启用"
      : "可用/未启用"
    : "不可用";
  els.lutPath.textContent = gpu.includes("3d-lut") ? "GPU" : "CPU";
}

function renderAcceleratorPayload(accelerator) {
  if (!accelerator) return;
  renderAccelerator({
    accelerator_backend: accelerator.active_backend,
    accelerator_requested: accelerator.requested_backend,
    accelerated_ops: accelerator.accelerated_ops,
    cpu_fallback_ops: accelerator.cpu_fallback_ops,
    gpu_ops: accelerator.gpu_ops,
    fallback_reason: accelerator.fallback_reason,
    opencl_available: accelerator.opencl_available,
    opencl_enabled: accelerator.opencl_enabled,
  });
  if (accelerator.requested_backend && els.acceleratorSelect.value !== accelerator.requested_backend) {
    els.acceleratorSelect.value = accelerator.requested_backend;
  }
}

function renderBenchmark(benchmark) {
  els.benchmarkRows.innerHTML = "";
  const operations = benchmark?.operations || [];
  for (const op of operations) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${op.name}</td><td>${op.device || "-"}</td><td>${op.path || "-"}</td><td>${fmt(op.elapsed_ms, 2)}</td>`;
    els.benchmarkRows.append(tr);
  }
}

async function loadCapabilities(backend) {
  const suffix = backend ? `?backend=${encodeURIComponent(backend)}` : "";
  const response = await fetch(`/api/capabilities${suffix}`);
  if (!response.ok) {
    throw new Error(await response.text());
  }
  const payload = await response.json();
  renderAcceleratorPayload(payload.accelerator);
  return payload.accelerator;
}

async function runAcceleratorBenchmark() {
  els.benchmarkButton.disabled = true;
  els.benchmarkButton.textContent = "测试中";
  els.benchmarkRows.innerHTML = "";
  try {
    const backend = encodeURIComponent(els.acceleratorSelect.value || "auto");
    const response = await fetch(`/api/accelerator-benchmark?backend=${backend}&image_side=128&lut_size=9&iterations=2`);
    if (!response.ok) {
      throw new Error(await response.text());
    }
    const payload = await response.json();
    renderAcceleratorPayload(payload.benchmark?.accelerator);
    renderBenchmark(payload.benchmark);
  } catch (error) {
    els.fallbackReason.textContent = "基准测试失败";
    console.error(error);
  } finally {
    els.benchmarkButton.disabled = false;
    els.benchmarkButton.textContent = "基准测试";
  }
}

async function runCalibration(file, requestId) {
  setBusy();
  const cachedSession = state.sessions.get(file);
  let endpoint = "/api/calibrate-session";
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
    endpoint = "/api/calibrate";
    body = {
      image_data: imageData,
      file_name: file.name,
      mode: els.modeSelect.value,
      strength: Number(els.strengthInput.value),
    };
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    if (cachedSession) {
      state.sessions.delete(file);
      return runCalibration(file, requestId);
    }
    throw new Error(await response.text());
  }
  const payload = await response.json();
  if (requestId !== state.requestId) return;

  if (payload.session_id) {
    state.sessions.set(file, payload.session_id);
  }
  els.calibratedImage.src = payload.calibrated_image;
  if (payload.original_preview || imageData) {
    els.originalImage.src = payload.original_preview || imageData;
  }
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
  renderAccelerator(processing);
  els.cccValue.textContent = fmt(payload.charts?.ccc?.d_sigma);
  els.pciValue.textContent = fmt(payload.charts?.pci?.value);
  renderZones(payload.input.zones);
  renderSkin(payload.input);
  renderCharts(payload.charts);
}

function selectFile(index) {
  clearStrengthPreviewTimer();
  const file = state.files[index];
  if (!file) return;
  state.selectedIndex = index;
  state.requestId += 1;
  renderFilmstrip();

  els.emptyState.classList.add("hidden");
  els.imageGrid.classList.remove("hidden");
  els.fileTitle.textContent = file.webkitRelativePath || file.name;
  els.originalImage.src = isBrowserDisplayable(file) ? objectUrlFor(file) : "";
  els.calibratedImage.removeAttribute("src");

  runCalibration(file, state.requestId).catch((error) => {
    if (index !== state.selectedIndex) return;
    els.afterStrength.textContent = "失败";
    els.reduction.textContent = "-";
    els.direction.textContent = "API error";
    console.error(error);
  });
}

function rerunCurrentCalibration({ preserveImages = false } = {}) {
  if (state.selectedIndex >= 0) {
    if (!preserveImages) {
      selectFile(state.selectedIndex);
      return;
    }
    const file = state.files[state.selectedIndex];
    if (!file) return;
    const requestId = ++state.requestId;
    runCalibration(file, requestId).catch((error) => {
      if (requestId !== state.requestId) return;
      els.afterStrength.textContent = "失败";
      els.reduction.textContent = "-";
      els.direction.textContent = "API error";
      console.error(error);
    });
  }
}

function refreshCurrent() {
  rerunCurrentCalibration();
}

function scheduleStrengthPreview() {
  clearStrengthPreviewTimer();
  const file = state.files[state.selectedIndex];
  if (!file || !state.sessions.has(file)) return;
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
  const requestId = ++state.requestId;
  setBusy();
  try {
    await loadCapabilities(els.acceleratorSelect.value);
    state.sessions.clear();
    if (requestId !== state.requestId) return;
    if (state.selectedIndex >= 0) {
      selectFile(state.selectedIndex);
    }
  } catch (error) {
    els.fallbackReason.textContent = "加速后端切换失败";
    console.error(error);
  }
}

els.folderInput.addEventListener("change", (event) => {
  setFiles(imageFiles(event.target.files));
});

els.fileInput.addEventListener("change", (event) => {
  setFiles(imageFiles(event.target.files));
});

els.modeSelect.addEventListener("change", refreshCurrent);
els.acceleratorSelect.addEventListener("change", changeAccelerator);
els.benchmarkButton.addEventListener("click", runAcceleratorBenchmark);
els.strengthInput.addEventListener("input", () => {
  els.strengthValue.textContent = Number(els.strengthInput.value).toFixed(2);
  scheduleStrengthPreview();
});
els.strengthInput.addEventListener("change", commitStrengthPreview);

loadCapabilities().catch((error) => {
  els.fallbackReason.textContent = "无法读取加速状态";
  console.error(error);
});
