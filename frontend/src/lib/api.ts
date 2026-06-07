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
