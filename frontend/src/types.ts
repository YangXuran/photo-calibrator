export type CompareMode = "side-by-side" | "split" | "calibrated-only";
export type ViewerZoomMode = "fit" | "fill" | "manual";
export type InspectorTab = "adjust" | "analysis" | "export" | "session";
export type LayoutPresetId = "balanced" | "review" | "edit" | "analyze";
export type ActiveLayoutPreset = LayoutPresetId | "custom";
export type ViewerPan = {
  x: number;
  y: number;
};
export type ViewerWorkspaceState = {
  compareMode: CompareMode;
  splitPosition: number;
  zoomMode: ViewerZoomMode;
  zoomScale: number;
  pan: ViewerPan;
};

export type WorkbenchPreferences = {
  showLibraryPane: boolean;
  showInspectorPane: boolean;
  showPluginsPanel: boolean;
  showSelectionStatus: boolean;
  showSavedSessions: boolean;
  showActivityPanel: boolean;
  showFilmstrip: boolean;
  showViewerHud: boolean;
  showAdjustStatus: boolean;
  showAdjustQuickActions: boolean;
  showCropPanel: boolean;
  showAnalysisMetrics: boolean;
  showAnalysisCharts: boolean;
  showAnalysisContext: boolean;
  showAnalysisAIReview: boolean;
  showSessionCard: boolean;
  showWorkflowFeed: boolean;
};

export type PluginInfo = {
  id: string;
  name: string;
  version?: string;
  hooks?: string[];
  permissions?: string[];
};

export type EvaluatorInfo = {
  id: string;
  name: string;
  source?: string;
  supports_network?: boolean;
};

export type HistogramChannel = {
  normalized: number[];
  counts: number[];
  peak_bin: number;
};

export type HistogramPayload = {
  bins: number;
  channels: {
    r: HistogramChannel;
    g: HistogramChannel;
    b: HistogramChannel;
  };
};

export type LabVector = {
  name: string;
  a: number;
  b: number;
};

export type ZoneDatum = {
  name: string;
  a: number;
  b: number;
  pixels: number;
};

export type CalibrationPayload = {
  session_id?: string;
  original_preview?: string;
  calibrated_image: string;
  reduction_pct: number;
  input: {
    direction: string;
    lab: {
      strength: number;
      a_mean: number;
      b_star_mean: number;
    };
    skin?: {
      a: number;
      b: number;
      pixels: number;
    } | null;
    zones?: Record<string, { a_mean: number; b_mean: number; pixels: number }>;
  };
  output: {
    lab: {
      strength: number;
      a_mean: number;
      b_star_mean: number;
    };
  };
  charts?: {
    rgb_histogram?: HistogramPayload;
    lab_vectors?: LabVector[];
    strengths?: Array<{ name: string; value: number }>;
    zones?: ZoneDatum[];
    ccc?: {
      d_sigma: number;
    };
    pci?: {
      value: number;
    };
    neutral_mask?: {
      coverage: number;
      pixels: number;
      total: number;
    };
    lut_analysis?: LutAnalysisPayload;
  };
  processing?: {
    analysis_width?: number;
    analysis_height?: number;
    preview_source?: string;
    color_space?: string;
    data_range?: number[];
    accelerator_backend?: string;
    accelerator_requested?: string;
    original_width?: number;
    original_height?: number;
  };
};

export type PreviewPayload = {
  session_id: string;
  original_preview: string;
  processing?: {
    original_width?: number;
    original_height?: number;
    analysis_width?: number;
    analysis_height?: number;
    preview_source?: string;
  };
};

export type CapabilityPayload = {
  accelerator?: {
    backend?: string;
    requested_backend?: string;
    gpu_ops?: string[];
    cpu_fallback_ops?: string[];
    fallback_reason?: string;
    opencl_available?: boolean;
    opencl_enabled?: boolean;
  };
};

export type WorkspaceFile = {
  id: string;
  kind: "file" | "session";
  file?: File | null;
  name: string;
  displayUrl: string;
  thumbnailUrl: string;
  browserDisplayable: boolean;
  sessionId?: string;
  sessionPath?: string;
  result?: CalibrationPayload;
  preview?: PreviewPayload;
  crop?: CropPayload;
  cropSuggestedRect?: CropRect;
  cropEdited?: boolean;
};

export type CropRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type CropPayload = {
  session_id?: string;
  crop_rect: CropRect;
  film_scan?: {
    angle_deg?: number;
    confidence?: number;
    border_type?: string | null;
    film_format?: string | null;
    diagnosis?: string[];
  };
  processing?: {
    film_scan_source?: string;
    film_scan_plugin_id?: string | null;
    film_scan_plugin_name?: string | null;
    analysis_width?: number;
    analysis_height?: number;
  };
};

export type ExportPayload = {
  ok: boolean;
  path: string;
  format: string;
  size: number;
  elapsed_ms: number;
  export_settings?: {
    color_space?: string;
    bit_depth?: number;
    metadata_keys?: string[];
    icc_embedded?: boolean;
  };
};

export type DocumentRenderPayload = {
  ok: boolean;
  session_id: string;
  calibrated_image: string;
  document: {
    source?: string;
    operations?: Array<{
      name: string;
      replayable?: boolean;
      params?: Record<string, unknown>;
    }>;
    replayable_operations?: Array<Record<string, unknown>>;
  };
  output: CalibrationPayload["output"];
  processing?: {
    analysis_width?: number;
    analysis_height?: number;
    preview_source?: string;
    document_replayable_ops?: number;
  };
};

export type SessionSavePayload = {
  ok: boolean;
  path: string;
  session_id: string;
  size: number;
};

export type SessionListItem = {
  path: string;
  session_id: string;
  saved_at?: number;
  size: number;
  analysis_width?: number;
  analysis_height?: number;
  preview_source?: string;
  error?: string;
};

export type SessionListPayload = {
  sessions: SessionListItem[];
};

export type SessionLoadPayload = {
  ok: boolean;
  path: string;
  session_id: string;
  processing?: {
    analysis_width?: number;
    analysis_height?: number;
    preview_source?: string;
    color_space?: string;
    data_range?: number[];
  };
  session_metadata?: {
    session_id?: string;
  };
};

export type AIEvaluationPayload = {
  ok: boolean;
  session_id: string;
  evaluator_name: string;
  elapsed_ms?: number;
  evaluation?: {
    summary?: string;
    rationale?: string;
    confidence?: number;
    scores?: Array<{
      name: string;
      value: number;
      explanation?: string;
    }>;
    issues?: Array<{
      type?: string;
      severity?: string;
      message?: string;
    }>;
    suggestions?: Array<{
      operation?: string;
      confidence?: number;
      params?: Record<string, unknown>;
    }>;
  };
  request?: {
    status?: string;
    elapsed_ms?: number;
    provider?: {
      type?: string;
      name?: string;
      model?: string;
    } | null;
  };
  error?: string;
};

export type NotificationItem = {
  id: string;
  tone: "info" | "success" | "warning" | "error";
  title: string;
  message: string;
};

export type ActionState = {
  status: "idle" | "running" | "success" | "error";
  detail?: string;
};

export type SourceFilter = "all" | "file" | "session";

// ── Manual curve fine-tuning ─────────────────────────────────────────

export type CurvePoint = [number, number];

export type ChannelCurve = CurvePoint[];

export type ManualCurves = {
  r: ChannelCurve;
  g: ChannelCurve;
  b: ChannelCurve;
};

export const DEFAULT_IDENTITY_CURVE: ChannelCurve = [
  [0, 0],
  [64, 64],
  [128, 128],
  [192, 192],
  [255, 255],
];

// ── LUT analysis (spider-web / hue vectorscope) ──────────────────────

export type LutVectorPoint = {
  hue_angle: number;
  saturation: number;
  a_before: number;
  b_before: number;
  a_after: number;
  b_after: number;
  delta_a: number;
  delta_b: number;
};

export type LutAnalysisPayload = {
  vectors: LutVectorPoint[];
  source_mode: string;
  lut_size: number;
};

// ── History panel (action tracking) ──────────────────────────────────

export type HistoryEntry = {
  description: string;
  timestamp: string;
  operation_count: number;
  current_op_name: string;
};
