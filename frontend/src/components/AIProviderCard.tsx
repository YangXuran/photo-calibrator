import { useEffect, useState } from "react";
import type { WorkbenchController } from "../hooks/useWorkbench";
import { PaneSection } from "./PaneSection";

const AI_SETTINGS_KEY = "photo-calibrator-ai-settings";

export type AIProviderSettings = {
  type: "openai_compatible" | "mock";
  base_url: string;
  model: string;
  api_key: string;
};

const DEFAULTS: AIProviderSettings = {
  type: "openai_compatible",
  base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  model: "qwen3.7-plus",
  api_key: "",
};

export function loadAISettings(): AIProviderSettings {
  try {
    const raw = window.localStorage.getItem(AI_SETTINGS_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULTS };
}

export function saveAISettings(settings: AIProviderSettings) {
  window.localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(settings));
}

type AIProviderCardProps = {
  settings: AIProviderSettings;
  onChange: (s: AIProviderSettings) => void;
};

export function AIProviderCard({ settings, onChange }: AIProviderCardProps) {
  const [apiKeyVisible, setApiKeyVisible] = useState(false);

  function update<K extends keyof AIProviderSettings>(key: K, value: AIProviderSettings[K]) {
    onChange({ ...settings, [key]: value });
  }

  return (
    <PaneSection density="compact" testId="ai-provider-section" title="AI Provider">
      <div className="pc-form-stack">
        <label className="pc-field">
          <span>类型</span>
          <select value={settings.type} onChange={(e) => update("type", e.target.value as AIProviderSettings["type"])}>
            <option value="openai_compatible">OpenAI 兼容</option>
            <option value="mock">Mock (测试)</option>
          </select>
        </label>

        {settings.type === "openai_compatible" ? (
          <>
            <label className="pc-field">
              <span>Base URL</span>
              <input value={settings.base_url} onChange={(e) => update("base_url", e.target.value)} placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1" />
            </label>
            <label className="pc-field">
              <span>Model</span>
              <input value={settings.model} onChange={(e) => update("model", e.target.value)} placeholder="qwen3.7-plus" />
            </label>
            <label className="pc-field">
              <span>API Key</span>
              <div className="pc-field-row">
                <input className="pc-field-input-flex" type={apiKeyVisible ? "text" : "password"} value={settings.api_key} onChange={(e) => update("api_key", e.target.value)} placeholder="sk-..." />
                <button className="pc-api-key-toggle" onClick={() => setApiKeyVisible(!apiKeyVisible)} type="button">
                  {apiKeyVisible ? "隐藏" : "显示"}
                </button>
              </div>
            </label>
          </>
        ) : null}

        </div>
      </PaneSection>
  );
}
