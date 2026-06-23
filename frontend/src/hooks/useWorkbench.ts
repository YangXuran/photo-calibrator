import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchAIEvaluators, fetchCapabilities, fetchConfig, fetchHealth, fetchPlugins, fetchSessionList, fetchSessionLoad, postAIEvaluate, postCalibration, postCalibrationSession, postDocumentRender, postExport, postFilmScan, postHistoryCommit, postHistoryMove, postPreview, postSessionDelete, postSessionSave, postWorkspaceOpen, putConfig } from "../lib/api";
import { fileToDataUrl, isBrowserDisplayable, workspaceFileId } from "../lib/files";
import { DEFAULT_WORKBENCH_PREFERENCES } from "../lib/layoutPresets";
import { directoryFromPath, suggestExportPath, suggestExportPathInDirectory, suggestSessionPath } from "../lib/paths";
import { loadAISettings, saveAISettings, type AIProviderSettings } from "../components/AIProviderCard";
import type {
  ActionState,
  AIEvaluationPayload,
  CalibrationPayload,
  CapabilityPayload,
  ChannelCurve,
  CompareMode,
  CropRect,
  CropPayload,
  DocumentRenderPayload,
  EvaluatorInfo,
  BatchExportItemResult,
  ExportPayload,
  HistogramPayload,
  HistoryEntry,
  ImageTransform,
  InspectorTab,
  LookAdjustments,
  ManualCurves,
  NotificationItem,
  PluginInfo,
  PersistedEditState,
  SessionListItem,
  SessionSavePayload,
  SourceFilter,
  ViewerPan,
  ViewerWorkspaceState,
  ViewerZoomMode,
  WorkbenchPreferences,
  WorkspaceFile,
} from "../types";
import { DEFAULT_IDENTITY_CURVE } from "../types";
import { perfMark, perfReset, perfDump } from "../lib/perf";
import { debugLog } from "../lib/debugLog";

type ExportOptions = {
  format: string;
  outputPath: string;
  quality: number;
  embedIcc: boolean;
  preserveMetadata: boolean;
  exportTransform: string;
};

type SessionOptions = {
  savePath: string;
};

type CurveInteraction = "idle" | "drag";
type CurvePreviewFallbackCache = {
  key: string;
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

const WORKBENCH_PREFERENCES_KEY = "photo-calibrator:workbench-preferences";
const WORKBENCH_INSPECTOR_TAB_KEY = "photo-calibrator:workbench-inspector-tab";
const WORKBENCH_VIEWER_STATE_KEY = "photo-calibrator:workbench-viewer-state";
const CURVE_PREVIEW_INTERACTIVE_SIDE = 480;
const CURVE_PREVIEW_DRAG_FPS = 30;

/** A file info from shell bridge with path (no File object for non-browser files) */
export type PathFileInfo = { name: string; path: string; workspaceRoot?: string };

export type PickedFiles = FileList | File[] | PathFileInfo[] | null;

function loadWorkbenchPreferences(): WorkbenchPreferences {
  if (typeof window === "undefined") return DEFAULT_WORKBENCH_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(WORKBENCH_PREFERENCES_KEY);
    if (!raw) return DEFAULT_WORKBENCH_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<WorkbenchPreferences>;
    return {
      ...DEFAULT_WORKBENCH_PREFERENCES,
      ...parsed,
      showAnalysisPane: parsed.showAnalysisPane ?? Boolean((parsed as Partial<WorkbenchPreferences> & { showLibraryPane?: boolean }).showLibraryPane ?? true),
    };
  } catch {
    return DEFAULT_WORKBENCH_PREFERENCES;
  }
}

function workspacePathKey(value: string): string {
  return value.replace(/^\/private(?=\/var\/)/, "");
}

function loadInspectorTab(): InspectorTab {
  if (typeof window === "undefined") return "adjust";
  try {
    const raw = window.localStorage.getItem(WORKBENCH_INSPECTOR_TAB_KEY);
    if (!raw) return "adjust";
    const parsed = JSON.parse(raw) as string;
    if (parsed === "color" || parsed === "analysis") return "adjust";
    if (["adjust", "look", "curves", "compose", "ai", "export", "session", "settings"].includes(parsed)) {
      return parsed as InspectorTab;
    }
    return "adjust";
  } catch {
    return "adjust";
  }
}

function loadViewerState(): ViewerWorkspaceState {
  if (typeof window === "undefined") {
    return { compareMode: "side-by-side", splitPosition: 50, zoomMode: "fit", zoomScale: 1, pan: { x: 0, y: 0 } };
  }
  try {
    const raw = window.localStorage.getItem(WORKBENCH_VIEWER_STATE_KEY);
    if (!raw) {
      return { compareMode: "side-by-side", splitPosition: 50, zoomMode: "fit", zoomScale: 1, pan: { x: 0, y: 0 } };
    }
    const parsed = JSON.parse(raw) as ViewerWorkspaceState;
    return parsed;
  } catch {
    return { compareMode: "side-by-side", splitPosition: 50, zoomMode: "fit", zoomScale: 1, pan: { x: 0, y: 0 } };
  }
}

function cloneCurve(curve: ChannelCurve): ChannelCurve {
  return curve.map((point) => [...point] as [number, number]);
}

function buildCurveLut(curve: ChannelCurve): Uint8Array {
  const lut = new Uint8Array(256);
  const points = curve.length >= 2 ? curve : [[0, 0], [255, 255]];
  let segment = 0;
  for (let x = 0; x <= 255; x += 1) {
    while (segment < points.length - 2 && x > points[segment + 1]![0]) {
      segment += 1;
    }
    const p0 = points[segment]!;
    const p1 = points[Math.min(segment + 1, points.length - 1)]!;
    const span = Math.max(1, p1[0] - p0[0]);
    const t = Math.max(0, Math.min(1, (x - p0[0]) / span));
    lut[x] = Math.round(p0[1] + (p1[1] - p0[1]) * t);
  }
  return lut;
}

function cloneManualCurves(curves: ManualCurves): ManualCurves {
  return {
    l: cloneCurve(curves.l),
    r: cloneCurve(curves.r),
    g: cloneCurve(curves.g),
    b: cloneCurve(curves.b),
  };
}

function createIdentityManualCurves(): ManualCurves {
  return cloneManualCurves({
    l: DEFAULT_IDENTITY_CURVE,
    r: DEFAULT_IDENTITY_CURVE,
    g: DEFAULT_IDENTITY_CURVE,
    b: DEFAULT_IDENTITY_CURVE,
  });
}

function serializeCurve(curve: ChannelCurve): string {
  return curve.map(([x, y]) => `${x}:${y}`).join("|");
}

function curvesFromState(l: ChannelCurve, r: ChannelCurve, g: ChannelCurve, b: ChannelCurve): ManualCurves {
  return { l, r, g, b };
}

function composeManualCurves(curves: ManualCurves): { r: ChannelCurve; g: ChannelCurve; b: ChannelCurve } {
  const master = buildCurveLut(curves.l);
  const red = buildCurveLut(curves.r);
  const green = buildCurveLut(curves.g);
  const blue = buildCurveLut(curves.b);
  const toCurve = (lut: Uint8Array): ChannelCurve => Array.from({ length: 256 }, (_, index) => [index, lut[index] ?? index] as [number, number]);
  const composeChannel = (lut: Uint8Array) => {
    const out = new Uint8Array(256);
    for (let index = 0; index < 256; index += 1) {
      out[index] = lut[master[index] ?? index] ?? index;
    }
    return out;
  };
  return {
    r: toCurve(composeChannel(red)),
    g: toCurve(composeChannel(green)),
    b: toCurve(composeChannel(blue)),
  };
}

const DEFAULT_LOOK_ADJUSTMENTS: LookAdjustments = {
  labBias: { a: 0, b: 0 },
  colorGrade: {
    shadows: { hue: 225, saturation: 0, luminance: 0 },
    midtones: { hue: 35, saturation: 0, luminance: 0 },
    highlights: { hue: 45, saturation: 0, luminance: 0 },
    global: { hue: 35, saturation: 0, luminance: 0 },
    blending: 0.55,
    balance: 0,
  },
  pointColor: {
    enabled: false,
    hue: 120,
    range: 24,
    hueShift: 0,
    saturation: 0,
    luminance: 0,
  },
};

function cloneLookAdjustments(look?: Partial<LookAdjustments>): LookAdjustments {
  return {
    labBias: {
      a: Number(look?.labBias?.a ?? DEFAULT_LOOK_ADJUSTMENTS.labBias.a),
      b: Number(look?.labBias?.b ?? DEFAULT_LOOK_ADJUSTMENTS.labBias.b),
    },
    colorGrade: {
      shadows: { ...DEFAULT_LOOK_ADJUSTMENTS.colorGrade.shadows, ...look?.colorGrade?.shadows },
      midtones: { ...DEFAULT_LOOK_ADJUSTMENTS.colorGrade.midtones, ...look?.colorGrade?.midtones },
      highlights: { ...DEFAULT_LOOK_ADJUSTMENTS.colorGrade.highlights, ...look?.colorGrade?.highlights },
      global: { ...DEFAULT_LOOK_ADJUSTMENTS.colorGrade.global, ...look?.colorGrade?.global },
      blending: Number(look?.colorGrade?.blending ?? DEFAULT_LOOK_ADJUSTMENTS.colorGrade.blending),
      balance: Number(look?.colorGrade?.balance ?? DEFAULT_LOOK_ADJUSTMENTS.colorGrade.balance),
    },
    pointColor: {
      ...DEFAULT_LOOK_ADJUSTMENTS.pointColor,
      ...look?.pointColor,
      enabled: Boolean(look?.pointColor?.enabled),
    },
  };
}

function serializeLookAdjustments(look: LookAdjustments): string {
  const normalized = cloneLookAdjustments(look);
  return JSON.stringify(normalized);
}

function lookPayloadForRequest(look: LookAdjustments) {
  const normalized = cloneLookAdjustments(look);
  return {
    lab_bias: normalized.labBias,
    color_grade: {
      shadows: normalized.colorGrade.shadows,
      midtones: normalized.colorGrade.midtones,
      highlights: normalized.colorGrade.highlights,
      global: normalized.colorGrade.global,
      blending: normalized.colorGrade.blending,
      balance: normalized.colorGrade.balance,
    },
    point_color: {
      enabled: normalized.pointColor.enabled,
      hue: normalized.pointColor.hue,
      range: normalized.pointColor.range,
      hue_shift: normalized.pointColor.hueShift,
      saturation: normalized.pointColor.saturation,
      luminance: normalized.pointColor.luminance,
    },
  };
}

function buildCalibrationSignature(
  mode: string,
  strength: number,
  negativeBaseEnabled: boolean,
  accelerator: string,
  curves: ManualCurves,
  lookAdjustments: LookAdjustments,
  cropRect?: CropRect,
  imageTransform?: ImageTransform,
): string {
  return [
    mode,
    strength.toFixed(4),
    negativeBaseEnabled ? "negative-base:on" : "negative-base:off",
    accelerator,
    serializeCurve(curves.l),
    serializeCurve(curves.r),
    serializeCurve(curves.g),
    serializeCurve(curves.b),
    serializeLookAdjustments(lookAdjustments),
    serializeCropRect(cropRect),
    serializeImageTransform(imageTransform),
  ].join("::");
}

function hasAnalysisCharts(charts?: CalibrationPayload["charts"]): boolean {
  return Boolean(
    charts?.rgb_histogram
    && charts.lab_vectors?.length
    && charts.strengths?.length,
  );
}

function serializeCropRect(cropRect?: CropRect): string {
  if (!cropRect) return "crop:none";
  return [
    "crop",
    cropRect.left.toFixed(5),
    cropRect.top.toFixed(5),
    cropRect.width.toFixed(5),
    cropRect.height.toFixed(5),
  ].join(":");
}

function cropRectForRequest(crop?: CropPayload): CropRect | undefined {
  return crop?.crop_rect;
}

function isCropApplied(item?: WorkspaceFile): boolean {
  return Boolean(item?.cropApplied || item?.result?.processing?.crop_applied);
}

function serializeImageTransform(transform?: ImageTransform): string {
  const normalized = normalizeImageTransform(transform);
  return [
    "transform",
    normalized.rotation.toFixed(1),
    normalized.flipH ? "h1" : "h0",
    normalized.flipV ? "v1" : "v0",
  ].join(":");
}

const DEFAULT_IMAGE_TRANSFORM: ImageTransform = {
  rotation: 0,
  flipH: false,
  flipV: false,
};

function normalizeRotation(value: number): number {
  let next = Number.isFinite(value) ? value : 0;
  next = ((next + 180) % 360 + 360) % 360 - 180;
  return Math.abs(next) < 0.0001 ? 0 : Number(next.toFixed(1));
}

function normalizeImageTransform(transform?: Partial<ImageTransform>): ImageTransform {
  return {
    rotation: normalizeRotation(transform?.rotation ?? 0),
    flipH: Boolean(transform?.flipH),
    flipV: Boolean(transform?.flipV),
  };
}

function isDefaultImageTransform(transform?: Partial<ImageTransform>): boolean {
  const normalized = normalizeImageTransform(transform);
  return normalized.rotation === 0 && !normalized.flipH && !normalized.flipV;
}

function imageTransformForRequest(transform?: Partial<ImageTransform>): ImageTransform | undefined {
  const normalized = normalizeImageTransform(transform);
  return isDefaultImageTransform(normalized) ? undefined : normalized;
}

function buildDefaultExportState(
  item: WorkspaceFile,
  accelerator: string,
  curves: ManualCurves,
  lookAdjustments: LookAdjustments,
): PersistedEditState {
  return {
    mode: "global",
    strength: 0.8,
    negativeBaseEnabled: false,
    accelerator,
    curves,
    lookAdjustments: cloneLookAdjustments(lookAdjustments),
    crop: item.crop,
    cropEdited: item.cropEdited,
    cropApplied: isCropApplied(item),
    imageTransform: normalizeImageTransform(item.imageTransform),
    runtimeSessionId: item.sessionId,
  };
}

function effectiveExportMode(stateMode: string, item?: WorkspaceFile): string {
  if (stateMode !== "auto-best") return stateMode;
  return item?.result?.processing?.auto_best_selected_mode ?? stateMode;
}

function resolvePreviewMaxSide(preview?: WorkspaceFile["highResPreview"] | WorkspaceFile["preview"]): number | null {
  const width = preview?.processing?.analysis_width ?? 0;
  const height = preview?.processing?.analysis_height ?? 0;
  const side = Math.max(width, height);
  return side > 0 ? side : null;
}

export function useWorkbench() {
  const [backendOk, setBackendOk] = useState<boolean | null>(null);
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [evaluators, setEvaluators] = useState<EvaluatorInfo[]>([]);
  const [capabilities, setCapabilities] = useState<CapabilityPayload | null>(null);
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const filesRef = useRef<WorkspaceFile[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [viewerState, setViewerState] = useState<ViewerWorkspaceState>(() => loadViewerState());
  const [mode, setMode] = useState("global");
  const [negativeBaseEnabled, setNegativeBaseEnabled] = useState(false);
  const [strength, setStrength] = useState(0.8);
  const [lookAdjustments, setLookAdjustments] = useState<LookAdjustments>(() => cloneLookAdjustments(DEFAULT_LOOK_ADJUSTMENTS));
  const [accelerator, setAccelerator] = useState("auto");
  const [loading, setLoading] = useState(false);
  const [highResLoading, setHighResLoading] = useState(false);
  const [activeInspectorTab, setActiveInspectorTabState] = useState<InspectorTab>(() => loadInspectorTab());
  const [exportOptions, setExportOptions] = useState<ExportOptions>({
    format: "jpeg",
    outputPath: suggestExportPath("photo.jpg", "jpeg"),
    quality: 92,
    embedIcc: true,
    preserveMetadata: true,
    exportTransform: "auto",
  });
  const [sessionOptions, setSessionOptions] = useState<SessionOptions>({
    savePath: suggestSessionPath("photo.jpg"),
  });
  const [exportResult, setExportResult] = useState<ExportPayload | null>(null);
  const [batchExportResults, setBatchExportResults] = useState<BatchExportItemResult[]>([]);
  const [documentRender, setDocumentRender] = useState<DocumentRenderPayload | null>(null);
  const documentRenderFileRef = useRef<string | null>(null);
  const [sessionSaveResult, setSessionSaveResult] = useState<SessionSavePayload | null>(null);
  const [savedSessions, setSavedSessions] = useState<SessionListItem[]>([]);
  const [selectedEvaluator, setSelectedEvaluator] = useState("__default__");
  const [aiContext, setAiContext] = useState("还原真实白平衡，同时保留胶片感。");
  const [aiSettings, setAISettings] = useState<AIProviderSettings>(loadAISettings);
  const [aiResult, setAiResult] = useState<AIEvaluationPayload | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [activityLog, setActivityLog] = useState<NotificationItem[]>([]);
  const [actionStates, setActionStates] = useState<{
    calibration: ActionState;
    filmScan: ActionState;
    export: ActionState;
    batchExport: ActionState;
    ai: ActionState;
    session: ActionState;
    document: ActionState;
  }>({
    calibration: { status: "idle" },
    filmScan: { status: "idle" },
    export: { status: "idle" },
    batchExport: { status: "idle" },
    ai: { status: "idle" },
    session: { status: "idle" },
    document: { status: "idle" },
  });
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [lCurve, setLCurve] = useState<ChannelCurve>([...DEFAULT_IDENTITY_CURVE.map((p) => [...p] as [number, number])]);
  const [rCurve, setRCurve] = useState<ChannelCurve>([...DEFAULT_IDENTITY_CURVE.map((p) => [...p] as [number, number])]);
  const [gCurve, setGCurve] = useState<ChannelCurve>([...DEFAULT_IDENTITY_CURVE.map((p) => [...p] as [number, number])]);
  const [bCurve, setBCurve] = useState<ChannelCurve>([...DEFAULT_IDENTITY_CURVE.map((p) => [...p] as [number, number])]);
  const [committedCurves, setCommittedCurves] = useState<ManualCurves>(() => createIdentityManualCurves());
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [preferences, setPreferences] = useState<WorkbenchPreferences>(() => loadWorkbenchPreferences());
  const [viewerFocusMode, setViewerFocusMode] = useState(false);
  const [stageContainerSize, setStageContainerSizeState] = useState<{ width: number; height: number } | null>(null);
  const [curveInteraction, setCurveInteraction] = useState<CurveInteraction>("idle");
  const [localCurvePreviewBitmap, setLocalCurvePreviewBitmap] = useState<ImageBitmap | null>(null);
  const [localCurvePreviewHistogram, setLocalCurvePreviewHistogram] = useState<HistogramPayload | null>(null);
  const [curveStateFileId, setCurveStateFileId] = useState<string>();
  const requestRef = useRef(0);
  const calibrationDepthRef = useRef(0);
  const currentResMaxSideRef = useRef(320);
  const prevDepsRef = useRef<{ id?: string; mode: string; negativeBaseEnabled: boolean; strength: number; lookSignature: string }>({ mode: "global", negativeBaseEnabled: false, strength: 0.8, lookSignature: serializeLookAdjustments(DEFAULT_LOOK_ADJUSTMENTS) });
  const fileCurvesRef = useRef<Map<string, ManualCurves>>(new Map());
  const fileLookRef = useRef<Map<string, LookAdjustments>>(new Map());
  const highResTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const highResRequestRef = useRef(0);
  const highResSessionRef = useRef<string | null>(null);
  const curveSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const curvePreviewFrameRef = useRef<number | null>(null);
  const curvePreviewRenderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const curvePreviewBitmapRef = useRef<ImageBitmap | null>(null);
  const curvePreviewCacheKeyRef = useRef<string | null>(null);
  const curvePreviewFallbackCacheRef = useRef<CurvePreviewFallbackCache | null>(null);
  const curvePreviewSequenceRef = useRef(0);
  const curvePreviewLastDragMsRef = useRef(0);
  const curveInteractionRef = useRef<CurveInteraction>("idle");
  const persistenceWarningShownRef = useRef<Set<string>>(new Set());
  /* undo stack for calibration parameters (mode + strength + accelerator + curves) */
  type UndoSnapshot = { mode: string; strength: number; negativeBaseEnabled: boolean; accelerator: string; lCurve: ChannelCurve; rCurve: ChannelCurve; gCurve: ChannelCurve; bCurve: ChannelCurve; lookAdjustments: LookAdjustments };
  const undoStackRef = useRef<UndoSnapshot[]>([]);
  const undoIndexRef = useRef(-1);
  const undoingRef = useRef(false);
  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyIndexRef = useRef(historyIndex);
  const editBeforeRef = useRef<PersistedEditState | null>(null);
  const pendingCommitRef = useRef<{ description: string; actionType: string; state: PersistedEditState } | null>(null);
  const activeCommitKeyRef = useRef<string | null>(null);
  const appliedCropIdsRef = useRef<Set<string>>(new Set());
  const selectedFile = useMemo(() => {
    const item = files.find((entry) => entry.id === selectedId);
    if (!item || !appliedCropIdsRef.current.has(item.id) || item.cropApplied) return item;
    return { ...item, cropApplied: true };
  }, [files, selectedId]);
  function currentEditState(overrides: Partial<PersistedEditState> = {}): PersistedEditState {
    return {
      mode,
      strength,
      negativeBaseEnabled,
      accelerator,
      curves: cloneManualCurves({ l: lCurve, r: rCurve, g: gCurve, b: bCurve }),
      lookAdjustments: cloneLookAdjustments(lookAdjustments),
      crop: selectedFile?.crop,
      cropEdited: selectedFile?.cropEdited,
      cropApplied: isCropApplied(selectedFile),
      imageTransform: normalizeImageTransform(selectedFile?.imageTransform),
      runtimeSessionId: selectedFile?.sessionId,
      ...overrides,
    };
  }

  function historyFromApi(entries: any[]): HistoryEntry[] {
    return entries.map((entry) => ({
      description: entry.description,
      timestamp: new Date(entry.created_at * 1000).toLocaleTimeString([], { hour12: false }),
      operation_count: 1,
      current_op_name: entry.action_type,
      sequence_no: entry.sequence_no,
      before_state: entry.before_state,
      after_state: entry.after_state,
    }));
  }

  function beginEdit() {
    if (!editBeforeRef.current) {
      editBeforeRef.current = currentEditState();
      activeCommitKeyRef.current = null;
    }
  }

  async function persistCommittedEdit(
    description: string,
    actionType: string,
    afterState: PersistedEditState,
    calibratedImage?: string,
  ) {
    const target = selectedFile;
    const beforeState = editBeforeRef.current ?? target?.persistedState ?? afterState;
    editBeforeRef.current = null;
    if (!target) return;
    const persistentSessionId = target.persistentSessionId ?? `workspace:${target.id}`;
    if (!target.workspaceRoot || !(target.file as any)?.path) {
      pushHistoryEntry(description, 1, actionType);
      return;
    }
    try {
      const response = await postHistoryCommit({
        workspace_root: target.workspaceRoot,
        source_path: (target.file as any).path,
        persistent_session_id: persistentSessionId,
        description,
        action_type: actionType,
        before_state: beforeState,
        after_state: afterState,
        calibrated_image: calibratedImage ?? target.result?.calibrated_image,
        document: target.result?.document,
      });
      const nextHistory = historyFromApi(response.history);
      setHistory(nextHistory);
      setHistoryIndex(response.history_cursor);
      setFiles((items) => items.map((item) => item.id === target.id ? {
        ...item,
        persistentSessionId,
        persistedState: afterState,
        persistedHistory: nextHistory,
        persistedHistoryIndex: response.history_cursor,
        historyPersistent: true,
      } : item));
    } catch (error) {
      pushHistoryEntry(description, 1, actionType);
      setFiles((items) => items.map((item) => item.id === target.id ? { ...item, historyPersistent: false } : item));
      if (!persistenceWarningShownRef.current.has(target.id)) {
        persistenceWarningShownRef.current.add(target.id);
        notify("warning", "历史未持久化", String(error));
      }
    }
  }

  function commitEdit(description: string, actionType: string, stateOverride?: PersistedEditState) {
    const state = stateOverride ?? currentEditState();
    const commitKey = `${actionType}:${JSON.stringify(state)}`;
    if (activeCommitKeyRef.current === commitKey) return;
    activeCommitKeyRef.current = commitKey;
    pendingCommitRef.current = { description, actionType, state };
    const signature = buildCalibrationSignature(state.mode, state.strength, Boolean(state.negativeBaseEnabled), state.accelerator, state.curves, cloneLookAdjustments(state.lookAdjustments), state.cropApplied ? cropRectForRequest(state.crop) : undefined, normalizeImageTransform(state.imageTransform));
    if (
      selectedFile?.result?.calibrated_image
      && selectedFile.calibrationSignature === signature
      && hasAnalysisCharts(selectedFile.result.charts)
    ) {
      pendingCommitRef.current = null;
      void persistCommittedEdit(description, actionType, state, selectedFile.result.calibrated_image);
    }
  }

  function setModeCommitted(value: string) {
    beginEdit();
    setMode(value);
    commitEdit(`模式 ${value}`, "mode", currentEditState({ mode: value }));
  }

  function setNegativeBaseCommitted(value: boolean) {
    beginEdit();
    setNegativeBaseEnabled(value);
    commitEdit(value ? "启用负片基础" : "关闭负片基础", "negative-base", currentEditState({ negativeBaseEnabled: value }));
  }

  function commitStrength(value: number) {
    commitEdit("强度调整", "strength", currentEditState({ strength: value }));
  }

  function previewLookAdjustments(next: LookAdjustments) {
    const normalized = cloneLookAdjustments(next);
    setLookAdjustments(normalized);
    if (selectedFile) {
      fileLookRef.current.set(selectedFile.id, normalized);
    }
  }

  function commitLookAdjustments(next: LookAdjustments, description = "片色调整") {
    const normalized = cloneLookAdjustments(next);
    previewLookAdjustments(normalized);
    commitEdit(description, "look", currentEditState({ lookAdjustments: normalized }));
  }

  function resetLookAdjustments() {
    beginEdit();
    commitLookAdjustments(cloneLookAdjustments(DEFAULT_LOOK_ADJUSTMENTS), "重置片色");
  }
  const displayedSelectedFile = selectedFile;
  const selectionDisplayReady = true;
  const filteredFiles = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    return files.filter((item) => {
      if (sourceFilter !== "all" && item.kind !== sourceFilter) return false;
      if (!needle) return true;
      return item.name.toLowerCase().includes(needle);
    });
  }, [files, searchQuery, sourceFilter]);
  const fileCounts = useMemo(
    () => ({
      all: files.length,
      file: files.filter((item) => item.kind === "file").length,
      session: files.filter((item) => item.kind === "session").length,
    }),
    [files],
  );
  const layoutState = useMemo(
    () => ({
      viewerFocusMode,
      showAnalysisPane: preferences.showAnalysisPane && !viewerFocusMode,
      showInspectorPane: preferences.showInspectorPane && !viewerFocusMode,
      showFilmstrip: preferences.showFilmstrip && !viewerFocusMode,
      showViewerHud: preferences.showViewerHud && !viewerFocusMode,
    }),
    [preferences, viewerFocusMode],
  );
  const compareMode = viewerState.compareMode;
  const splitPosition = viewerState.splitPosition;
  const viewerZoomMode = viewerState.zoomMode;
  const viewerZoomScale = viewerState.zoomScale;
  const viewerPan = viewerState.pan;

  const setStageContainerSize = useCallback((size: { width: number; height: number }) => {
    setStageContainerSizeState((current) =>
      current?.width === size.width && current.height === size.height ? current : size,
    );
  }, []);

  function notify(tone: NotificationItem["tone"], title: string, message: string) {
    const id = `${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    const item = { id, tone, title, message };
    setNotifications((current) => [...current, item].slice(-6));
    setActivityLog((current) => [item, ...current].slice(0, 24));
    window.setTimeout(() => {
      setNotifications((current) => current.filter((item) => item.id !== id));
    }, 4200);
  }

  function setActionState<K extends keyof typeof actionStates>(key: K, status: ActionState["status"], detail?: string) {
    setActionStates((current) => ({
      ...current,
      [key]: { status, detail },
    }));
  }

  function setActiveInspectorTab(tab: InspectorTab) {
    setActiveInspectorTabState(tab);
  }

  function stateForFileExport(item: WorkspaceFile): PersistedEditState {
    if (selectedFile?.id === item.id) {
      return currentEditState({ runtimeSessionId: item.sessionId });
    }
    if (item.persistedState) {
      return item.persistedState;
    }
    const curves = cloneManualCurves(fileCurvesRef.current.get(item.id) ?? {
      l: item.lCurve ?? DEFAULT_IDENTITY_CURVE,
      r: item.rCurve ?? DEFAULT_IDENTITY_CURVE,
      g: item.gCurve ?? DEFAULT_IDENTITY_CURVE,
      b: item.bCurve ?? DEFAULT_IDENTITY_CURVE,
    });
    const itemLook = fileLookRef.current.get(item.id) ?? cloneLookAdjustments(DEFAULT_LOOK_ADJUSTMENTS);
    return buildDefaultExportState(item, accelerator, curves, itemLook);
  }

  function updateViewerState(patch: Partial<ViewerWorkspaceState>) {
    setViewerState((current) => ({
      ...current,
      ...patch,
    }));
  }

  const resolveCurvePreviewSource = useCallback((targetFile: WorkspaceFile | undefined) => (
    targetFile?.result?.calibrated_image
      ?? targetFile?.highResPreview?.original_preview
      ?? targetFile?.preview?.original_preview
      ?? targetFile?.displayUrl
  ), []);

  const resolveCurvePreviewTargetSide = useCallback(() => {
    return CURVE_PREVIEW_INTERACTIVE_SIDE;
  }, []);

  const resolveCurvePreviewCacheKey = useCallback((targetFile: WorkspaceFile | undefined) => {
    const sourceUrl = resolveCurvePreviewSource(targetFile);
    if (!targetFile || !sourceUrl) return null;
    return `${targetFile.id}:${sourceUrl}:${resolveCurvePreviewTargetSide()}`;
  }, [resolveCurvePreviewSource, resolveCurvePreviewTargetSide]);

  const buildCurvePreviewHistogram = useCallback((rgba: Uint8ClampedArray): HistogramPayload => {
    const countsR = new Array<number>(256).fill(0);
    const countsG = new Array<number>(256).fill(0);
    const countsB = new Array<number>(256).fill(0);
    const pixels = Math.max(1, rgba.length / 4);

    for (let index = 0; index < rgba.length; index += 4) {
      countsR[rgba[index]!] += 1;
      countsG[rgba[index + 1]!] += 1;
      countsB[rgba[index + 2]!] += 1;
    }

    const toChannel = (counts: number[]) => {
      let peakBin = 0;
      let peakCount = counts[0] ?? 0;
      for (let index = 1; index < counts.length; index += 1) {
        if ((counts[index] ?? 0) > peakCount) {
          peakCount = counts[index]!;
          peakBin = index;
        }
      }
      return {
        counts,
        normalized: counts.map((value) => value / pixels),
        peak_bin: peakBin,
      };
    };

    return {
      bins: 256,
      channels: {
        r: toChannel(countsR),
        g: toChannel(countsG),
        b: toChannel(countsB),
      },
    };
  }, []);

  const disposeCurvePreviewBitmap = useCallback((bitmap: ImageBitmap | null) => {
    if (!bitmap) return;
    // Canvas layers may still draw the previous bitmap for a few frames during
    // curve drags. Closing it aggressively can throw and blank the React tree.
    if (typeof window === "undefined") return;
    window.setTimeout(() => bitmap.close(), 3000);
  }, []);

  const clearLocalCurvePreview = useCallback(() => {
    debugLog("curve.preview.clear");
    if (curvePreviewFrameRef.current) {
      window.cancelAnimationFrame(curvePreviewFrameRef.current);
      curvePreviewFrameRef.current = null;
    }
    if (curvePreviewRenderTimerRef.current) {
      clearTimeout(curvePreviewRenderTimerRef.current);
      curvePreviewRenderTimerRef.current = null;
    }
    curvePreviewSequenceRef.current += 1;
    curvePreviewCacheKeyRef.current = null;
    curvePreviewFallbackCacheRef.current = null;
    const previousBitmap = curvePreviewBitmapRef.current;
    curvePreviewBitmapRef.current = null;
    setLocalCurvePreviewBitmap(null);
    setLocalCurvePreviewHistogram(null);
    disposeCurvePreviewBitmap(previousBitmap);
  }, [disposeCurvePreviewBitmap]);

  const settleLocalCurvePreview = useCallback(() => {
    if (curveInteractionRef.current === "drag") {
      return;
    }
    const previousBitmap = curvePreviewBitmapRef.current;
    curvePreviewBitmapRef.current = null;
    setLocalCurvePreviewBitmap(null);
    setLocalCurvePreviewHistogram(null);
    disposeCurvePreviewBitmap(previousBitmap);
  }, [disposeCurvePreviewBitmap]);

  const prepareCurvePreviewFallbackCache = useCallback(async (targetFile: WorkspaceFile): Promise<CurvePreviewFallbackCache | null> => {
    const sourceUrl = resolveCurvePreviewSource(targetFile);
    const cacheKey = resolveCurvePreviewCacheKey(targetFile);
    if (!sourceUrl || !cacheKey || typeof window === "undefined") return null;
    const existing = curvePreviewFallbackCacheRef.current;
    if (existing?.key === cacheKey) return existing;

    debugLog("curve.preview.cache.prepare", { fileId: targetFile.id, cacheKey });
    const response = await fetch(sourceUrl);
    if (!response.ok) {
      throw new Error(`Curve preview source failed: ${response.status}`);
    }
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    try {
      const scale = Math.min(1, resolveCurvePreviewTargetSide() / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) {
        throw new Error("Curve preview fallback canvas context is unavailable");
      }
      context.drawImage(bitmap, 0, 0, width, height);
      const imageData = context.getImageData(0, 0, width, height);
      const cached = {
        key: cacheKey,
        width,
        height,
        data: new Uint8ClampedArray(imageData.data),
      };
      curvePreviewFallbackCacheRef.current = cached;
      return cached;
    } finally {
      bitmap.close();
    }
  }, [resolveCurvePreviewCacheKey, resolveCurvePreviewSource, resolveCurvePreviewTargetSide]);

  const renderLocalCurvePreviewFallback = useCallback(async (targetFile: WorkspaceFile, nextCurves: ManualCurves) => {
    const cached = await prepareCurvePreviewFallbackCache(targetFile);
    if (!cached || typeof window === "undefined") return;
    const effectiveCurves = composeManualCurves(nextCurves);
    debugLog("curve.preview.fallback.start", { fileId: targetFile.id, cacheKey: cached.key });

    const lutR = buildCurveLut(effectiveCurves.r);
    const lutG = buildCurveLut(effectiveCurves.g);
    const lutB = buildCurveLut(effectiveCurves.b);
    const rgba = new Uint8ClampedArray(cached.data);
    for (let index = 0; index < rgba.length; index += 4) {
      rgba[index] = lutR[rgba[index]!];
      rgba[index + 1] = lutG[rgba[index + 1]!];
      rgba[index + 2] = lutB[rgba[index + 2]!];
    }
    const canvas = document.createElement("canvas");
    canvas.width = cached.width;
    canvas.height = cached.height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Curve preview fallback output context is unavailable");
    }
    context.putImageData(new ImageData(rgba, cached.width, cached.height), 0, 0);
    const bitmap = await createImageBitmap(canvas);
    const previousBitmap = curvePreviewBitmapRef.current;
    curvePreviewBitmapRef.current = bitmap;
    setLocalCurvePreviewBitmap(bitmap);
    setLocalCurvePreviewHistogram(buildCurvePreviewHistogram(rgba));
    disposeCurvePreviewBitmap(previousBitmap);
    debugLog("curve.preview.fallback.done", { fileId: targetFile.id, cacheKey: cached.key });
  }, [buildCurvePreviewHistogram, disposeCurvePreviewBitmap, prepareCurvePreviewFallbackCache]);

  const prewarmLocalCurvePreview = useCallback((targetFile: WorkspaceFile | undefined) => {
    if (!targetFile) return;
    void prepareCurvePreviewFallbackCache(targetFile).catch((error) => {
      console.warn("[curve-preview] prewarm failed:", error);
    });
  }, [prepareCurvePreviewFallbackCache]);

  const renderLocalCurvePreview = useCallback((targetFile: WorkspaceFile, nextCurves: ManualCurves) => {
    const sourceUrl = resolveCurvePreviewSource(targetFile);
    const cacheKey = resolveCurvePreviewCacheKey(targetFile);
    if (!sourceUrl || !cacheKey) return;
    void renderLocalCurvePreviewFallback(targetFile, nextCurves).catch((error) => {
      console.warn("[curve-preview] fallback failed:", error);
    });
  }, [renderLocalCurvePreviewFallback, resolveCurvePreviewCacheKey, resolveCurvePreviewSource]);

  const scheduleLocalCurvePreview = useCallback((targetFile: WorkspaceFile | undefined, nextCurves: ManualCurves, interaction: CurveInteraction) => {
    if (!targetFile) return;
    debugLog("curve.preview.schedule", { fileId: targetFile.id, interaction });

    const schedule = () => {
      const renderSeq = ++curvePreviewSequenceRef.current;
      if (curvePreviewFrameRef.current) {
        window.cancelAnimationFrame(curvePreviewFrameRef.current);
      }
      curvePreviewFrameRef.current = window.requestAnimationFrame(() => {
        curvePreviewFrameRef.current = null;
        if (renderSeq !== curvePreviewSequenceRef.current) return;
        renderLocalCurvePreview(targetFile, nextCurves);
      });
    };

    if (interaction === "drag") {
      const intervalMs = Math.round(1000 / CURVE_PREVIEW_DRAG_FPS);
      const elapsed = performance.now() - curvePreviewLastDragMsRef.current;
      if (elapsed >= intervalMs) {
        curvePreviewLastDragMsRef.current = performance.now();
        schedule();
        return;
      }
      if (curvePreviewRenderTimerRef.current) {
        clearTimeout(curvePreviewRenderTimerRef.current);
      }
      curvePreviewRenderTimerRef.current = setTimeout(() => {
        curvePreviewRenderTimerRef.current = null;
        curvePreviewLastDragMsRef.current = performance.now();
        schedule();
      }, intervalMs - elapsed);
      return;
    }

    if (curvePreviewRenderTimerRef.current) {
      clearTimeout(curvePreviewRenderTimerRef.current);
      curvePreviewRenderTimerRef.current = null;
    }
    schedule();
  }, [renderLocalCurvePreview]);

  useEffect(() => {
    fetchHealth()
      .then((payload) => setBackendOk(Boolean(payload.ok)))
      .catch(() => setBackendOk(false));
    fetchPlugins()
      .then((payload) => setPlugins(payload.plugins))
      .catch(() => setPlugins([]));
    fetchAIEvaluators()
      .then((payload) => {
        setEvaluators(payload.evaluators);
        if (payload.evaluators.length && !payload.evaluators.some((item) => item.id === selectedEvaluator)) {
          setSelectedEvaluator(payload.evaluators[0]!.id);
        }
      })
      .catch(() => setEvaluators([]));
    void refreshSavedSessions();
  }, []);

  useEffect(() => {
    fetchCapabilities(accelerator)
      .then((payload) => setCapabilities(payload))
      .catch(() => setCapabilities(null));
  }, [accelerator]);

  useEffect(() => {
    window.localStorage.setItem(WORKBENCH_PREFERENCES_KEY, JSON.stringify(preferences));
  }, [preferences]);

  useEffect(() => {
    window.localStorage.setItem(WORKBENCH_INSPECTOR_TAB_KEY, JSON.stringify(activeInspectorTab));
  }, [activeInspectorTab]);

  const viewerStateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (viewerStateTimerRef.current) {
      clearTimeout(viewerStateTimerRef.current);
    }
    viewerStateTimerRef.current = setTimeout(() => {
      window.localStorage.setItem(WORKBENCH_VIEWER_STATE_KEY, JSON.stringify(viewerState));
    }, 500);
    return () => {
      if (viewerStateTimerRef.current) {
        clearTimeout(viewerStateTimerRef.current);
      }
    };
  }, [viewerState]);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    historyIndexRef.current = historyIndex;
  }, [historyIndex]);

  useEffect(() => {
    curveInteractionRef.current = curveInteraction;
  }, [curveInteraction]);

  /* ── Load config from backend on mount ── */
  useEffect(() => {
    fetchConfig()
      .then((config) => {
        if (config.ai) setAISettings((prev) => ({ ...prev, ...config.ai }));
        if (config.preferences) setPreferences((prev) => ({ ...prev, ...config.preferences }));
        if (config.viewer_state) setViewerState((prev) => ({ ...prev, ...config.viewer_state }));
        if (config.inspector_tab) setActiveInspectorTab(config.inspector_tab);
      })
      .catch(() => {});
  }, []);

  /* ── Save config to backend (debounced) ── */
  const configTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (configTimerRef.current) clearTimeout(configTimerRef.current);
    configTimerRef.current = setTimeout(() => {
      putConfig({
        ai: aiSettings,
        preferences,
        viewer_state: viewerState,
        inspector_tab: activeInspectorTab,
      }).catch(() => {});
    }, 2000);
    return () => {
      if (configTimerRef.current) clearTimeout(configTimerRef.current);
    };
  }, [aiSettings, preferences, viewerState, activeInspectorTab]);

  function applyPersistedState(state: PersistedEditState, calibratedImage?: string) {
    undoingRef.current = true;
    setMode(state.mode);
    setNegativeBaseEnabled(Boolean(state.negativeBaseEnabled));
    setStrength(state.strength);
    setAccelerator(state.accelerator);
    const nextLook = cloneLookAdjustments(state.lookAdjustments);
    setLookAdjustments(nextLook);
    const curves = cloneManualCurves(state.curves);
    setLCurve(curves.l);
    setRCurve(curves.r);
    setGCurve(curves.g);
    setBCurve(curves.b);
    setCommittedCurves(curves);
    if (selectedFile) {
      if (state.cropApplied) appliedCropIdsRef.current.add(selectedFile.id);
      else appliedCropIdsRef.current.delete(selectedFile.id);
      fileCurvesRef.current.set(selectedFile.id, curves);
      fileLookRef.current.set(selectedFile.id, nextLook);
      setFiles((items) => items.map((item) => item.id === selectedFile.id ? {
        ...item,
        sessionId: item.sessionId,
        crop: state.crop,
        cropEdited: state.cropEdited,
        cropApplied: state.cropApplied,
        persistedState: state,
        imageTransform: normalizeImageTransform(state.imageTransform),
        calibrationSignature: calibratedImage ? buildCalibrationSignature(state.mode, state.strength, Boolean(state.negativeBaseEnabled), state.accelerator, curves, cloneLookAdjustments(state.lookAdjustments), state.cropApplied ? cropRectForRequest(state.crop) : undefined, normalizeImageTransform(state.imageTransform)) : undefined,
        result: calibratedImage && item.result ? { ...item.result, calibrated_image: calibratedImage } : item.result,
      } : item));
    }
    queueMicrotask(() => { undoingRef.current = false; });
  }

  async function movePersistentHistory(direction: "undo" | "redo") {
    if (!selectedFile?.workspaceRoot || !selectedFile.persistentSessionId) return false;
    const response = await postHistoryMove(direction, {
      workspace_root: selectedFile.workspaceRoot,
      persistent_session_id: selectedFile.persistentSessionId,
    });
    if (!response.ok || !response.state) return true;
    applyPersistedState(response.state, response.calibrated_image);
    const nextHistory = historyFromApi(response.history ?? []);
    setHistory(nextHistory);
    setHistoryIndex(response.history_cursor ?? -1);
    setFiles((items) => items.map((item) => item.id === selectedFile.id ? {
      ...item,
      persistedHistory: nextHistory,
      persistedHistoryIndex: response.history_cursor ?? -1,
    } : item));
    return true;
  }

  async function undo() {
    if (await movePersistentHistory("undo")) return;
    const stack = undoStackRef.current;
    const idx = undoIndexRef.current;
    if (idx <= 0) return;
    undoingRef.current = true;
    undoIndexRef.current = idx - 1;
    const snap = stack[idx - 1];
    setMode(snap.mode);
    setNegativeBaseEnabled(snap.negativeBaseEnabled);
    setStrength(snap.strength);
    setAccelerator(snap.accelerator);
    const snapLook = cloneLookAdjustments(snap.lookAdjustments);
    setLookAdjustments(snapLook);
    if (selectedFile) fileLookRef.current.set(selectedFile.id, snapLook);
    setLCurve(snap.lCurve.map((p) => [...p] as [number, number]));
    setRCurve(snap.rCurve.map((p) => [...p] as [number, number]));
    setGCurve(snap.gCurve.map((p) => [...p] as [number, number]));
    setBCurve(snap.bCurve.map((p) => [...p] as [number, number]));
    setCommittedCurves({
      l: snap.lCurve.map((p) => [...p] as [number, number]),
      r: snap.rCurve.map((p) => [...p] as [number, number]),
      g: snap.gCurve.map((p) => [...p] as [number, number]),
      b: snap.bCurve.map((p) => [...p] as [number, number]),
    });
    undoingRef.current = false;
  }

  async function redo() {
    if (await movePersistentHistory("redo")) return;
    const stack = undoStackRef.current;
    const idx = undoIndexRef.current;
    if (idx >= stack.length - 1) return;
    undoingRef.current = true;
    undoIndexRef.current = idx + 1;
    const snap = stack[idx + 1];
    setMode(snap.mode);
    setNegativeBaseEnabled(snap.negativeBaseEnabled);
    setStrength(snap.strength);
    setAccelerator(snap.accelerator);
    const snapLook = cloneLookAdjustments(snap.lookAdjustments);
    setLookAdjustments(snapLook);
    if (selectedFile) fileLookRef.current.set(selectedFile.id, snapLook);
    setLCurve(snap.lCurve.map((p) => [...p] as [number, number]));
    setRCurve(snap.rCurve.map((p) => [...p] as [number, number]));
    setGCurve(snap.gCurve.map((p) => [...p] as [number, number]));
    setBCurve(snap.bCurve.map((p) => [...p] as [number, number]));
    setCommittedCurves({
      l: snap.lCurve.map((p) => [...p] as [number, number]),
      r: snap.rCurve.map((p) => [...p] as [number, number]),
      g: snap.gCurve.map((p) => [...p] as [number, number]),
      b: snap.bCurve.map((p) => [...p] as [number, number]),
    });
    undoingRef.current = false;
  }

  useEffect(() => {
    if (!selectedFile) return;
    if (curveStateFileId !== selectedFile.id) return;
    if (curveInteraction === "drag") {
      debugLog("calib.skip.drag", { fileId: selectedFile.id });
      return;
    }
    const manualCurves = committedCurves;
    const effectiveCurves = composeManualCurves(manualCurves);
    const lookPayload = lookPayloadForRequest(lookAdjustments);
    const lookSignature = serializeLookAdjustments(lookAdjustments);
    const cropRect = isCropApplied(selectedFile) ? cropRectForRequest(selectedFile.crop) : undefined;
    const imageTransform = normalizeImageTransform(selectedFile.imageTransform);
    const requestImageTransform = imageTransformForRequest(imageTransform);
    const signature = buildCalibrationSignature(mode, strength, negativeBaseEnabled, accelerator, manualCurves, lookAdjustments, cropRect, imageTransform);
    if (
      selectedFile.result?.calibrated_image
      && selectedFile.calibrationSignature === signature
      && hasAnalysisCharts(selectedFile.result.charts)
    ) {
      return;
    }
    const depth = ++calibrationDepthRef.current;
    if (depth > 3) {
      console.error("[Calibration] recursion guard triggered at depth", depth, "- aborting");
      calibrationDepthRef.current = Math.max(0, calibrationDepthRef.current - 1);
      return;
    }
    const prev = prevDepsRef.current;
    const fileChanged = prev.id !== selectedFile?.id;
    const modeChanged = prev.mode !== mode;
    const negativeBaseChanged = prev.negativeBaseEnabled !== negativeBaseEnabled;
    const lookChanged = prev.lookSignature !== lookSignature;
    const lookOnlyChanged = lookChanged && !fileChanged && !modeChanged && !negativeBaseChanged && prev.strength === strength;
    const fileOrParamsChanged = fileChanged || modeChanged || negativeBaseChanged || lookChanged || prev.strength !== strength;
    prevDepsRef.current = { id: selectedFile?.id, mode, negativeBaseEnabled, strength, lookSignature };
    debugLog("calib.effect", { fileId: selectedFile?.id?.substring(0, 20), fileChanged: fileOrParamsChanged, mode, strength });
    const fastMode = Boolean(
      selectedFile.sessionId
      && selectedFile.result?.calibrated_image
      && !fileChanged
      && !modeChanged
      && !negativeBaseChanged
      && hasAnalysisCharts(selectedFile.result.charts),
    );
    const debounceMs = fastMode ? 0 : 160;
    if (fastMode) perfMark(`effect.fire(debounce=${debounceMs}ms)`);
    const currentRequest = ++requestRef.current;
    const run = async () => {
      perfMark("run.start");
      if (fileOrParamsChanged && !lookOnlyChanged) setLoading(true);
      setActionState("calibration", "running", selectedFile.name);
      try {
        let payload: CalibrationPayload;
        const curvePayload = { r_curve: effectiveCurves.r, g_curve: effectiveCurves.g, b_curve: effectiveCurves.b };
        perfMark("api.start");
        if (selectedFile.sessionId) {
          payload = await postCalibrationSession({
            session_id: selectedFile.sessionId,
            mode,
            strength,
            negative_base: negativeBaseEnabled,
            look: lookPayload,
            accelerator,
            include_original: Boolean(cropRect),
            fast: fastMode,
            crop_rect: cropRect,
            image_transform: requestImageTransform,
            ...curvePayload,
          });
        } else {
          if (!selectedFile.file) return;
          const filePath = (selectedFile.file as any)?.path as string | undefined;
          const body: Record<string, unknown> = {
            file_name: selectedFile.name,
            mode,
            strength,
            negative_base: negativeBaseEnabled,
            look: lookPayload,
            accelerator,
            fast: fastMode,
            crop_rect: cropRect,
            image_transform: requestImageTransform,
            ...curvePayload,
          };
          if (filePath) {
            body.path = filePath;
          } else {
            body.image_data = await fileToDataUrl(selectedFile.file as File);
          }
          payload = await postCalibration(body);
          }
         perfMark("api.done");
        if (currentRequest !== requestRef.current) return;
        const backendTiming = (payload as any)?._timing;
        if (backendTiming) perfMark(`backend(calib=${backendTiming.calibration_ms}ms resp=${backendTiming.response_ms}ms)`);
        debugLog("calib.setFiles", { fast: fastMode, calibOk: !!payload.calibrated_image });
        setFiles((items) =>
          items.map((item) =>
            item.id === selectedFile.id
              ? {
                  ...item,
                  cropApplied: Boolean(payload.processing?.crop_applied) || item.cropApplied,
                  calibrationSignature: signature,
                  sessionId: payload.session_id ?? item.sessionId,
                  result: {
                    ...payload,
                    charts: fastMode && Object.keys(payload.charts ?? {}).length === 0
                      ? item.result?.charts ?? {}
                      : payload.charts ?? {},
                  },
                }
              : item,
          ),
        );
        setDocumentRender(null);
        setAiResult(null);
        perfMark("setFiles.done");
        if (fastMode && highResSessionRef.current) {
          if (curveSettleTimerRef.current) clearTimeout(curveSettleTimerRef.current);
          curveSettleTimerRef.current = setTimeout(async () => {
            const sid = highResSessionRef.current;
            if (!sid) return;
            try {
              const cal = await postCalibrationSession({
                session_id: sid, mode, strength, negative_base: negativeBaseEnabled, look: lookPayload, accelerator,
                include_original: Boolean(cropRect),
                crop_rect: cropRect,
                image_transform: requestImageTransform,
                r_curve: effectiveCurves.r, g_curve: effectiveCurves.g, b_curve: effectiveCurves.b,
              });
              setFiles((items) => items.map((item) =>
                item.id === selectedFile.id ? { ...item, calibrationSignature: signature, result: cal } : item
              ));
            } catch {}
          }, 600);
        }
        setCurveInteraction("idle");
        setActionState("calibration", "success", payload.session_id ?? selectedFile.name);
        const pendingCommit = pendingCommitRef.current;
        if (pendingCommit) {
          pendingCommitRef.current = null;
          void persistCommittedEdit(
            pendingCommit.description,
            pendingCommit.actionType,
            { ...pendingCommit.state, runtimeSessionId: payload.session_id ?? pendingCommit.state.runtimeSessionId },
            payload.calibrated_image,
          );
        }
        requestAnimationFrame(() => {
          perfMark("DOM.rendered");
          perfDump();
        });
      } catch (error) {
        if (currentRequest === requestRef.current) {
          console.error(error);
          setActionState("calibration", "error", String(error));
          notify("error", "Calibration failed", String(error));
        }
      } finally {
        if (fileOrParamsChanged && !lookOnlyChanged) setLoading(false);
      }
    };
    const timer = window.setTimeout(run, debounceMs);
    return () => {
      window.clearTimeout(timer);
      calibrationDepthRef.current = Math.max(0, calibrationDepthRef.current - 1);
      if (fileOrParamsChanged && !lookOnlyChanged) setLoading(false);
    };
  }, [
    selectedFile?.id,
    selectedFile?.crop?.crop_rect.left,
    selectedFile?.crop?.crop_rect.top,
    selectedFile?.crop?.crop_rect.width,
    selectedFile?.crop?.crop_rect.height,
    selectedFile?.cropApplied,
    selectedFile?.imageTransform?.rotation,
    selectedFile?.imageTransform?.flipH,
    selectedFile?.imageTransform?.flipV,
    curveStateFileId,
    mode,
    negativeBaseEnabled,
    strength,
    lookAdjustments,
    accelerator,
    committedCurves,
    curveInteraction,
  ]);

  /* push calibration snapshots to undo stack (debounced 600ms) */
  useEffect(() => {
    if (undoingRef.current) return;
    const prevTimer = pushTimerRef.current;
    if (prevTimer) clearTimeout(prevTimer);
    pushTimerRef.current = setTimeout(() => {
      const snap: UndoSnapshot = { mode, strength, negativeBaseEnabled, accelerator, lCurve, rCurve, gCurve, bCurve, lookAdjustments: cloneLookAdjustments(lookAdjustments) };
      const stack = undoStackRef.current;
      const idx = undoIndexRef.current;
      const last = stack[idx];
      if (
        last
        && last.mode === snap.mode
        && last.negativeBaseEnabled === snap.negativeBaseEnabled
        && last.strength === snap.strength
        && last.accelerator === snap.accelerator
        && serializeLookAdjustments(last.lookAdjustments) === serializeLookAdjustments(snap.lookAdjustments)
      ) return;
      undoStackRef.current = stack.slice(0, idx + 1);
      undoStackRef.current.push(snap);
      if (undoStackRef.current.length > 50) {
        undoStackRef.current.shift();
      }
      undoIndexRef.current = undoStackRef.current.length - 1;
    }, 600);
    return () => { const t = pushTimerRef.current; if (t) clearTimeout(t); };
  }, [mode, negativeBaseEnabled, strength, accelerator, lCurve, rCurve, gCurve, bCurve, lookAdjustments]);

  useEffect(() => {
    setCurveStateFileId(undefined);
    if (!selectedFile) return;
    clearLocalCurvePreview();
    setCurveInteraction("idle");
    updateViewerState({ pan: { x: 0, y: 0 } });
    setExportOptions((current) => ({
      ...current,
      outputPath: suggestExportPath(selectedFile.name, current.format),
    }));
    setSessionOptions({
      savePath: suggestSessionPath(selectedFile.name),
    });
    setExportResult(null);
    setSessionSaveResult(null);
    setDocumentRender(null);
    const restoredState = selectedFile.persistedState;
    if (restoredState) {
      setMode(restoredState.mode);
      setNegativeBaseEnabled(Boolean(restoredState.negativeBaseEnabled));
      setStrength(restoredState.strength);
      setAccelerator(restoredState.accelerator);
      setLookAdjustments(cloneLookAdjustments(restoredState.lookAdjustments));
    }
    const savedLook = fileLookRef.current.get(selectedFile.id);
    const nextLook = cloneLookAdjustments(savedLook ?? restoredState?.lookAdjustments);
    setLookAdjustments(nextLook);
    fileLookRef.current.set(selectedFile.id, nextLook);
    const saved = fileCurvesRef.current.get(selectedFile.id);
    const nextCurves = cloneManualCurves(saved ?? {
      l: restoredState?.curves.l ?? selectedFile.lCurve ?? DEFAULT_IDENTITY_CURVE,
      r: restoredState?.curves.r ?? selectedFile.rCurve ?? DEFAULT_IDENTITY_CURVE,
      g: restoredState?.curves.g ?? selectedFile.gCurve ?? DEFAULT_IDENTITY_CURVE,
      b: restoredState?.curves.b ?? selectedFile.bCurve ?? DEFAULT_IDENTITY_CURVE,
    });
    setLCurve(nextCurves.l);
    setRCurve(nextCurves.r);
    setGCurve(nextCurves.g);
    setBCurve(nextCurves.b);
    setCommittedCurves(nextCurves);
    setHistory(selectedFile.persistedHistory ?? []);
    setHistoryIndex(selectedFile.persistedHistoryIndex ?? -1);
    setCurveStateFileId(selectedFile.id);
  }, [selectedFile?.id, clearLocalCurvePreview]);

  useEffect(() => {
    if (!selectedFile) return;
    prewarmLocalCurvePreview(selectedFile);
  }, [
    selectedFile?.id,
    selectedFile?.highResPreview?.original_preview,
    selectedFile?.preview?.original_preview,
    selectedFile?.result?.calibrated_image,
    selectedFile?.displayUrl,
    stageContainerSize?.width,
    stageContainerSize?.height,
    prewarmLocalCurvePreview,
  ]);

  useEffect(() => {
    if (curveInteraction !== "drag" || !selectedFile || localCurvePreviewBitmap) return;
    const latest = filesRef.current.find((item) => item.id === selectedFile.id) ?? selectedFile;
    if (!resolveCurvePreviewSource(latest)) return;
    scheduleLocalCurvePreview(latest, { l: lCurve, r: rCurve, g: gCurve, b: bCurve }, "drag");
  }, [
    curveInteraction,
    localCurvePreviewBitmap,
    selectedFile?.id,
    selectedFile?.highResPreview?.original_preview,
    selectedFile?.preview?.original_preview,
    selectedFile?.result?.calibrated_image,
    selectedFile?.displayUrl,
    lCurve,
    rCurve,
    gCurve,
    bCurve,
    resolveCurvePreviewSource,
    scheduleLocalCurvePreview,
  ]);

  useEffect(() => {
    if (!selectedFile) return;
    setExportOptions((current) => ({
      ...current,
      outputPath: suggestExportPath(selectedFile.name, current.format),
    }));
  }, [exportOptions.format, selectedFile?.id]);

  useEffect(() => () => {
    clearLocalCurvePreview();
  }, [clearLocalCurvePreview]);

  /* ── Adaptive resolution: reset tracking when file changes ── */
  useEffect(() => {
    const existingMaxSide = resolvePreviewMaxSide(selectedFile?.highResPreview)
      ?? resolvePreviewMaxSide(selectedFile?.preview)
      ?? 320;
    currentResMaxSideRef.current = existingMaxSide;
    highResSessionRef.current = selectedFile?.highResPreview?.session_id ?? selectedFile?.sessionId ?? null;
    highResRequestRef.current++;
    if (highResTimerRef.current) {
      clearTimeout(highResTimerRef.current);
      highResTimerRef.current = null;
    }
  }, [selectedFile?.id]);

  /* ── Adaptive resolution: request higher-res preview on zoom / resize ── */
  useEffect(() => {
    if (!selectedFile?.sessionId) return;
    if (!selectedFile?.preview) return;
    if (!stageContainerSize) return;
    if (selectedFile?.browserDisplayable) return;

    const containerWidth = stageContainerSize.width;
    const containerHeight = stageContainerSize.height;
    const dpr = window.devicePixelRatio || 1;

    let requiredMaxSide = Math.max(containerWidth, containerHeight) * viewerZoomScale * dpr;
    requiredMaxSide = Math.max(320, Math.min(1600, Math.round(requiredMaxSide)));

    const currentMaxSide = currentResMaxSideRef.current;
    const diff = Math.abs(requiredMaxSide - currentMaxSide) / currentMaxSide;
    if (diff <= 0.25) return;

    if (highResTimerRef.current) {
      clearTimeout(highResTimerRef.current);
    }

    const requestId = ++highResRequestRef.current;
    const capturedFileId = selectedFile.id;

    highResTimerRef.current = setTimeout(async () => {
      perfMark("adaptive.start");
      setHighResLoading(true);
      try {
        const effectiveCurves = composeManualCurves(committedCurves);
        const lookPayload = lookPayloadForRequest(lookAdjustments);
        const preview = await postPreview({
          session_id: selectedFile.sessionId,
          analysis_max_side: requiredMaxSide,
        });
        if (requestId !== highResRequestRef.current) return;
        currentResMaxSideRef.current = requiredMaxSide;

        setFiles((items) =>
          items.map((item) =>
            item.id === capturedFileId
              ? { ...item, highResPreview: preview }
              : item,
          ),
        );

        const highResSessionId = preview.session_id;
        highResSessionRef.current = highResSessionId;
        const calibration = await postCalibrationSession({
          session_id: highResSessionId,
          mode,
          strength,
          negative_base: negativeBaseEnabled,
          look: lookPayload,
          accelerator,
          include_original: true,
          fast: true,
          crop_rect: isCropApplied(selectedFile) ? cropRectForRequest(selectedFile.crop) : undefined,
          image_transform: imageTransformForRequest(selectedFile.imageTransform),
          r_curve: effectiveCurves.r,
          g_curve: effectiveCurves.g,
          b_curve: effectiveCurves.b,
        });
        if (requestId !== highResRequestRef.current) return;
        setFiles((items) =>
          items.map((item) =>
            item.id === capturedFileId
              ? {
                  ...item,
                  cropApplied: Boolean(calibration.processing?.crop_applied) || item.cropApplied,
                  result: {
                    ...calibration,
                    charts: Object.keys(calibration.charts ?? {}).length === 0
                      ? item.result?.charts ?? {}
                      : calibration.charts,
                  },
                }
              : item,
          ),
        );
      } catch (err) {
        console.warn("High-res preview request failed:", err);
      } finally {
        if (requestId === highResRequestRef.current) setHighResLoading(false);
      }
    }, 300);

    return () => {
      if (highResTimerRef.current) {
        clearTimeout(highResTimerRef.current);
        highResTimerRef.current = null;
      }
    };
  }, [
    stageContainerSize,
    viewerZoomScale,
    viewerZoomMode,
    selectedFile?.id,
    selectedFile?.sessionId,
    selectedFile?.cropApplied,
    selectedFile?.crop?.crop_rect.left,
    selectedFile?.crop?.crop_rect.top,
    selectedFile?.crop?.crop_rect.width,
    selectedFile?.crop?.crop_rect.height,
    selectedFile?.imageTransform?.rotation,
    selectedFile?.imageTransform?.flipH,
    selectedFile?.imageTransform?.flipV,
    curveStateFileId,
    mode,
    strength,
    lookAdjustments,
    accelerator,
    committedCurves,
  ]);

  async function hydrateNonDisplayablePreviews(nextFiles: WorkspaceFile[]) {
    const toProcess = nextFiles.filter((item) => item.file && !item.browserDisplayable && !item.preview);
    if (toProcess.length === 0) return;

    const selectedIdx = toProcess.findIndex((f) => f.id === selectedId);
    if (selectedIdx > 0) {
      const [selected] = toProcess.splice(selectedIdx, 1);
      toProcess.unshift(selected);
    }

    setFiles((existing) =>
      existing.map((entry) => {
        if (toProcess.some((p) => p.id === entry.id)) {
          return { ...entry, thumbnailLoading: true };
        }
        return entry;
      }),
    );

    async function loadOne(item: WorkspaceFile) {
      const filePath = (item.file as any)?.path as string | undefined;
      const body: Record<string, unknown> = { file_name: item.name, analysis_max_side: 320 };
      if (filePath) {
        body.path = filePath;
      } else {
        body.image_data = await fileToDataUrl(item.file as File);
      }
      return { item, preview: await postPreview(body) };
    }

    const promises = toProcess.map(async (item) => {
      try {
        const result = await loadOne(item);
        setFiles((existing) =>
          existing.map((entry) => {
            if (entry.id === result.item.id) {
              if (entry.displayUrl?.startsWith("blob:")) URL.revokeObjectURL(entry.displayUrl);
              if (entry.thumbnailUrl?.startsWith("blob:") && entry.thumbnailUrl !== entry.displayUrl) URL.revokeObjectURL(entry.thumbnailUrl);
              return {
                ...entry,
                sessionId: result.preview.session_id,
                preview: result.preview,
                thumbnailUrl: result.preview.original_preview,
                displayUrl: result.preview.original_preview,
                thumbnailLoading: false,
              };
            }
            return entry;
          }),
        );
        return result;
      } catch {
        setFiles((existing) =>
          existing.map((entry) => {
            if (entry.id === item.id) {
              return { ...entry, thumbnailLoading: false };
            }
            return entry;
          }),
        );
        return null;
      }
    });

    await Promise.allSettled(promises);
  }

  function injectFiles(workspaceFiles: WorkspaceFile[]) {
    setFiles(workspaceFiles);
    if (workspaceFiles.length > 0) {
      setSelectedId(workspaceFiles[0].id);
    }
  }

  async function onPickFiles(fileList: PickedFiles) {
    const pickedFiles: (File | PathFileInfo)[] = fileList ? Array.from(fileList as unknown as ArrayLike<File | PathFileInfo>) : [];
    if (!pickedFiles.length) return;
    const pathItems = pickedFiles.filter((item): item is PathFileInfo => typeof item === "object" && item !== null && "path" in item && !(item instanceof File));
    const supportedPathItems = pathItems.filter((item) => /\.(jpe?g|png|tiff?|dng|cr2|cr3|nef|arw|raf|fff|hdr|exr)$/i.test(item.path));
    const effectivePickedFiles: (File | PathFileInfo)[] = pathItems.length ? supportedPathItems : pickedFiles;
    let restoredByPath = new Map<string, Awaited<ReturnType<typeof postWorkspaceOpen>>["files"][number]>();
    if (supportedPathItems.length > 0) {
      const workspaceRoot = supportedPathItems[0].workspaceRoot ?? supportedPathItems[0].path.replace(/[\\/][^\\/]+$/, "");
      try {
        const workspace = await postWorkspaceOpen({ workspace_root: workspaceRoot, paths: supportedPathItems.map((item) => item.path) });
        restoredByPath = new Map(workspace.files.map((item) => [workspacePathKey(item.path), item]));
      } catch (error) {
        notify("warning", "历史未持久化", String(error));
      }
    }
    const nextFiles = effectivePickedFiles.map((item) => {
      // Handle PathFileInfo (shell bridge items with path, no browser File)
      if (typeof item === "object" && item !== null && "path" in item && !(item instanceof File)) {
        const pathInfo = item as PathFileInfo;
        const restored = restoredByPath.get(workspacePathKey(pathInfo.path));
        const restoredState = restored?.state;
        const restoredHistory = historyFromApi(restored?.history ?? []);
        const calibratedImage = restored?.calibrated_image;
        const restoredResult: CalibrationPayload | undefined = calibratedImage && restoredState ? {
          calibrated_image: calibratedImage,
          reduction_pct: 0,
          input: { direction: "restored", lab: { strength: 0, a_mean: 0, b_star_mean: 0 } },
          output: { lab: { strength: 0, a_mean: 0, b_star_mean: 0 } },
          processing: { preview_source: "workspace-db" },
        } satisfies CalibrationPayload : undefined;
        return {
          id: `file:${pathInfo.path}`,
          kind: "file",
          file: pathInfo,
          name: pathInfo.name,
          displayUrl: calibratedImage ?? "",
          thumbnailUrl: calibratedImage ?? "",
          browserDisplayable: false,
          workspaceRoot: pathInfo.workspaceRoot ?? pathInfo.path.replace(/[\\/][^\\/]+$/, ""),
          persistentSessionId: restored?.persistent_session_id,
          persistedState: restoredState,
          persistedHistory: restoredHistory,
          persistedHistoryIndex: restored?.history_cursor ?? -1,
          historyPersistent: restored?.status === "restored",
          sessionId: undefined,
          result: restoredResult,
          calibrationSignature: restoredResult && restoredState && hasAnalysisCharts(restoredResult.charts)
            ? buildCalibrationSignature(restoredState.mode, restoredState.strength, Boolean(restoredState.negativeBaseEnabled), restoredState.accelerator, restoredState.curves, cloneLookAdjustments(restoredState.lookAdjustments), restoredState.cropApplied ? cropRectForRequest(restoredState.crop) : undefined, normalizeImageTransform(restoredState.imageTransform))
            : undefined,
          crop: restoredState?.crop,
          cropEdited: restoredState?.cropEdited,
          cropApplied: restoredState?.cropApplied,
          imageTransform: normalizeImageTransform(restoredState?.imageTransform),
          lCurve: [...DEFAULT_IDENTITY_CURVE.map((p) => [...p] as [number, number])],
          rCurve: [...DEFAULT_IDENTITY_CURVE.map((p) => [...p] as [number, number])],
          gCurve: [...DEFAULT_IDENTITY_CURVE.map((p) => [...p] as [number, number])],
          bCurve: [...DEFAULT_IDENTITY_CURVE.map((p) => [...p] as [number, number])],
        } satisfies WorkspaceFile;
      }
      // Handle regular browser File objects
      const file = item as File;
      const displayable = isBrowserDisplayable(file);
      const url = URL.createObjectURL(file);
      return {
        id: workspaceFileId(file),
        kind: "file",
        file,
        name: file.name,
        displayUrl: url,
        thumbnailUrl: url,
        browserDisplayable: displayable,
        imageTransform: DEFAULT_IMAGE_TRANSFORM,
        lCurve: [...DEFAULT_IDENTITY_CURVE.map((p) => [...p] as [number, number])],
        rCurve: [...DEFAULT_IDENTITY_CURVE.map((p) => [...p] as [number, number])],
        gCurve: [...DEFAULT_IDENTITY_CURVE.map((p) => [...p] as [number, number])],
        bCurve: [...DEFAULT_IDENTITY_CURVE.map((p) => [...p] as [number, number])],
      } satisfies WorkspaceFile;
    });
    const firstRestoredState = nextFiles[0]?.persistedState;
    if (firstRestoredState) {
      const restoredCurves = cloneManualCurves(firstRestoredState.curves);
      setMode(firstRestoredState.mode);
      setNegativeBaseEnabled(Boolean(firstRestoredState.negativeBaseEnabled));
      setStrength(firstRestoredState.strength);
      setAccelerator(firstRestoredState.accelerator);
      setLookAdjustments(cloneLookAdjustments(firstRestoredState.lookAdjustments));
      setLCurve(restoredCurves.l);
      setRCurve(restoredCurves.r);
      setGCurve(restoredCurves.g);
      setBCurve(restoredCurves.b);
      setCommittedCurves(restoredCurves);
    }
    setFiles(nextFiles);
    const firstFile = nextFiles[0];
    if (firstFile && !firstFile.browserDisplayable && !firstFile.result) {
      const filePath = (firstFile.file as any)?.path as string | undefined;
      const body: Record<string, unknown> = { file_name: firstFile.name, analysis_max_side: 320 };
      if (filePath) body.path = filePath;
      else body.image_data = await fileToDataUrl(firstFile.file as File);
      const preview = await postPreview(body);
      setFiles((existing) => existing.map(e => {
        if (e.id !== firstFile.id) return e;
        if (e.displayUrl?.startsWith("blob:")) URL.revokeObjectURL(e.displayUrl);
        return { ...e, sessionId: preview.session_id, preview, thumbnailUrl: preview.original_preview, displayUrl: preview.original_preview };
      }));
    }
    setSelectedId(nextFiles[0]?.id);
    void hydrateNonDisplayablePreviews(nextFiles);
  }

  async function runFilmScan() {
    if (!selectedFile) return;
    try {
      setActionState("filmScan", "running", selectedFile.name);
      appliedCropIdsRef.current.delete(selectedFile.id);
      setFiles((items) => items.map((item) => item.id === selectedFile.id ? {
        ...item,
        crop: undefined,
        cropSuggestedRect: undefined,
        cropEdited: false,
        cropApplied: false,
        calibrationSignature: undefined,
        result: item.result ? { ...item.result, processing: { ...item.result.processing, crop_applied: false } } : item.result,
      } : item));
      let payload: CropPayload;
      if (selectedFile.sessionId) {
        payload = await postFilmScan({ session_id: selectedFile.sessionId });
      } else if (!selectedFile.file) {
        return;
      } else {
        const filePath = (selectedFile.file as any)?.path as string | undefined;
        const body: Record<string, unknown> = { file_name: selectedFile.name };
        if (filePath) {
          body.path = filePath;
        } else {
          body.image_data = await fileToDataUrl(selectedFile.file as File);
        }
        payload = await postFilmScan(body);
      }
      highResRequestRef.current += 1;
      if (highResTimerRef.current) {
        clearTimeout(highResTimerRef.current);
        highResTimerRef.current = null;
      }
      highResSessionRef.current = payload.session_id ?? selectedFile.sessionId ?? null;
      setFiles((items) =>
        items.map((item) =>
          item.id === selectedFile.id
            ? {
                ...item,
                sessionId: payload.session_id ?? item.sessionId,
                crop: payload,
                cropSuggestedRect: payload.crop_rect,
                cropEdited: false,
                cropApplied: false,
                calibrationSignature: undefined,
                result: item.result ? { ...item.result, processing: { ...item.result.processing, crop_applied: false } } : item.result,
              }
            : item,
        ),
      );
      setActionState("filmScan", "success", payload.film_scan?.film_format ?? payload.processing?.film_scan_source ?? "done");
      beginEdit();
      commitEdit("胶片扫描", "film-scan", currentEditState({ crop: payload, cropEdited: false, cropApplied: false, runtimeSessionId: payload.session_id ?? selectedFile.sessionId }));
    } catch (error) {
      console.error(error);
      setActionState("filmScan", "error", String(error));
      notify("error", "Film scan failed", String(error));
    }
  }

  async function runExport() {
    if (!selectedFile?.file) return;
    try {
      setActionState("export", "running", exportOptions.outputPath);
      const filePathVal = (selectedFile.file as any)?.path as string | undefined;
      const effectiveCurves = composeManualCurves(committedCurves);
      const body: Record<string, unknown> = {
        file_name: selectedFile.name,
        mode: effectiveExportMode(mode, selectedFile),
        strength,
        negative_base: negativeBaseEnabled,
        look: lookPayloadForRequest(lookAdjustments),
        accelerator,
        output_path: exportOptions.outputPath,
        format: exportOptions.format,
        quality: exportOptions.quality,
        embed_icc: exportOptions.embedIcc,
        preserve_metadata: exportOptions.preserveMetadata,
        export_transform: exportOptions.exportTransform,
        crop_rect: isCropApplied(selectedFile) ? cropRectForRequest(selectedFile.crop) : undefined,
        image_transform: imageTransformForRequest(selectedFile.imageTransform),
        r_curve: effectiveCurves.r,
        g_curve: effectiveCurves.g,
        b_curve: effectiveCurves.b,
      };
      if (filePathVal) {
        body.path = filePathVal;
      } else {
        body.image_data = await fileToDataUrl(selectedFile.file as File);
      }
      const payload = await postExport(body);
      setExportResult(payload);
      setActiveInspectorTab("export");
      setActionState("export", "success", payload.path);
      notify("success", "Export complete", payload.path);
    } catch (error) {
      console.error(error);
      setActionState("export", "error", String(error));
      notify("error", "Export failed", String(error));
    }
  }

  async function runBatchExport() {
    const exportableFiles = filesRef.current.filter((item) => item.kind === "file" && item.file);
    if (exportableFiles.length === 0) return;
    const outputDir = directoryFromPath(exportOptions.outputPath);
    const nextResults: BatchExportItemResult[] = [];
    setBatchExportResults([]);
    setActiveInspectorTab("export");
    let successCount = 0;
    try {
      setActionState("batchExport", "running", `0/${exportableFiles.length}`);
      for (let index = 0; index < exportableFiles.length; index += 1) {
        const item = exportableFiles[index]!;
        const state = stateForFileExport(item);
        const effectiveCurves = composeManualCurves(state.curves);
        const body: Record<string, unknown> = {
          file_name: item.name,
          mode: effectiveExportMode(state.mode, item),
          strength: state.strength,
          negative_base: Boolean(state.negativeBaseEnabled),
          look: lookPayloadForRequest(cloneLookAdjustments(state.lookAdjustments)),
          accelerator: state.accelerator,
          output_path: suggestExportPathInDirectory(item.name, exportOptions.format, outputDir),
          format: exportOptions.format,
          quality: exportOptions.quality,
          embed_icc: exportOptions.embedIcc,
          preserve_metadata: exportOptions.preserveMetadata,
          export_transform: exportOptions.exportTransform,
          crop_rect: state.cropApplied ? cropRectForRequest(state.crop) : undefined,
          image_transform: imageTransformForRequest(state.imageTransform),
          r_curve: effectiveCurves.r,
          g_curve: effectiveCurves.g,
          b_curve: effectiveCurves.b,
        };
        setActionState("batchExport", "running", `${index + 1}/${exportableFiles.length} ${item.name}`);
        try {
          const filePathVal = (item.file as any)?.path as string | undefined;
          if (filePathVal) {
            body.path = filePathVal;
          } else {
            body.image_data = await fileToDataUrl(item.file as File);
          }
          const payload = await postExport(body);
          successCount += 1;
          nextResults.push({
            file_id: item.id,
            file_name: item.name,
            ok: true,
            path: payload.path,
          });
        } catch (error) {
          nextResults.push({
            file_id: item.id,
            file_name: item.name,
            ok: false,
            error: String(error),
          });
        }
        setBatchExportResults([...nextResults]);
      }
      setActionState("batchExport", successCount === exportableFiles.length ? "success" : "error", `${successCount}/${exportableFiles.length}`);
      notify(successCount === exportableFiles.length ? "success" : "warning", "批量导出完成", `${successCount}/${exportableFiles.length} 成功`);
    } catch (error) {
      console.error(error);
      setActionState("batchExport", "error", String(error));
      notify("error", "批量导出失败", String(error));
    }
  }

  async function renderDocument() {
    if (!selectedFile?.sessionId) return;
    try {
      setActionState("document", "running", selectedFile.sessionId);
      const payload = await postDocumentRender({ session_id: selectedFile.sessionId });
      setDocumentRender(payload);
      if (selectedFile) documentRenderFileRef.current = selectedFile.id;
      setActionState("document", "success", `${payload.processing?.document_replayable_ops ?? 0} ops`);
      notify("success", "Document rendered", `${payload.processing?.document_replayable_ops ?? 0} replayable ops`);
    } catch (error) {
      console.error(error);
      setActionState("document", "error", String(error));
      notify("error", "Document render failed", String(error));
    }
  }

  async function saveSession() {
    if (!selectedFile?.sessionId) return;
    try {
      setActionState("session", "running", sessionOptions.savePath);
      const payload = await postSessionSave({
        session_id: selectedFile.sessionId,
        path: sessionOptions.savePath,
      });
      setSessionSaveResult(payload);
      setActionState("session", "success", payload.path);
      notify("success", "Session saved", payload.path);
    } catch (error) {
      console.error(error);
      setActionState("session", "error", String(error));
      notify("error", "Session save failed", String(error));
    }
  }

  async function refreshSavedSessions() {
    try {
      const payload = await fetchSessionList();
      setSavedSessions(payload.sessions);
    } catch (error) {
      console.error(error);
      notify("error", "Session refresh failed", String(error));
    }
  }

  async function loadSavedSession(item: SessionListItem) {
    try {
      setActionState("session", "running", item.path);
      const loaded = await fetchSessionLoad(item.path);
      const payload = await postCalibrationSession({
        session_id: loaded.session_id,
        mode,
        strength,
        negative_base: negativeBaseEnabled,
        accelerator,
      });
      const nextItem: WorkspaceFile = {
        id: `session:${loaded.session_id}`,
        kind: "session",
        file: null,
        name: item.session_id,
        displayUrl: payload.original_preview ?? payload.calibrated_image,
        thumbnailUrl: payload.original_preview ?? payload.calibrated_image,
        browserDisplayable: false,
        sessionId: loaded.session_id,
        sessionPath: item.path,
        result: payload,
        cropEdited: false,
        lCurve: [...DEFAULT_IDENTITY_CURVE.map((p) => [...p] as [number, number])],
        rCurve: [...DEFAULT_IDENTITY_CURVE.map((p) => [...p] as [number, number])],
        gCurve: [...DEFAULT_IDENTITY_CURVE.map((p) => [...p] as [number, number])],
        bCurve: [...DEFAULT_IDENTITY_CURVE.map((p) => [...p] as [number, number])],
      };
      setFiles((current) => {
        const filtered = current.filter((entry) => entry.id !== nextItem.id);
        return [nextItem, ...filtered];
      });
      setSelectedId(nextItem.id);
      setActiveInspectorTab("session");
      setActionState("session", "success", item.path);
      notify("success", "Session loaded", item.path);
    } catch (error) {
      console.error(error);
      setActionState("session", "error", String(error));
      notify("error", "Session load failed", String(error));
    }
  }

  async function deleteSavedSession(item: SessionListItem) {
    try {
      setActionState("session", "running", item.path);
      await postSessionDelete({ path: item.path });
      await refreshSavedSessions();
      setActionState("session", "success", item.path);
      notify("success", "Session deleted", item.path);
    } catch (error) {
      console.error(error);
      setActionState("session", "error", String(error));
      notify("error", "Session delete failed", String(error));
    }
  }

  async function runAIEvaluation() {
    if (!selectedFile?.sessionId) return;
    try {
      setActionState("ai", "running", selectedEvaluator);
      const body: Record<string, unknown> = {
        session_id: selectedFile.sessionId,
        evaluator_name: selectedEvaluator,
        mode,
        strength,
        context: aiContext,
        timeout_ms: 15000,
        allow_failure: true,
      };
      if (aiSettings.type !== "mock" && aiSettings.api_key) {
        body.provider = {
          type: aiSettings.type,
          base_url: aiSettings.base_url,
          model: aiSettings.model,
          api_key: aiSettings.api_key,
        };
      }
      const payload = await postAIEvaluate(body);
      setAiResult(payload);
      setActiveInspectorTab("ai");
      setActionState("ai", payload.ok ? "success" : "error", payload.evaluation?.summary ?? payload.error ?? payload.evaluator_name);
      notify(payload.ok ? "success" : "warning", payload.ok ? "AI review complete" : "AI review warning", payload.evaluation?.summary ?? payload.error ?? payload.evaluator_name);
    } catch (error) {
      console.error(error);
      setActionState("ai", "error", String(error));
      notify("error", "AI review failed", String(error));
    }
  }

  function updateSelectedCrop(cropRect: CropRect, options?: { interaction?: "drag" | "commit" }) {
    if (!selectedFile) return;
    appliedCropIdsRef.current.delete(selectedFile.id);
    if (options?.interaction === "drag") beginEdit();
    const nextCrop = selectedFile.crop ? { ...selectedFile.crop, crop_rect: cropRect } : { crop_rect: cropRect };
    setFiles((items) =>
      items.map((item) =>
        item.id === selectedFile.id
          ? {
              ...item,
              crop: item.crop
                ? {
                    ...item.crop,
                    crop_rect: cropRect,
                  }
                : {
                    crop_rect: cropRect,
                  },
              cropEdited: true,
              cropApplied: false,
              calibrationSignature: undefined,
              result: item.result ? { ...item.result, processing: { ...item.result.processing, crop_applied: false } } : item.result,
            }
          : item,
      ),
    );
    if (options?.interaction === "commit") {
      commitEdit("裁切调整", "crop", currentEditState({ crop: nextCrop, cropEdited: true, cropApplied: false }));
    }
  }

  function resetSelectedCrop() {
    if (!selectedFile?.cropSuggestedRect) return;
    appliedCropIdsRef.current.delete(selectedFile.id);
    beginEdit();
    const nextCrop = selectedFile.crop
      ? { ...selectedFile.crop, crop_rect: selectedFile.cropSuggestedRect }
      : { crop_rect: selectedFile.cropSuggestedRect };
    setFiles((items) =>
      items.map((item) =>
        item.id === selectedFile.id
          ? {
              ...item,
              crop: item.crop
                ? {
                    ...item.crop,
                    crop_rect: item.cropSuggestedRect!,
                  }
                : {
                    crop_rect: item.cropSuggestedRect!,
                  },
              cropEdited: false,
              cropApplied: false,
              calibrationSignature: undefined,
              result: item.result ? { ...item.result, processing: { ...item.result.processing, crop_applied: false } } : item.result,
            }
          : item,
      ),
    );
    notify("info", "Crop reset", "恢复到自动建议框");
    commitEdit("裁切复位", "crop-reset", currentEditState({ crop: nextCrop, cropEdited: false, cropApplied: false }));
  }

  function applySelectedCrop() {
    if (!selectedFile?.crop || isCropApplied(selectedFile)) return;
    beginEdit();
    appliedCropIdsRef.current.add(selectedFile.id);
    setFiles((items) => items.map((item) =>
      item.id === selectedFile.id ? { ...item, cropApplied: true, calibrationSignature: undefined } : item,
    ));
    commitEdit("应用裁切", "crop-apply", currentEditState({ cropApplied: true }));
  }

  function updateSelectedImageTransform(
    updater: ImageTransform | ((current: ImageTransform) => ImageTransform),
    options?: { interaction?: "drag" | "commit"; description?: string },
  ) {
    if (!selectedFile) return;
    if (options?.interaction === "drag") beginEdit();
    const currentTransform = normalizeImageTransform(selectedFile.imageTransform);
    const nextTransform = normalizeImageTransform(typeof updater === "function" ? updater(currentTransform) : updater);
    setFiles((items) =>
      items.map((item) =>
        item.id === selectedFile.id
          ? {
              ...item,
              imageTransform: nextTransform,
            }
          : item,
      ),
    );
    if (options?.interaction === "commit") {
      commitEdit(options.description ?? "旋转与翻转", "image-transform", currentEditState({ imageTransform: nextTransform }));
    }
  }

  function rotateSelectedImage(delta: number) {
    beginEdit();
    updateSelectedImageTransform(
      (current) => ({ ...current, rotation: normalizeRotation(current.rotation + delta) }),
      { interaction: "commit", description: delta < 0 ? "向左旋转" : "向右旋转" },
    );
  }

  function flipSelectedImage(axis: "horizontal" | "vertical") {
    beginEdit();
    updateSelectedImageTransform(
      (current) => axis === "horizontal"
        ? { ...current, flipH: !current.flipH }
        : { ...current, flipV: !current.flipV },
      { interaction: "commit", description: axis === "horizontal" ? "水平翻转" : "垂直翻转" },
    );
  }

  function resetSelectedImageTransform() {
    beginEdit();
    updateSelectedImageTransform(DEFAULT_IMAGE_TRANSFORM, { interaction: "commit", description: "重置旋转翻转" });
  }

  function setCurves(next: ManualCurves, options?: { interaction?: "drag" | "commit" | "edit" }) {
    perfReset("curve-drag");
    const interaction = options?.interaction ?? "edit";
    if (interaction === "drag") beginEdit();
    const nl = cloneCurve(next.l);
    const nr = cloneCurve(next.r);
    const ng = cloneCurve(next.g);
    const nb = cloneCurve(next.b);
    const manualCurves = { l: nl, r: nr, g: ng, b: nb };
    perfMark("setCurves.state");
    debugLog("setCurves", { interaction, hasPreview: !!localCurvePreviewBitmap, fileId: selectedFile?.id });
    setLCurve(nl);
    setRCurve(nr);
    setGCurve(ng);
    setBCurve(nb);
    setCurveInteraction(interaction === "drag" ? "drag" : "idle");
    if (interaction !== "drag") {
      setCommittedCurves(cloneManualCurves(manualCurves));
    }
    if (selectedFile) {
      const previewTarget = filesRef.current.find((item) => item.id === selectedFile.id) ?? selectedFile;
      fileCurvesRef.current.set(selectedFile.id, manualCurves);
      if (interaction === "drag") {
        scheduleLocalCurvePreview(previewTarget, manualCurves, "drag");
      } else {
        clearLocalCurvePreview();
      }
    } else {
      console.warn("[curve-preview] SKIP: selectedFile is null, cannot schedule preview. files:", files.length, "selectedId:", selectedId);
    }
    if (interaction !== "drag") {
      beginEdit();
      commitEdit("曲线调整", "curves", currentEditState({ curves: manualCurves }));
    }
  }

  function pushHistoryEntry(description: string, operationCount: number, currentOpName: string) {
    const now = new Date();
    const timestamp = [now.getHours(), now.getMinutes(), now.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
    const entry: HistoryEntry = { description, timestamp, operation_count: operationCount, current_op_name: currentOpName };
    setHistory((prev) => {
      const idx = historyIndexRef.current;
      const truncated = prev.slice(0, idx + 1);
      const next = [...truncated, entry].slice(-50);
      setHistoryIndex(next.length - 1);
      return next;
    });
  }

  function dismissNotification(id: string) {
    setNotifications((current) => current.filter((item) => item.id !== id));
  }

  function releaseFileResources(file: WorkspaceFile) {
    if (file.displayUrl?.startsWith("blob:")) URL.revokeObjectURL(file.displayUrl);
    if (file.thumbnailUrl?.startsWith("blob:") && file.thumbnailUrl !== file.displayUrl) URL.revokeObjectURL(file.thumbnailUrl);
  }

  function removeSelectedItem() {
    if (!selectedFile) return;
    releaseFileResources(selectedFile);
    setFiles((current) => {
      const next = current.filter((item) => item.id !== selectedFile.id);
      const replacement = next[0]?.id;
      setSelectedId(replacement);
      return next;
    });
    notify("info", "Item removed", selectedFile.name);
  }

  function clearWorkspace() {
    files.forEach(releaseFileResources);
    setFiles([]);
    setSelectedId(undefined);
    setDocumentRender(null);
    setAiResult(null);
    setExportResult(null);
    setSessionSaveResult(null);
    notify("info", "Workspace cleared", "已清空当前工作区。");
  }

  function selectRelativeItem(direction: -1 | 1) {
    if (!filteredFiles.length) return;
    if (!selectedId) {
      setSelectedId(filteredFiles[0]?.id);
      return;
    }
    const currentIndex = filteredFiles.findIndex((item) => item.id === selectedId);
    if (currentIndex < 0) {
      setSelectedId(filteredFiles[0]?.id);
      return;
    }
    const nextIndex = Math.min(filteredFiles.length - 1, Math.max(0, currentIndex + direction));
    setSelectedId(filteredFiles[nextIndex]?.id);
  }

  function setViewerZoomPreset(mode: ViewerZoomMode) {
    updateViewerState({
      zoomMode: mode,
      zoomScale: 1,
      pan: { x: 0, y: 0 },
    });
  }

  function setViewerManualScale(scale: number) {
    updateViewerState({
      zoomMode: "manual",
      zoomScale: Math.max(0.5, Math.min(scale, 4)),
    });
  }

  function setViewerPanOffset(pan: ViewerPan) {
    updateViewerState({
      pan: {
        x: Math.max(-1200, Math.min(1200, pan.x)),
        y: Math.max(-1200, Math.min(1200, pan.y)),
      },
    });
  }

  function zoomIn() {
    setViewerState((current) => ({
      ...current,
      zoomMode: "manual",
      zoomScale: Math.min(4, Number((current.zoomScale + 0.1).toFixed(2))),
    }));
  }

  function zoomOut() {
    setViewerState((current) => ({
      ...current,
      zoomMode: "manual",
      zoomScale: Math.max(0.5, Number((current.zoomScale - 0.1).toFixed(2))),
    }));
  }

  function resetViewerZoom() {
    updateViewerState({
      zoomMode: "fit",
      zoomScale: 1,
      pan: { x: 0, y: 0 },
    });
  }

  function setCompareMode(mode: CompareMode) {
    updateViewerState({ compareMode: mode });
  }

  function setSplitPosition(value: number) {
    updateViewerState({ splitPosition: Math.max(10, Math.min(90, value)) });
  }

  function updatePreference<K extends keyof WorkbenchPreferences>(key: K, value: WorkbenchPreferences[K]) {
    setPreferences((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function togglePreference<K extends keyof WorkbenchPreferences>(key: K) {
    setPreferences((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }

  function toggleLayoutElement(target: "analysis" | "filmstrip" | "inspector" | "viewer-hud") {
    if (target === "analysis") {
      togglePreference("showAnalysisPane");
      return;
    }
    if (target === "filmstrip") {
      togglePreference("showFilmstrip");
      return;
    }
    if (target === "inspector") {
      togglePreference("showInspectorPane");
      return;
    }
    togglePreference("showViewerHud");
  }

  function toggleViewerFocusMode() {
    setViewerFocusMode((current) => !current);
  }

  function resetPreferences() {
    setPreferences(DEFAULT_WORKBENCH_PREFERENCES);
    setViewerFocusMode(false);
  }

  const setAISettingsAndSave = useCallback((s: AIProviderSettings) => {
    saveAISettings(s);
    setAISettings(s);
  }, []);

  return useMemo(() => ({
    backendOk,
    plugins,
    evaluators,
    capabilities,
    files,
    setFiles,
    filteredFiles,
    fileCounts,
    selectedId,
    setSelectedId,
    selectedFile,
    displayedSelectedFile,
    selectionDisplayReady,
    compareMode,
    setCompareMode,
    splitPosition,
    setSplitPosition,
    viewerZoomMode,
    setViewerZoomPreset,
    viewerZoomScale,
    setViewerManualScale,
    viewerPan,
    setViewerPanOffset,
    zoomIn,
    zoomOut,
    resetViewerZoom,
    mode,
    setMode,
    setModeCommitted,
    negativeBaseEnabled,
    setNegativeBaseCommitted,
    strength,
    setStrength,
    commitStrength,
    lookAdjustments,
    previewLookAdjustments,
    commitLookAdjustments,
    resetLookAdjustments,
    beginEdit,
    commitEdit,
    accelerator,
    setAccelerator,
    loading,
    highResLoading,
    localCurvePreviewBitmap,
    localCurvePreviewHistogram,
    settleLocalCurvePreview,
    onPickFiles,
    injectFiles,
    activeInspectorTab,
    setActiveInspectorTab,
    exportOptions,
    setExportOptions,
    exportResult,
    batchExportResults,
    documentRender,
    sessionOptions,
    setSessionOptions,
    sessionSaveResult,
    savedSessions,
    selectedEvaluator,
    setSelectedEvaluator,
    aiContext,
    setAiContext,
    aiSettings,
    setAISettings: setAISettingsAndSave,
    aiResult,
    notifications,
    activityLog,
    actionStates,
    sourceFilter,
    setSourceFilter,
    searchQuery,
    setSearchQuery,
    stageContainerSize,
    setStageContainerSize,
    preferences,
    layoutState,
    updatePreference,
    togglePreference,
    toggleLayoutElement,
    toggleViewerFocusMode,
    resetPreferences,
    runFilmScan,
    runExport,
    runBatchExport,
    renderDocument,
    saveSession,
    refreshSavedSessions,
    loadSavedSession,
    deleteSavedSession,
    runAIEvaluation,
    updateSelectedCrop,
    resetSelectedCrop,
    applySelectedCrop,
    updateSelectedImageTransform,
    rotateSelectedImage,
    flipSelectedImage,
    resetSelectedImageTransform,
    dismissNotification,
    removeSelectedItem,
    clearWorkspace,
    selectRelativeItem,
    undo,
    redo,
    lCurve,
    rCurve,
    gCurve,
    bCurve,
    setCurves,
    history,
    historyIndex,
  }), [
    backendOk, plugins, evaluators, capabilities, files, filteredFiles, fileCounts,
    selectedId, selectedFile, displayedSelectedFile, selectionDisplayReady, compareMode, splitPosition, viewerZoomMode, viewerZoomScale,
    viewerPan, mode, negativeBaseEnabled, strength, lookAdjustments, accelerator, loading, highResLoading, localCurvePreviewBitmap, localCurvePreviewHistogram, activeInspectorTab, exportOptions,
    exportResult, batchExportResults, documentRender, sessionOptions, sessionSaveResult, savedSessions,
    selectedEvaluator, aiContext, aiSettings, aiResult, notifications, activityLog,
    actionStates, sourceFilter, searchQuery, stageContainerSize, preferences, layoutState,
    lCurve, rCurve, gCurve, bCurve, history, historyIndex, setAISettingsAndSave, settleLocalCurvePreview,
  ]);
}

export type WorkbenchController = ReturnType<typeof useWorkbench>;
