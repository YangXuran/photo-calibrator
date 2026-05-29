// i18n — simple translation layer for Photo Calibrator UI
// Usage: import { t, setLocale } from "../i18n.js";
//         element.textContent = t("calibration.mode.global");

const messages = {
  en: {},
  zh: {},
};

// ── toolbar ──────────────────────────────────────────────────────
messages.en["toolbar.openFolder"] = "Open Folder";
messages.zh["toolbar.openFolder"] = "打开文件夹";
messages.en["toolbar.addPhotos"] = "Add Photos";
messages.zh["toolbar.addPhotos"] = "添加照片";

// ── library panel ────────────────────────────────────────────────
messages.en["library.resources"] = "Resources";
messages.zh["library.resources"] = "资源";
messages.en["library.source"] = "Source";
messages.zh["library.source"] = "当前来源";
messages.en["library.photoCount"] = "Photo Count";
messages.zh["library.photoCount"] = "照片数量";
messages.en["library.quickTools"] = "Quick Tools";
messages.zh["library.quickTools"] = "快速工具";
messages.en["library.session"] = "Session";
messages.zh["library.session"] = "会话";
messages.en["library.currentDocument"] = "Current Document";
messages.zh["library.currentDocument"] = "当前文档";
messages.en["library.idle"] = "Idle";
messages.zh["library.idle"] = "空闲";
messages.en["library.notLoaded"] = "Not loaded";
messages.zh["library.notLoaded"] = "未加载";
messages.en["library.ready"] = "Ready";
messages.zh["library.ready"] = "就绪";
messages.en["library.sessionHint"] =
  "Parameter changes use session preview to avoid re-decoding the original.";
messages.zh["library.sessionHint"] =
  "参数修改走 session 预览，避免重复解码原图。";
messages.en["library.ariaLabel"] = "Resources &amp; Presets";
messages.zh["library.ariaLabel"] = "资源与预设";

// ── viewer ───────────────────────────────────────────────────────
messages.en["viewer.ariaLabel"] = "Photo Preview";
messages.zh["viewer.ariaLabel"] = "照片预览";
messages.en["viewer.noProject"] = "No project loaded";
messages.zh["viewer.noProject"] = "未加载项目";
messages.en["viewer.selectPhoto"] = "Select a photo to start";
messages.zh["viewer.selectPhoto"] = "选择照片开始";
messages.en["viewer.loadHint"] = "Load a photo to inspect calibration";
messages.zh["viewer.loadHint"] = "加载照片开始检查校准效果";
messages.en["viewer.loadHintDetail"] =
  "After selecting a folder, thumbnails appear in the filmstrip below.";
messages.zh["viewer.loadHintDetail"] =
  "选择文件夹后，底栏会显示该文件夹中的照片缩略图。";

// ── compare mode ─────────────────────────────────────────────────
messages.en["compare.sideBySide"] = "Side by Side";
messages.zh["compare.sideBySide"] = "双栏";
messages.en["compare.split"] = "Split";
messages.zh["compare.split"] = "擦拭";
messages.en["compare.calibrated"] = "Calibrated";
messages.zh["compare.calibrated"] = "校准图";
messages.en["compare.splitPosition"] = "Split Position";
messages.zh["compare.splitPosition"] = "擦拭位置";

// ── image grid ───────────────────────────────────────────────────
messages.en["image.original"] = "Original";
messages.zh["image.original"] = "原图";
messages.en["image.originalAlt"] = "Original preview";
messages.zh["image.originalAlt"] = "原图预览";
messages.en["image.calibratedPreview"] = "Calibrated Preview";
messages.zh["image.calibratedPreview"] = "校准预览";
messages.en["image.calibratedAlt"] = "Calibrated preview";
messages.zh["image.calibratedAlt"] = "校准预览";
messages.en["image.splitCaption"] = "Original / Calibrated Split View";
messages.zh["image.splitCaption"] = "原图 / 校准 擦拭对比";
messages.en["image.splitOriginalAlt"] = "Original split";
messages.zh["image.splitOriginalAlt"] = "原图擦拭对比";
messages.en["image.splitCalibratedAlt"] = "Calibrated split";
messages.zh["image.splitCalibratedAlt"] = "校准擦拭对比";

// crop handles
messages.en["image.cropNW"] = "NW crop handle";
messages.zh["image.cropNW"] = "左上裁切点";
messages.en["image.cropNE"] = "NE crop handle";
messages.zh["image.cropNE"] = "右上裁切点";
messages.en["image.cropSW"] = "SW crop handle";
messages.zh["image.cropSW"] = "左下裁切点";
messages.en["image.cropSE"] = "SE crop handle";
messages.zh["image.cropSE"] = "右下裁切点";

// ── inspector ────────────────────────────────────────────────────
messages.en["inspector.ariaLabel"] = "Inspector";
messages.zh["inspector.ariaLabel"] = "算法检查";
messages.en["inspector.noPhoto"] = "No photo selected";
messages.zh["inspector.noPhoto"] = "未选择照片";

// ── calibration panel ────────────────────────────────────────────
messages.en["calibration.mainTitle"] = "Main Calibration";
messages.zh["calibration.mainTitle"] = "主校准";
messages.en["calibration.mode"] = "Mode";
messages.zh["calibration.mode"] = "模式";
messages.en["calibration.mode.global"] = "Global";
messages.zh["calibration.mode.global"] = "全局校准";
messages.en["calibration.mode.midtones"] = "Midtones";
messages.zh["calibration.mode.midtones"] = "中间调";
messages.en["calibration.mode.skinPriority"] = "Skin Priority";
messages.zh["calibration.mode.skinPriority"] = "肤色优先";
messages.en["calibration.mode.highlights"] = "Highlights";
messages.zh["calibration.mode.highlights"] = "高光去偏";
messages.en["calibration.mode.preserveSplitTone"] = "Preserve Split Tone";
messages.zh["calibration.mode.preserveSplitTone"] = "保留分离色调";
messages.en["calibration.mode.rgbCurves"] = "RGB Curves";
messages.zh["calibration.mode.rgbCurves"] = "RGB 曲线";
messages.en["calibration.mode.zoneCorrection"] = "Zone Correction";
messages.zh["calibration.mode.zoneCorrection"] = "分区校正";
messages.en["calibration.mode.matrix"] = "3x3 Matrix";
messages.zh["calibration.mode.matrix"] = "3x3 矩阵";
messages.en["calibration.mode.lut3d"] = "3D LUT";
messages.zh["calibration.mode.lut3d"] = "3D LUT";
messages.en["calibration.mode.selectiveColor"] = "Selective Color";
messages.zh["calibration.mode.selectiveColor"] = "选择性色彩";
messages.en["calibration.mode.film"] = "Film Calibration";
messages.zh["calibration.mode.film"] = "胶片校准";
messages.en["calibration.strength"] = "Strength";
messages.zh["calibration.strength"] = "强度";
messages.en["calibration.accelerator"] = "Accelerator";
messages.zh["calibration.accelerator"] = "加速后端";
messages.en["calibration.acceleratorAuto"] = "Auto";
messages.zh["calibration.acceleratorAuto"] = "自动";
messages.en["calibration.acceleratorCpu"] = "CPU OpenCV";
messages.zh["calibration.acceleratorCpu"] = "CPU OpenCV";
messages.en["calibration.acceleratorOpencl"] = "OpenCL UMat";
messages.zh["calibration.acceleratorOpencl"] = "OpenCL UMat";
messages.en["calibration.acceleratorTorch"] = "Torch Auto";
messages.zh["calibration.acceleratorTorch"] = "Torch 自动";
messages.en["calibration.acceleratorTorchCuda"] = "Torch CUDA";
messages.zh["calibration.acceleratorTorchCuda"] = "Torch CUDA";
messages.en["calibration.acceleratorTorchMps"] = "Torch MPS";
messages.zh["calibration.acceleratorTorchMps"] = "Torch MPS";
messages.en["calibration.acceleratorMetal"] = "Metal MPS";
messages.zh["calibration.acceleratorMetal"] = "Metal MPS";

// ── metrics ──────────────────────────────────────────────────────
messages.en["metrics.originalStrength"] = "Original |dE|";
messages.zh["metrics.originalStrength"] = "原图 |dE|";
messages.en["metrics.calibratedStrength"] = "Calibrated |dE|";
messages.zh["metrics.calibratedStrength"] = "校准后 |dE|";
messages.en["metrics.reduction"] = "Reduction";
messages.zh["metrics.reduction"] = "削减率";
messages.en["metrics.direction"] = "Direction";
messages.zh["metrics.direction"] = "方向";
messages.en["metrics.analysisSize"] = "Analysis Size";
messages.zh["metrics.analysisSize"] = "分析尺寸";
messages.en["metrics.estSource"] = "Est. Source";
messages.zh["metrics.estSource"] = "估计来源";
messages.en["metrics.previewSource"] = "Preview Source";
messages.zh["metrics.previewSource"] = "预览来源";
messages.en["metrics.acceleratorBackend"] = "Accelerator";
messages.zh["metrics.acceleratorBackend"] = "加速后端";
messages.en["metrics.lutPath"] = "3D LUT Path";
messages.zh["metrics.lutPath"] = "3D LUT 路径";

// ── accelerator card ─────────────────────────────────────────────
messages.en["accelerator.status"] = "Accelerator Status";
messages.zh["accelerator.status"] = "加速状态";
messages.en["accelerator.benchmark"] = "Benchmark";
messages.zh["accelerator.benchmark"] = "基准测试";
messages.en["accelerator.requested"] = "Requested";
messages.zh["accelerator.requested"] = "请求";
messages.en["accelerator.opencl"] = "OpenCL";
messages.zh["accelerator.opencl"] = "OpenCL";
messages.en["accelerator.gpuOps"] = "GPU Ops";
messages.zh["accelerator.gpuOps"] = "GPU 路径";
messages.en["accelerator.cpuFallback"] = "CPU Fallback";
messages.zh["accelerator.cpuFallback"] = "CPU 回退";
messages.en["accelerator.op"] = "Op";
messages.zh["accelerator.op"] = "算子";
messages.en["accelerator.device"] = "Device";
messages.zh["accelerator.device"] = "设备";
messages.en["accelerator.path"] = "Path";
messages.zh["accelerator.path"] = "路径";

// ── analysis panel ───────────────────────────────────────────────
messages.en["analysis.brightnessZones"] = "Brightness Zones";
messages.zh["analysis.brightnessZones"] = "亮度分区";
messages.en["analysis.zone"] = "Zone";
messages.zh["analysis.zone"] = "区域";
messages.en["analysis.pixels"] = "Pixels";
messages.zh["analysis.pixels"] = "像素";
messages.en["analysis.skinDetection"] = "Skin Detection";
messages.zh["analysis.skinDetection"] = "肤色检测";
messages.en["analysis.skinNotDetected"] = "Not Detected";
messages.zh["analysis.skinNotDetected"] = "未检测";
messages.en["analysis.skinPixels"] = "Pixels";
messages.zh["analysis.skinPixels"] = "像素";
messages.en["analysis.skinVsGlobal"] = "vs Global";
messages.zh["analysis.skinVsGlobal"] = "相对全图";
messages.en["analysis.rgbHistogram"] = "RGB Histogram";
messages.zh["analysis.rgbHistogram"] = "RGB 直方图";
messages.en["analysis.labVector"] = "Lab a/b Vector";
messages.zh["analysis.labVector"] = "Lab a/b 向量";
messages.en["analysis.calibrationStrength"] = "Calibration Strength";
messages.zh["analysis.calibrationStrength"] = "校准强度";
messages.en["analysis.zoneCast"] = "Zone Cast";
messages.zh["analysis.zoneCast"] = "分区偏色";

// ── crop panel ───────────────────────────────────────────────────
messages.en["crop.title"] = "Film Scan Crop";
messages.zh["crop.title"] = "翻拍裁切";
messages.en["crop.showBox"] = "Show Crop Box";
messages.zh["crop.showBox"] = "显示裁切框";
messages.en["crop.hideBox"] = "Hide Crop Box";
messages.zh["crop.hideBox"] = "隐藏裁切框";
messages.en["crop.suggest"] = "Suggest";
messages.zh["crop.suggest"] = "建议框";
messages.en["crop.reset"] = "Reset";
messages.zh["crop.reset"] = "重置";
messages.en["crop.status"] = "Status";
messages.zh["crop.status"] = "状态";
messages.en["crop.disabled"] = "Disabled";
messages.zh["crop.disabled"] = "未启用";
messages.en["crop.manual"] = "Manual";
messages.zh["crop.manual"] = "手动调整";
messages.en["crop.width"] = "Width";
messages.zh["crop.width"] = "宽度";
messages.en["crop.height"] = "Height";
messages.zh["crop.height"] = "高度";
messages.en["crop.offset"] = "Offset";
messages.zh["crop.offset"] = "偏移";
messages.en["crop.detectionStrategy"] = "Detection Strategy";
messages.zh["crop.detectionStrategy"] = "检测策略";
messages.en["crop.candidates"] = "Candidates";
messages.zh["crop.candidates"] = "候选来源";
messages.en["crop.candidatesValue"] = "Edges / Lines / Corners";
messages.zh["crop.candidatesValue"] = "边框 / 直线 / 四角";
messages.en["crop.currentState"] = "Current State";
messages.zh["crop.currentState"] = "当前状态";
messages.en["crop.currentStateValue"] = "Manual frame, awaiting algorithm";
messages.zh["crop.currentStateValue"] = "手动框架，待接算法";
messages.en["crop.backendNote"] =
  "Will only receive structured crop suggestions; algorithms stay in backend.";
messages.zh["crop.backendNote"] =
  "后续只接结构化裁切建议，不把算法塞进前端。";

// ── filmstrip ────────────────────────────────────────────────────
messages.en["filmstrip.noFolder"] = "No folder loaded";
messages.zh["filmstrip.noFolder"] = "未加载文件夹";
messages.en["filmstrip.photos"] = "photos";
messages.zh["filmstrip.photos"] = "张";

// ── tool definitions ─────────────────────────────────────────────
messages.en["tool.inspect"] = "Inspect";
messages.zh["tool.inspect"] = "检查";
messages.en["tool.crop"] = "Crop";
messages.zh["tool.crop"] = "裁切";
messages.en["tool.tone"] = "Tone";
messages.zh["tool.tone"] = "色调";
messages.en["tool.export"] = "Export";
messages.zh["tool.export"] = "导出";

// ── inspector panels ─────────────────────────────────────────────
messages.en["panel.adjust"] = "Adjust";
messages.zh["panel.adjust"] = "调整";
messages.en["panel.analysis"] = "Analysis";
messages.zh["panel.analysis"] = "分析";
messages.en["panel.filmScan"] = "Film Scan";
messages.zh["panel.filmScan"] = "翻拍";

// ── store fallbacks ──────────────────────────────────────────────
messages.en["store.manualSelection"] = "Manual selection";
messages.zh["store.manualSelection"] = "手动选择";
messages.en["store.folder"] = "Folder";
messages.zh["store.folder"] = "文件夹";

// ── calibration controller status ────────────────────────────────
messages.en["status.testing"] = "Testing...";
messages.zh["status.testing"] = "测试中";
messages.en["status.benchmarkFailed"] = "Benchmark failed";
messages.zh["status.benchmarkFailed"] = "基准测试失败";
messages.en["status.cached"] = "Cached";
messages.zh["status.cached"] = "已缓存";
messages.en["status.done"] = "Done";
messages.zh["status.done"] = "完成";
messages.en["status.failed"] = "Failed";
messages.zh["status.failed"] = "失败";
messages.en["status.acceleratorSwitchFailed"] = "Accelerator switch failed";
messages.zh["status.acceleratorSwitchFailed"] = "加速后端切换失败";
messages.en["status.cannotReadAccelerator"] = "Cannot read accelerator status";
messages.zh["status.cannotReadAccelerator"] = "无法读取加速状态";

// ── workspace controller ─────────────────────────────────────────
messages.en["workspace.noFolderLoaded"] = "No folder loaded";
messages.zh["workspace.noFolderLoaded"] = "未加载文件夹";
messages.en["workspace.ready"] = "Ready";
messages.zh["workspace.ready"] = "就绪";
messages.en["workspace.idle"] = "Idle";
messages.zh["workspace.idle"] = "空闲";

// ── inspector UI (dynamic status) ────────────────────────────────
messages.en["skin.noStableRegion"] = "No stable skin region detected";
messages.zh["skin.noStableRegion"] = "未检测到稳定肤色区域";
messages.en["skin.detected"] = "Detected";
messages.zh["skin.detected"] = "已检测";
messages.en["processing"] = "Processing...";
messages.zh["processing"] = "处理中";
messages.en["accelerator.none"] = "None";
messages.zh["accelerator.none"] = "无";
messages.en["accelerator.enabled"] = "Enabled";
messages.zh["accelerator.enabled"] = "启用";
messages.en["accelerator.available"] = "Available";
messages.zh["accelerator.available"] = "可用/未启用";
messages.en["accelerator.unavailable"] = "Unavailable";
messages.zh["accelerator.unavailable"] = "不可用";

// ── panel extensions ─────────────────────────────────────────────
messages.en["ext.workspaceStatus"] = "Workspace Status";
messages.zh["ext.workspaceStatus"] = "工作区状态";
messages.en["ext.activeTool"] = "Active Tool";
messages.zh["ext.activeTool"] = "当前工具";
messages.en["ext.currentFile"] = "Current File";
messages.zh["ext.currentFile"] = "当前文件";
messages.en["ext.documentCache"] = "Document Cache";
messages.zh["ext.documentCache"] = "文档缓存";
messages.en["ext.none"] = "None";
messages.zh["ext.none"] = "未选择";

// ── locale ───────────────────────────────────────────────────────
let _currentLocale = "en";

export function t(key) {
  return messages[_currentLocale]?.[key] ?? key;
}

export function setLocale(locale) {
  if (messages[locale]) {
    _currentLocale = locale;
    document.documentElement.lang = locale;
    _translateDOM();
  }
}

export function getLocale() {
  return _currentLocale;
}

// ── DOM translation (for static data-i18n attributes) ────────────
export function translateDOM(root = document) {
  _currentLocale = _currentLocale; // keep current, just re-run
  _translateDOM(root);
}

function _translateDOM(root = document) {
  // Elements with data-i18n attribute: replace textContent
  for (const el of root.querySelectorAll("[data-i18n]")) {
    const key = el.getAttribute("data-i18n");
    el.textContent = t(key);
  }
  // Elements with data-i18n-placeholder: replace placeholder
  for (const el of root.querySelectorAll("[data-i18n-placeholder]")) {
    const key = el.getAttribute("data-i18n-placeholder");
    el.placeholder = t(key);
  }
  // Elements with data-i18n-aria: replace aria-label
  for (const el of root.querySelectorAll("[data-i18n-aria]")) {
    const key = el.getAttribute("data-i18n-aria");
    el.setAttribute("aria-label", t(key));
  }
  // Elements with data-i18n-alt: replace alt attribute
  for (const el of root.querySelectorAll("[data-i18n-alt]")) {
    const key = el.getAttribute("data-i18n-alt");
    el.alt = t(key);
  }
  // Elements with data-i18n-title: replace title attribute
  for (const el of root.querySelectorAll("[data-i18n-title]")) {
    const key = el.getAttribute("data-i18n-title");
    el.title = t(key);
  }
}
