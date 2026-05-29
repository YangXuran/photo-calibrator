import { INSPECTOR_PANELS, TOOL_DEFINITIONS, toolLabel, panelLabel } from "../ui-config.js";

export function renderToolButtons(els, state, onSelectTool) {
  els.toolGrid.innerHTML = "";
  TOOL_DEFINITIONS.forEach((tool) => {
    const button = document.createElement("button");
    button.className = `tool-button${state.activeTool === tool.id ? " active" : ""}`;
    button.type = "button";
    button.dataset.tool = tool.id;
    button.textContent = toolLabel(tool);
    button.addEventListener("click", () => onSelectTool(tool.id));
    els.toolGrid.append(button);
  });
}

export function renderInspectorTabs(els, state, onSelectPanel) {
  els.inspectorTabsRoot.innerHTML = "";
  INSPECTOR_PANELS.forEach((panel) => {
    const button = document.createElement("button");
    button.className = `segment${state.inspectorPanel === panel.id ? " active" : ""}`;
    button.type = "button";
    button.dataset.panel = panel.id;
    button.dataset.testid = `inspector-tab-${panel.id}`;
    button.textContent = panelLabel(panel);
    button.addEventListener("click", () => onSelectPanel(panel.id));
    els.inspectorTabsRoot.append(button);
  });
}

export function renderInspectorPanels(els, state) {
  Object.entries(els.inspectorPanels).forEach(([name, panel]) => {
    panel.classList.toggle("hidden", state.inspectorPanel !== name);
  });
}

export function renderZones(els, zones, fmt) {
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

export function renderSkin(els, report, fmt) {
  const skin = report.skin;
  if (!skin) {
    els.skinStatus.textContent = t("skin.noStableRegion");
    els.skinStatus.classList.remove("detected");
    els.skinPixels.textContent = "-";
    els.skinA.textContent = "-";
    els.skinB.textContent = "-";
    els.skinDelta.textContent = "-";
    return;
  }
  const da = skin.a - report.lab.a;
  const db = skin.b - report.lab.b;
  els.skinStatus.textContent = t("skin.detected");
  els.skinStatus.classList.add("detected");
  els.skinPixels.textContent = String(skin.pixels);
  els.skinA.textContent = fmt(skin.a);
  els.skinB.textContent = fmt(skin.b);
  els.skinDelta.textContent = `${da >= 0 ? "+" : ""}${fmt(da)}/${db >= 0 ? "+" : ""}${fmt(db)}`;
}

import { t } from "../i18n.js";

export function setBusyMetrics(els) {
  els.sessionStatus.textContent = t("processing");
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

export function renderAccelerator(els, processing) {
  const fallback = processing.cpu_fallback_ops || [];
  const gpu = processing.gpu_ops || [];
  els.acceleratorBackend.textContent = processing.accelerator_backend || "-";
  els.acceleratorRequested.textContent = processing.accelerator_requested || "-";
  els.acceleratedOps.textContent = gpu.length ? gpu.join(", ") : t("accelerator.none");
  els.fallbackOps.textContent = fallback.length ? fallback.join(", ") : "-";
  els.fallbackReason.textContent = processing.fallback_reason || t("accelerator.none");
  els.openclStatus.textContent = processing.opencl_available
    ? processing.opencl_enabled
      ? t("accelerator.enabled")
      : t("accelerator.available")
    : t("accelerator.unavailable");
  els.lutPath.textContent = gpu.includes("3d-lut") ? "GPU" : "CPU";
}

export function renderAcceleratorPayload(els, accelerator) {
  if (!accelerator) return;
  renderAccelerator(els, {
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

export function renderBenchmark(els, benchmark, fmt) {
  els.benchmarkRows.innerHTML = "";
  const operations = benchmark?.operations || [];
  for (const op of operations) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${op.name}</td><td>${op.device || "-"}</td><td>${op.path || "-"}</td><td>${fmt(op.elapsed_ms, 2)}</td>`;
    els.benchmarkRows.append(tr);
  }
}
