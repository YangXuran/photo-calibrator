export type CompareMode = "side-by-side" | "split" | "calibrated-only";
export type ViewerZoomMode = "fit" | "fill" | "manual";
export type InspectorTab = "adjust" | "look" | "curves" | "compose" | "ai" | "export" | "session" | "settings";

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
  showAnalysisPane: boolean;
  showInspectorPane: boolean;
  showFilmstrip: boolean;
  showViewerHud: boolean;
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

export type LookWheel = {
  hue: number;
  saturation: number;
  luminance: number;
};

export type LookAdjustments = {
  labBias: {
    a: number;
    b: number;
  };
  colorGrade: {
    shadows: LookWheel;
    midtones: LookWheel;
    highlights: LookWheel;
    global: LookWheel;
    blending: number;
    balance: number;
  };
  pointColor: {
    enabled: boolean;
    hue: number;
    range: number;
    hueShift: number;
    saturation: number;
    luminance: number;
  };
};

export type ToneRecoverySettings = {
  enabled: boolean;
  auto: boolean;
  strength: number;
};

export type ToneRecoveryAnalysis = ToneRecoverySettings & {
  black_point?: number;
  white_point?: number;
  midtone?: number;
  dynamic_range?: number;
  recommended_strength?: number;
  local_contrast?: number;
  applied_strength?: number;
  applied_local_contrast?: number;
  source?: string;
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
    calibrated_rgb_histogram?: HistogramPayload;
    lab_vectors?: LabVector[];
    strengths?: Array<{ name: string; value: number }>;
    zones?: ZoneDatum[];
    ccc?: {
      mu_a: number;
      mu_b: number;
      sigma_a: number;
      sigma_b: number;
      mu: number;
      sigma: number;
      distance: number;
      d_sigma: number;
      k: number;
    };
    pci?: {
      value: number;
      weighted_delta?: number;
      luminance_factor?: number;
    };
    neutral_mask?: {
      coverage: number;
      pixels: number;
      total: number;
    };
    rgb_means?: {
      input: { r: number; g: number; b: number };
      output: { r: number; g: number; b: number };
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
    crop_rect?: CropRect | null;
    crop_applied?: boolean;
    analysis_basis?: string;
    negative_base_enabled?: boolean;
    requested_mode?: string;
    auto_best_selected_mode?: string;
    auto_best_score?: number;
    auto_best?: {
      selected_mode: string;
      score: number;
      eval_max_side?: number;
      candidates: Array<{
        mode: string;
        score: number;
        input_strength: number;
        output_strength: number;
        reduction_pct: number;
      }>;
    };
    look_enabled?: boolean;
    look_adjustments?: Record<string, unknown>;
    tone_recovery_enabled?: boolean;
    tone_recovery?: ToneRecoveryAnalysis;
  };
  document?: Record<string, unknown>;
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
  file?: File | { name: string; path: string } | null;
  name: string;
  displayUrl: string;
  thumbnailUrl: string;
  browserDisplayable: boolean;
  sessionId?: string;
  sessionPath?: string;
  result?: CalibrationPayload;
  preview?: PreviewPayload;
  highResPreview?: PreviewPayload;
  crop?: CropPayload;
  cropSuggestedRect?: CropRect;
  cropEdited?: boolean;
  cropApplied?: boolean;
  imageTransform?: ImageTransform;
  thumbnailLoading?: boolean;
  calibrationSignature?: string;
  lCurve?: ChannelCurve;
  rCurve?: ChannelCurve;
  gCurve?: ChannelCurve;
  bCurve?: ChannelCurve;
  workspaceRoot?: string;
  persistentSessionId?: string;
  persistedState?: PersistedEditState;
  persistedHistory?: HistoryEntry[];
  persistedHistoryIndex?: number;
  historyPersistent?: boolean;
};

export type CropRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type ImageTransform = {
  rotation: number;
  flipH: boolean;
  flipV: boolean;
};

export type CropEdgeCandidate = {
  trim: number;
  score: number;
  source?: string;
};

export type CropBandSample = CropEdgeCandidate & {
  band_start: number;
  band_end: number;
  band_axis: "x" | "y";
};

export type CropEdgeDiagnostics = {
  anchor?: number;
  weighted_trim?: number | null;
  merged_candidates?: number[];
  global_candidates?: CropEdgeCandidate[];
  band_samples?: CropBandSample[];
};

export type CropDiagnostics = {
  image_width?: number;
  image_height?: number;
  detect_width?: number;
  detect_height?: number;
  hough_crop?: CropRect;
  detected_crop?: CropRect;
  selected_crop?: CropRect;
  safe_inset?: {
    x: number;
    y: number;
    ratio: number;
  };
  edges?: {
    left?: CropEdgeDiagnostics;
    right?: CropEdgeDiagnostics;
    top?: CropEdgeDiagnostics;
    bottom?: CropEdgeDiagnostics;
  };
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
    debug?: CropDiagnostics | null;
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

export type BatchExportItemResult = {
  file_id: string;
  file_name: string;
  ok: boolean;
  path?: string;
  error?: string;
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
  l: ChannelCurve;
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
  sequence_no?: number;
  before_state?: PersistedEditState;
  after_state?: PersistedEditState;
};

export type PersistedEditState = {
  mode: string;
  strength: number;
  negativeBaseEnabled?: boolean;
  accelerator: string;
  curves: ManualCurves;
  crop?: CropPayload;
  cropEdited?: boolean;
  cropApplied?: boolean;
  imageTransform?: ImageTransform;
  lookAdjustments?: LookAdjustments;
  toneRecovery?: ToneRecoverySettings;
  runtimeSessionId?: string;
};
