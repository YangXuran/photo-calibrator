import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchAIEvaluators, fetchCapabilities, fetchConfig, fetchHealth, fetchPlugins, fetchSessionList, fetchSessionLoad, postAIEvaluate, postCalibration, postCalibrationSession, postDocumentRender, postExport, postFilmScan, postPreview, postSessionDelete, postSessionSave, putConfig } from "../lib/api";
import { fileToDataUrl, isBrowserDisplayable, workspaceFileId } from "../lib/files";
import { DEFAULT_WORKBENCH_PREFERENCES } from "../lib/layoutPresets";
import { suggestExportPath, suggestSessionPath } from "../lib/paths";
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
  ExportPayload,
  HistoryEntry,
  InspectorTab,
  ManualCurves,
  NotificationItem,
  PluginInfo,
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

const WORKBENCH_PREFERENCES_KEY = "photo-calibrator:workbench-preferences";
const WORKBENCH_INSPECTOR_TAB_KEY = "photo-calibrator:workbench-inspector-tab";
const WORKBENCH_VIEWER_STATE_KEY = "photo-calibrator:workbench-viewer-state";

/** A file info from shell bridge with path (no File object for non-browser files) */
export type PathFileInfo = { name: string; path: string };

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
    };
  } catch {
    return DEFAULT_WORKBENCH_PREFERENCES;
  }
}

function loadInspectorTab(): InspectorTab {
  if (typeof window === "undefined") return "adjust";
  try {
    const raw = window.localStorage.getItem(WORKBENCH_INSPECTOR_TAB_KEY);
    if (!raw) return "adjust";
    const parsed = JSON.parse(raw) as InspectorTab;
    return parsed;
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

export function useWorkbench() {
  const [backendOk, setBackendOk] = useState<boolean | null>(null);
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [evaluators, setEvaluators] = useState<EvaluatorInfo[]>([]);
  const [capabilities, setCapabilities] = useState<CapabilityPayload | null>(null);
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [viewerState, setViewerState] = useState<ViewerWorkspaceState>(() => loadViewerState());
  const [mode, setMode] = useState("global");
  const [strength, setStrength] = useState(0.8);
  const [accelerator, setAccelerator] = useState("auto");
  const [loading, setLoading] = useState(false);
  const [highResLoading, setHighResLoading] = useState(false);
  const [activeInspectorTab, setActiveInspectorTabState] = useState<InspectorTab>(() => loadInspectorTab());
  const [exportOptions, setExportOptions] = useState<ExportOptions>({
    format: "jpeg",
    outputPath: "/tmp/photo-calibrated.jpg",
    quality: 92,
    embedIcc: true,
    preserveMetadata: true,
    exportTransform: "auto",
  });
  const [sessionOptions, setSessionOptions] = useState<SessionOptions>({
    savePath: "/tmp/photo-session.json",
  });
  const [exportResult, setExportResult] = useState<ExportPayload | null>(null);
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
    ai: ActionState;
    session: ActionState;
    document: ActionState;
  }>({
    calibration: { status: "idle" },
    filmScan: { status: "idle" },
    export: { status: "idle" },
    ai: { status: "idle" },
    session: { status: "idle" },
    document: { status: "idle" },
  });
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [rCurve, setRCurve] = useState<ChannelCurve>([...DEFAULT_IDENTITY_CURVE.map((p) => [...p] as [number, number])]);
  const [gCurve, setGCurve] = useState<ChannelCurve>([...DEFAULT_IDENTITY_CURVE.map((p) => [...p] as [number, number])]);
  const [bCurve, setBCurve] = useState<ChannelCurve>([...DEFAULT_IDENTITY_CURVE.map((p) => [...p] as [number, number])]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [preferences, setPreferences] = useState<WorkbenchPreferences>(() => loadWorkbenchPreferences());
  const [viewerFocusMode, setViewerFocusMode] = useState(false);
  const [stageContainerSize, setStageContainerSize] = useState<{ width: number; height: number } | null>(null);
  const requestRef = useRef(0);
  const calibrationDepthRef = useRef(0);
  const currentResMaxSideRef = useRef(320);
  const prevDepsRef = useRef<{ id?: string; mode: string; strength: number }>({ mode: "global", strength: 0.8 });
  const fileCurvesRef = useRef<Map<string, { r: ChannelCurve; g: ChannelCurve; b: ChannelCurve }>>(new Map());
  const highResTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const highResRequestRef = useRef(0);
  const highResSessionRef = useRef<string | null>(null);
  const curveSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const curveHistoryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /* undo stack for calibration parameters (mode + strength + accelerator + curves) */
  type UndoSnapshot = { mode: string; strength: number; accelerator: string; rCurve: ChannelCurve; gCurve: ChannelCurve; bCurve: ChannelCurve };
  const undoStackRef = useRef<UndoSnapshot[]>([]);
  const undoIndexRef = useRef(-1);
  const undoingRef = useRef(false);
  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyIndexRef = useRef(historyIndex);
  const selectedFile = useMemo(() => files.find((item) => item.id === selectedId), [files, selectedId]);
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
      showLibraryPane: preferences.showLibraryPane && !viewerFocusMode,
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

  function updateViewerState(patch: Partial<ViewerWorkspaceState>) {
    setViewerState((current) => ({
      ...current,
      ...patch,
    }));
  }

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
    historyIndexRef.current = historyIndex;
  }, [historyIndex]);

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

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && (target.closest("input, textarea, select, button") || target.isContentEditable)) {
        return;
      }
      if (event.altKey && event.key === "1") {
        event.preventDefault();
        toggleLayoutElement("library");
      } else if (event.altKey && event.key === "2") {
        event.preventDefault();
        toggleLayoutElement("filmstrip");
      } else if (event.altKey && event.key === "3") {
        event.preventDefault();
        toggleLayoutElement("inspector");
      } else if (event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        toggleViewerFocusMode();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [preferences, viewerFocusMode]);

  function undo() {
    const stack = undoStackRef.current;
    const idx = undoIndexRef.current;
    if (idx <= 0) return;
    undoingRef.current = true;
    undoIndexRef.current = idx - 1;
    const snap = stack[idx - 1];
    setMode(snap.mode);
    setStrength(snap.strength);
    setAccelerator(snap.accelerator);
    setRCurve(snap.rCurve.map((p) => [...p] as [number, number]));
    setGCurve(snap.gCurve.map((p) => [...p] as [number, number]));
    setBCurve(snap.bCurve.map((p) => [...p] as [number, number]));
    undoingRef.current = false;
  }

  function redo() {
    const stack = undoStackRef.current;
    const idx = undoIndexRef.current;
    if (idx >= stack.length - 1) return;
    undoingRef.current = true;
    undoIndexRef.current = idx + 1;
    const snap = stack[idx + 1];
    setMode(snap.mode);
    setStrength(snap.strength);
    setAccelerator(snap.accelerator);
    setRCurve(snap.rCurve.map((p) => [...p] as [number, number]));
    setGCurve(snap.gCurve.map((p) => [...p] as [number, number]));
    setBCurve(snap.bCurve.map((p) => [...p] as [number, number]));
    undoingRef.current = false;
  }

  useEffect(() => {
    if (!selectedFile) return;
    const depth = ++calibrationDepthRef.current;
    if (depth > 3) {
      console.error("[Calibration] recursion guard triggered at depth", depth, "- aborting");
      calibrationDepthRef.current = Math.max(0, calibrationDepthRef.current - 1);
      return;
    }
    const prev = prevDepsRef.current;
    const fileOrParamsChanged = prev.id !== selectedFile?.id || prev.mode !== mode || prev.strength !== strength;
    prevDepsRef.current = { id: selectedFile?.id, mode, strength };
    debugLog("calib.effect", { fileId: selectedFile?.id?.substring(0, 20), fileChanged: fileOrParamsChanged, mode, strength });
    const fastMode = !fileOrParamsChanged;
    const debounceMs = fastMode ? 0 : 160;
    if (fastMode) perfMark(`effect.fire(debounce=${debounceMs}ms)`);
    const currentRequest = ++requestRef.current;
    const run = async () => {
      perfMark("run.start");
      if (fileOrParamsChanged) setLoading(true);
      setActionState("calibration", "running", selectedFile.name);
      try {
        let payload: CalibrationPayload;
        const curvePayload = { r_curve: rCurve, g_curve: gCurve, b_curve: bCurve };
        perfMark("api.start");
        if (selectedFile.sessionId) {
          payload = await postCalibrationSession({
            session_id: selectedFile.sessionId,
            mode,
            strength,
            accelerator,
            include_original: false,
            fast: fastMode,
            ...curvePayload,
          });
        } else {
          if (!selectedFile.file) return;
          const filePath = (selectedFile.file as any)?.path as string | undefined;
          const body: Record<string, unknown> = {
            file_name: selectedFile.name,
            mode,
            strength,
            accelerator,
            fast: fastMode,
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
                session_id: sid, mode, strength, accelerator,
                include_original: false,
                r_curve: rCurve, g_curve: gCurve, b_curve: bCurve,
              });
              setFiles((items) => items.map((item) =>
                item.id === selectedFile.id ? { ...item, result: cal } : item
              ));
            } catch {}
          }, 600);
        }
        setActionState("calibration", "success", payload.session_id ?? selectedFile.name);
        const opCount = payload.processing ? 1 : 0;
        pushHistoryEntry(`${mode} / ${strength.toFixed(2)}`, opCount, mode);
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
        if (fileOrParamsChanged) setLoading(false);
      }
    };
    const timer = window.setTimeout(run, debounceMs);
    return () => {
      window.clearTimeout(timer);
      calibrationDepthRef.current = Math.max(0, calibrationDepthRef.current - 1);
      if (fileOrParamsChanged) setLoading(false);
    };
  }, [selectedFile?.id, mode, strength, accelerator, rCurve, gCurve, bCurve]);

  /* push calibration snapshots to undo stack (debounced 600ms) */
  useEffect(() => {
    if (undoingRef.current) return;
    const prevTimer = pushTimerRef.current;
    if (prevTimer) clearTimeout(prevTimer);
    pushTimerRef.current = setTimeout(() => {
      const snap: UndoSnapshot = { mode, strength, accelerator, rCurve, gCurve, bCurve };
      const stack = undoStackRef.current;
      const idx = undoIndexRef.current;
      const last = stack[idx];
      if (last && last.mode === snap.mode && last.strength === snap.strength && last.accelerator === snap.accelerator) return;
      undoStackRef.current = stack.slice(0, idx + 1);
      undoStackRef.current.push(snap);
      if (undoStackRef.current.length > 50) {
        undoStackRef.current.shift();
      }
      undoIndexRef.current = undoStackRef.current.length - 1;
    }, 600);
    return () => { const t = pushTimerRef.current; if (t) clearTimeout(t); };
  }, [mode, strength, accelerator, rCurve, gCurve, bCurve]);

  useEffect(() => {
    if (!selectedFile) return;
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
    const saved = fileCurvesRef.current.get(selectedFile.id);
    setRCurve(saved?.r ?? selectedFile.rCurve ?? DEFAULT_IDENTITY_CURVE.map((p) => [...p] as [number, number]));
    setGCurve(saved?.g ?? selectedFile.gCurve ?? DEFAULT_IDENTITY_CURVE.map((p) => [...p] as [number, number]));
    setBCurve(saved?.b ?? selectedFile.bCurve ?? DEFAULT_IDENTITY_CURVE.map((p) => [...p] as [number, number]));
    setHistory([]);
    setHistoryIndex(-1);
  }, [selectedFile?.id]);

  useEffect(() => {
    if (!selectedFile) return;
    setExportOptions((current) => ({
      ...current,
      outputPath: suggestExportPath(selectedFile.name, current.format),
    }));
  }, [exportOptions.format, selectedFile?.id]);

  /* ── Adaptive resolution: reset tracking when file changes ── */
  useEffect(() => {
    currentResMaxSideRef.current = 320;
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
    requiredMaxSide = Math.max(320, Math.min(3200, Math.round(requiredMaxSide)));

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
          accelerator,
          include_original: true,
          r_curve: rCurve,
          g_curve: gCurve,
          b_curve: bCurve,
        });
        if (requestId !== highResRequestRef.current) return;
        setFiles((items) =>
          items.map((item) =>
            item.id === capturedFileId
              ? { ...item, result: calibration }
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
  }, [stageContainerSize, viewerZoomScale, viewerZoomMode, selectedFile?.sessionId, mode, strength, accelerator]);

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
    const nextFiles = pickedFiles.map((item) => {
      // Handle PathFileInfo (shell bridge items with path, no browser File)
      if (typeof item === "object" && item !== null && "path" in item && !(item instanceof File)) {
        const pathInfo = item as PathFileInfo;
        return {
          id: `file:${pathInfo.path}`,
          kind: "file",
          file: pathInfo,
          name: pathInfo.name,
          displayUrl: "",
          thumbnailUrl: "",
          browserDisplayable: false,
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
        rCurve: [...DEFAULT_IDENTITY_CURVE.map((p) => [...p] as [number, number])],
        gCurve: [...DEFAULT_IDENTITY_CURVE.map((p) => [...p] as [number, number])],
        bCurve: [...DEFAULT_IDENTITY_CURVE.map((p) => [...p] as [number, number])],
      } satisfies WorkspaceFile;
    });
    setFiles(nextFiles);
    const firstFile = nextFiles[0];
    if (firstFile && !firstFile.browserDisplayable) {
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
      setFiles((items) =>
        items.map((item) =>
          item.id === selectedFile.id
            ? {
                ...item,
                sessionId: payload.session_id ?? item.sessionId,
                crop: payload,
                cropSuggestedRect: payload.crop_rect,
                cropEdited: false,
              }
            : item,
        ),
      );
      setActionState("filmScan", "success", payload.film_scan?.film_format ?? payload.processing?.film_scan_source ?? "done");
      pushHistoryEntry("胶片扫描", 1, "film-scan");
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
      const body: Record<string, unknown> = {
        file_name: selectedFile.name,
        mode,
        strength,
        accelerator,
        output_path: exportOptions.outputPath,
        format: exportOptions.format,
        quality: exportOptions.quality,
        embed_icc: exportOptions.embedIcc,
        preserve_metadata: exportOptions.preserveMetadata,
        export_transform: exportOptions.exportTransform,
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
      setActiveInspectorTab("analysis");
      setActionState("ai", payload.ok ? "success" : "error", payload.evaluation?.summary ?? payload.error ?? payload.evaluator_name);
      notify(payload.ok ? "success" : "warning", payload.ok ? "AI review complete" : "AI review warning", payload.evaluation?.summary ?? payload.error ?? payload.evaluator_name);
    } catch (error) {
      console.error(error);
      setActionState("ai", "error", String(error));
      notify("error", "AI review failed", String(error));
    }
  }

  function updateSelectedCrop(cropRect: CropRect) {
    if (!selectedFile) return;
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
            }
          : item,
      ),
    );
    pushHistoryEntry("裁切调整", 1, "crop");
  }

  function resetSelectedCrop() {
    if (!selectedFile?.cropSuggestedRect) return;
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
            }
          : item,
      ),
    );
    notify("info", "Crop reset", "恢复到自动建议框");
    pushHistoryEntry("裁切复位", 1, "crop-reset");
  }

  function setCurves(next: ManualCurves) {
    perfReset("curve-drag");
    const nr = next.r.map((p) => [...p] as [number, number]);
    const ng = next.g.map((p) => [...p] as [number, number]);
    const nb = next.b.map((p) => [...p] as [number, number]);
    perfMark("setCurves.state");
    setRCurve(nr);
    setGCurve(ng);
    setBCurve(nb);
    if (selectedFile) {
      fileCurvesRef.current.set(selectedFile.id, { r: nr, g: ng, b: nb });
    }
    if (curveHistoryTimerRef.current) clearTimeout(curveHistoryTimerRef.current);
    curveHistoryTimerRef.current = setTimeout(() => {
      pushHistoryEntry("曲线调整", 1, "curves");
    }, 1000);
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

  function toggleLayoutElement(target: "library" | "filmstrip" | "inspector" | "viewer-hud") {
    if (target === "library") {
      togglePreference("showLibraryPane");
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
    strength,
    setStrength,
    accelerator,
    setAccelerator,
    loading,
    highResLoading,
    onPickFiles,
    injectFiles,
    activeInspectorTab,
    setActiveInspectorTab,
    exportOptions,
    setExportOptions,
    exportResult,
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
    renderDocument,
    saveSession,
    refreshSavedSessions,
    loadSavedSession,
    deleteSavedSession,
    runAIEvaluation,
    updateSelectedCrop,
    resetSelectedCrop,
    dismissNotification,
    removeSelectedItem,
    clearWorkspace,
    selectRelativeItem,
    undo,
    redo,
    rCurve,
    gCurve,
    bCurve,
    setCurves,
    history,
    historyIndex,
  }), [
    backendOk, plugins, evaluators, capabilities, files, filteredFiles, fileCounts,
    selectedId, selectedFile, compareMode, splitPosition, viewerZoomMode, viewerZoomScale,
    viewerPan, mode, strength, accelerator, loading, activeInspectorTab, exportOptions,
    exportResult, documentRender, sessionOptions, sessionSaveResult, savedSessions,
    selectedEvaluator, aiContext, aiSettings, aiResult, notifications, activityLog,
    actionStates, sourceFilter, searchQuery, stageContainerSize, preferences, layoutState,
    rCurve, gCurve, bCurve, history, historyIndex, setAISettingsAndSave,
  ]);
}

export type WorkbenchController = ReturnType<typeof useWorkbench>;
