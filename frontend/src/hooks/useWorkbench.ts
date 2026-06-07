import { useEffect, useMemo, useRef, useState } from "react";
import { fetchAIEvaluators, fetchCapabilities, fetchHealth, fetchPlugins, fetchSessionList, fetchSessionLoad, postAIEvaluate, postCalibration, postCalibrationSession, postDocumentRender, postExport, postFilmScan, postPreview, postSessionDelete, postSessionSave } from "../lib/api";
import { fileToDataUrl, isBrowserDisplayable, workspaceFileId } from "../lib/files";
import { DEFAULT_WORKBENCH_PREFERENCES, getDefaultInspectorTabForPreset, getDefaultViewerStateForPreset, getLayoutPresetDefinition, getLayoutPresetPreferences, getMatchingLayoutPreset } from "../lib/layoutPresets";
import { suggestExportPath, suggestSessionPath } from "../lib/paths";
import type {
  ActionState,
  AIEvaluationPayload,
  CalibrationPayload,
  CapabilityPayload,
  ChannelCurve,
  CompareMode,
  CropRect,
  DocumentRenderPayload,
  EvaluatorInfo,
  ExportPayload,
  HistoryEntry,
  InspectorTab,
  LayoutPresetId,
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
const WORKBENCH_INSPECTOR_TABS_KEY = "photo-calibrator:workbench-inspector-tabs";
const WORKBENCH_VIEWER_STATES_KEY = "photo-calibrator:workbench-viewer-states";

export type PickedFiles = FileList | File[] | null;

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

function loadInspectorTabsByPreset(): Partial<Record<LayoutPresetId | "custom", InspectorTab>> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(WORKBENCH_INSPECTOR_TABS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<Record<LayoutPresetId | "custom", InspectorTab>>;
  } catch {
    return {};
  }
}

function loadViewerStatesByPreset(): Partial<Record<LayoutPresetId | "custom", ViewerWorkspaceState>> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(WORKBENCH_VIEWER_STATES_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<Record<LayoutPresetId | "custom", ViewerWorkspaceState>>;
  } catch {
    return {};
  }
}

export function useWorkbench() {
  const [backendOk, setBackendOk] = useState<boolean | null>(null);
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [evaluators, setEvaluators] = useState<EvaluatorInfo[]>([]);
  const [capabilities, setCapabilities] = useState<CapabilityPayload | null>(null);
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [viewerStatesByPreset, setViewerStatesByPreset] = useState<Partial<Record<LayoutPresetId | "custom", ViewerWorkspaceState>>>(() => loadViewerStatesByPreset());
  const [mode, setMode] = useState("global");
  const [strength, setStrength] = useState(0.8);
  const [accelerator, setAccelerator] = useState("auto");
  const [loading, setLoading] = useState(false);
  const [inspectorTabsByPreset, setInspectorTabsByPreset] = useState<Partial<Record<LayoutPresetId | "custom", InspectorTab>>>(() => loadInspectorTabsByPreset());
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
  const [sessionSaveResult, setSessionSaveResult] = useState<SessionSavePayload | null>(null);
  const [savedSessions, setSavedSessions] = useState<SessionListItem[]>([]);
  const [selectedEvaluator, setSelectedEvaluator] = useState("__default__");
  const [aiContext, setAiContext] = useState("还原真实白平衡，同时保留胶片感。");
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
  const requestRef = useRef(0);
  /* undo stack for calibration parameters (mode + strength + accelerator) */
  type UndoSnapshot = { mode: string; strength: number; accelerator: string };
  const undoStackRef = useRef<UndoSnapshot[]>([]);
  const undoIndexRef = useRef(-1);
  const undoingRef = useRef(false);
  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const activeLayoutPreset = useMemo(() => getMatchingLayoutPreset(preferences), [preferences]);
  const activeInspectorTab = useMemo(
    () => inspectorTabsByPreset[activeLayoutPreset] ?? getDefaultInspectorTabForPreset(activeLayoutPreset),
    [activeLayoutPreset, inspectorTabsByPreset],
  );
  const activeViewerState = useMemo(
    () => viewerStatesByPreset[activeLayoutPreset] ?? getDefaultViewerStateForPreset(activeLayoutPreset),
    [activeLayoutPreset, viewerStatesByPreset],
  );
  const compareMode = activeViewerState.compareMode;
  const splitPosition = activeViewerState.splitPosition;
  const viewerZoomMode = activeViewerState.zoomMode;
  const viewerZoomScale = activeViewerState.zoomScale;
  const viewerPan = activeViewerState.pan;

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
    setInspectorTabsByPreset((current) => ({
      ...current,
      [activeLayoutPreset]: tab,
    }));
  }

  function updateActiveViewerState(patch: Partial<ViewerWorkspaceState>) {
    setViewerStatesByPreset((current) => ({
      ...current,
      [activeLayoutPreset]: {
        ...(current[activeLayoutPreset] ?? getDefaultViewerStateForPreset(activeLayoutPreset)),
        ...patch,
      },
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
    window.localStorage.setItem(WORKBENCH_INSPECTOR_TABS_KEY, JSON.stringify(inspectorTabsByPreset));
  }, [inspectorTabsByPreset]);

  useEffect(() => {
    window.localStorage.setItem(WORKBENCH_VIEWER_STATES_KEY, JSON.stringify(viewerStatesByPreset));
  }, [viewerStatesByPreset]);

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
    undoingRef.current = false;
  }

  useEffect(() => {
    if (!selectedFile) return;
    const currentRequest = ++requestRef.current;
    const run = async () => {
      setLoading(true);
      setActionState("calibration", "running", selectedFile.name);
      try {
        let payload: CalibrationPayload;
        const curvePayload = mode === "rgb-curves" ? { r_curve: rCurve, g_curve: gCurve, b_curve: bCurve } : {};
        if (selectedFile.sessionId) {
          payload = await postCalibrationSession({
            session_id: selectedFile.sessionId,
            mode,
            strength,
            accelerator,
            include_original: false,
            ...curvePayload,
          });
        } else {
          if (!selectedFile.file) return;
          const imageData = await fileToDataUrl(selectedFile.file);
          payload = await postCalibration({
            image_data: imageData,
            file_name: selectedFile.name,
            mode,
            strength,
            accelerator,
            ...curvePayload,
          });
        }
        if (currentRequest !== requestRef.current) return;
        setFiles((items) =>
          items.map((item) =>
            item.id === selectedFile.id
              ? {
                  ...item,
                  sessionId: payload.session_id ?? item.sessionId,
                  result: payload,
                  thumbnailUrl: item.browserDisplayable ? item.thumbnailUrl : payload.original_preview ?? item.thumbnailUrl,
                }
              : item,
          ),
        );
        setDocumentRender(null);
        setAiResult(null);
        setActionState("calibration", "success", payload.session_id ?? selectedFile.name);
        const opCount = payload.processing ? 1 : 0;
        pushHistoryEntry(`${mode} / ${strength.toFixed(2)}`, opCount, mode);
      } catch (error) {
        if (currentRequest === requestRef.current) {
          console.error(error);
          setActionState("calibration", "error", String(error));
          notify("error", "Calibration failed", String(error));
        }
      } finally {
        if (currentRequest === requestRef.current) setLoading(false);
      }
    };
    const timer = window.setTimeout(run, 160);
    return () => window.clearTimeout(timer);
  }, [selectedFile?.id, mode, strength, accelerator, rCurve, gCurve, bCurve]);

  /* push calibration snapshots to undo stack (debounced 600ms) */
  useEffect(() => {
    if (undoingRef.current) return;
    const prevTimer = pushTimerRef.current;
    if (prevTimer) clearTimeout(prevTimer);
    pushTimerRef.current = setTimeout(() => {
      const snap: UndoSnapshot = { mode, strength, accelerator };
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
  }, [mode, strength, accelerator]);

  useEffect(() => {
    if (!selectedFile) return;
    updateActiveViewerState({ pan: { x: 0, y: 0 } });
    setExportOptions((current) => ({
      ...current,
      outputPath: suggestExportPath(selectedFile.name, current.format),
    }));
    setSessionOptions({
      savePath: suggestSessionPath(selectedFile.name),
    });
    setExportResult(null);
    setSessionSaveResult(null);
    setRCurve(DEFAULT_IDENTITY_CURVE.map((p) => [...p] as [number, number]));
    setGCurve(DEFAULT_IDENTITY_CURVE.map((p) => [...p] as [number, number]));
    setBCurve(DEFAULT_IDENTITY_CURVE.map((p) => [...p] as [number, number]));
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

  async function hydrateNonDisplayablePreviews(nextFiles: WorkspaceFile[]) {
    for (const item of nextFiles) {
      if (item.browserDisplayable || item.preview) continue;
      if (!item.file) continue;
      try {
        const filePath = (item.file as any)?.path as string | undefined;
        let body: Record<string, unknown> = { file_name: item.name, analysis_max_side: 320 };
        if (filePath) {
          // Send file path instead of reading the full file into a data URL
          body.path = filePath;
        } else {
          body.image_data = await fileToDataUrl(item.file);
        }
        const preview = await postPreview(body);
        setFiles((existing) =>
          existing.map((entry) =>
            entry.id === item.id
              ? {
                  ...entry,
                  sessionId: preview.session_id,
                  preview,
                  thumbnailUrl: preview.original_preview,
                  displayUrl: preview.original_preview,
                }
              : entry,
          ),
        );
      } catch (error) {
        console.error(error);
      }
    }
  }

  function onPickFiles(fileList: PickedFiles) {
    const pickedFiles = fileList ? Array.from(fileList) : [];
    if (!pickedFiles.length) return;
    const nextFiles = pickedFiles.map((file) => {
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
      } satisfies WorkspaceFile;
    });
    setFiles(nextFiles);
    setSelectedId(nextFiles[0]?.id);
    void hydrateNonDisplayablePreviews(nextFiles);
  }

  async function runFilmScan() {
    if (!selectedFile) return;
    try {
      setActionState("filmScan", "running", selectedFile.name);
      const payload = selectedFile.sessionId
        ? await postFilmScan({ session_id: selectedFile.sessionId })
        : await postFilmScan({
            image_data: await fileToDataUrl(selectedFile.file!),
            file_name: selectedFile.name,
          });
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
      const payload = await postExport({
        image_data: await fileToDataUrl(selectedFile.file),
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
      });
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
      const payload = await postAIEvaluate({
        session_id: selectedFile.sessionId,
        evaluator_name: selectedEvaluator,
        mode,
        strength,
        context: aiContext,
        timeout_ms: 15000,
        allow_failure: true,
      });
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
  }

  function setCurves(next: ManualCurves) {
    setRCurve(next.r.map((p) => [...p] as [number, number]));
    setGCurve(next.g.map((p) => [...p] as [number, number]));
    setBCurve(next.b.map((p) => [...p] as [number, number]));
  }

  function pushHistoryEntry(description: string, operationCount: number, currentOpName: string) {
    const now = new Date();
    const timestamp = [now.getHours(), now.getMinutes(), now.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
    const entry: HistoryEntry = { description, timestamp, operation_count: operationCount, current_op_name: currentOpName };
    setHistory((prev) => {
      const truncated = prev.slice(0, historyIndex + 1);
      const next = [...truncated, entry].slice(-50);
      setHistoryIndex(next.length - 1);
      return next;
    });
  }

  function dismissNotification(id: string) {
    setNotifications((current) => current.filter((item) => item.id !== id));
  }

  function removeSelectedItem() {
    if (!selectedFile) return;
    setFiles((current) => {
      const next = current.filter((item) => item.id !== selectedFile.id);
      const replacement = next[0]?.id;
      setSelectedId(replacement);
      return next;
    });
    notify("info", "Item removed", selectedFile.name);
  }

  function clearWorkspace() {
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
    updateActiveViewerState({
      zoomMode: mode,
      zoomScale: 1,
      pan: { x: 0, y: 0 },
    });
  }

  function setViewerManualScale(scale: number) {
    updateActiveViewerState({
      zoomMode: "manual",
      zoomScale: Math.max(0.5, Math.min(scale, 4)),
    });
  }

  function setViewerPanOffset(pan: ViewerPan) {
    updateActiveViewerState({
      pan: {
        x: Math.max(-1200, Math.min(1200, pan.x)),
        y: Math.max(-1200, Math.min(1200, pan.y)),
      },
    });
  }

  function zoomIn() {
    updateActiveViewerState({
      zoomMode: "manual",
      zoomScale: Math.min(4, Number((viewerZoomScale + 0.1).toFixed(2))),
    });
  }

  function zoomOut() {
    updateActiveViewerState({
      zoomMode: "manual",
      zoomScale: Math.max(0.5, Number((viewerZoomScale - 0.1).toFixed(2))),
    });
  }

  function resetViewerZoom() {
    updateActiveViewerState({
      zoomMode: "fit",
      zoomScale: 1,
      pan: { x: 0, y: 0 },
    });
  }

  function setCompareMode(mode: CompareMode) {
    updateActiveViewerState({ compareMode: mode });
  }

  function setSplitPosition(value: number) {
    updateActiveViewerState({ splitPosition: Math.max(10, Math.min(90, value)) });
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

  function applyLayoutPreset(preset: LayoutPresetId) {
    setPreferences(getLayoutPresetPreferences(preset));
    setViewerFocusMode(false);
    notify("info", "Layout preset applied", getLayoutPresetDefinition(preset).label);
  }

  function resetPreferences() {
    setPreferences(DEFAULT_WORKBENCH_PREFERENCES);
    setInspectorTabsByPreset((current) => ({
      ...current,
      analyze: getDefaultInspectorTabForPreset("analyze"),
      balanced: getDefaultInspectorTabForPreset("balanced"),
      custom: getDefaultInspectorTabForPreset("custom"),
      edit: getDefaultInspectorTabForPreset("edit"),
      review: getDefaultInspectorTabForPreset("review"),
    }));
    setViewerStatesByPreset((current) => ({
      ...current,
      analyze: getDefaultViewerStateForPreset("analyze"),
      balanced: getDefaultViewerStateForPreset("balanced"),
      custom: getDefaultViewerStateForPreset("custom"),
      edit: getDefaultViewerStateForPreset("edit"),
      review: getDefaultViewerStateForPreset("review"),
    }));
    setViewerFocusMode(false);
  }

  return {
    backendOk,
    plugins,
    evaluators,
    capabilities,
    files,
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
    onPickFiles,
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
    aiResult,
    notifications,
    activityLog,
    actionStates,
    sourceFilter,
    setSourceFilter,
    searchQuery,
    setSearchQuery,
    preferences,
    layoutState,
    activeLayoutPreset,
    updatePreference,
    togglePreference,
    toggleLayoutElement,
    toggleViewerFocusMode,
    applyLayoutPreset,
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
  };
}

export type WorkbenchController = ReturnType<typeof useWorkbench>;
