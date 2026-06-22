import type {
  CalibrationPayload,
  CapabilityPayload,
  CropPayload,
  DocumentRenderPayload,
  AIEvaluationPayload,
  EvaluatorInfo,
  ExportPayload,
  PluginInfo,
  PreviewPayload,
  SessionListPayload,
  SessionLoadPayload,
  SessionSavePayload,
  PersistedEditState,
} from "../types";
import { resolveRuntimeConfig } from "../runtime/config";

const runtimeConfig = resolveRuntimeConfig();

function apiUrl(path: string) {
  return `${runtimeConfig.apiBaseUrl}${path}`;
}

async function expectJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return (await response.json()) as T;
}

export async function fetchHealth(): Promise<{ ok: boolean }> {
  return expectJson(await fetch(apiUrl("/api/health")));
}

export async function fetchCapabilities(backend?: string): Promise<CapabilityPayload> {
  const suffix = backend ? `?backend=${encodeURIComponent(backend)}` : "";
  return expectJson(await fetch(apiUrl(`/api/capabilities${suffix}`)));
}

export async function fetchPlugins(): Promise<{ plugins: PluginInfo[] }> {
  return expectJson(await fetch(apiUrl("/api/plugins")));
}

export async function fetchAIEvaluators(): Promise<{ evaluators: EvaluatorInfo[] }> {
  return expectJson(await fetch(apiUrl("/api/ai-evaluators")));
}

export async function postPreview(body: object): Promise<PreviewPayload> {
  return expectJson(
    await fetch(apiUrl("/api/preview"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export async function postCalibration(body: object): Promise<CalibrationPayload> {
  return expectJson(
    await fetch(apiUrl("/api/calibrate"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export async function postCalibrationSession(body: object): Promise<CalibrationPayload> {
  return expectJson(
    await fetch(apiUrl("/api/calibrate-session"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export async function postFilmScan(body: object): Promise<CropPayload> {
  return expectJson(
    await fetch(apiUrl("/api/film-scan"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export async function postExport(body: object): Promise<ExportPayload> {
  return expectJson(
    await fetch(apiUrl("/api/export"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export async function postDocumentRender(body: object): Promise<DocumentRenderPayload> {
  return expectJson(
    await fetch(apiUrl("/api/document/render"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export async function postSessionSave(body: object): Promise<SessionSavePayload> {
  return expectJson(
    await fetch(apiUrl("/api/session/save"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export async function fetchSessionList(): Promise<SessionListPayload> {
  return expectJson(await fetch(apiUrl("/api/session/list")));
}

export async function fetchSessionLoad(path: string, newSessionId?: string): Promise<SessionLoadPayload> {
  const params = new URLSearchParams({ path });
  if (newSessionId) params.set("new_session_id", newSessionId);
  return expectJson(await fetch(apiUrl(`/api/session/load?${params.toString()}`)));
}

export async function postSessionDelete(body: object): Promise<{ ok: boolean; path: string; deleted: boolean }> {
  return expectJson(
    await fetch(apiUrl("/api/session/delete"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export async function postAIEvaluate(body: object): Promise<AIEvaluationPayload> {
  return expectJson(
    await fetch(apiUrl("/api/ai-evaluate"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export async function postBatchCalibrate(body: object): Promise<{ workers: number; results: { file_name: string; session_id?: string; ok?: boolean; error?: string }[] }> {
  return expectJson(
    await fetch(apiUrl("/api/calibrate-batch"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export async function fetchConfig(): Promise<Record<string, any>> {
  return expectJson(await fetch(apiUrl("/api/config")));
}

export async function putConfig(config: Record<string, any>): Promise<{ ok: boolean }> {
  return expectJson(
    await fetch(apiUrl("/api/config"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    }),
  );
}

export type WorkspaceOpenFile = {
  path: string;
  status: "fresh" | "restored" | "modified";
  persistent_session_id?: string;
  state?: PersistedEditState;
  history_cursor?: number;
  history?: Array<{ sequence_no: number; description: string; action_type: string; before_state?: PersistedEditState; after_state?: PersistedEditState; created_at: number }>;
  calibrated_image?: string;
};

export async function postWorkspaceOpen(body: object): Promise<{ ok: boolean; workspace_root: string; database_path: string; persistent: boolean; files: WorkspaceOpenFile[] }> {
  return expectJson(await fetch(apiUrl("/api/workspace/open"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
}

export async function postHistoryCommit(body: object): Promise<{ ok: boolean; history_cursor: number; history: any[] }> {
  return expectJson(await fetch(apiUrl("/api/history/commit"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
}

export async function postHistoryMove(path: "undo" | "redo", body: object): Promise<{ ok: boolean; history_cursor?: number; state?: PersistedEditState; calibrated_image?: string; history?: any[] }> {
  return expectJson(await fetch(apiUrl(`/api/history/${path}`), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
}
