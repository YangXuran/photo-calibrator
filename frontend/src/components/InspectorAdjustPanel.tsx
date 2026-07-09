import { useRef, type PointerEvent } from "react";
import { MODE_OPTIONS } from "../constants";
import type { WorkbenchController } from "../hooks/useWorkbench";
import { t } from "../i18n";
import type { AutoStyleSettings } from "../types";
import { InspectorPanelSections } from "./InspectorPanelSections";
import { PaneSection } from "./PaneSection";

type InspectorAdjustPanelProps = {
  order?: string[];
  workbench: WorkbenchController;
};

const AUTO_STYLE_PRESETS: Array<{ key: AutoStyleSettings["preset"]; labelKey: string; style: AutoStyleSettings }> = [
  {
    key: "neutral",
    labelKey: "adjust.styleNeutral",
    style: { preset: "neutral", neutralization: 0.9, lookPreservation: 0.05, warmthBias: 0, tintBias: 0, toneStyle: 0.12, highlightProtection: 0.35, skinPriority: 0.15 },
  },
  {
    key: "film",
    labelKey: "adjust.styleFilm",
    style: { preset: "film", neutralization: 0.56, lookPreservation: 0.92, warmthBias: 0.22, tintBias: 0, toneStyle: 0.1, highlightProtection: 0.68, skinPriority: 0.2 },
  },
  {
    key: "portrait",
    labelKey: "adjust.stylePortrait",
    style: { preset: "portrait", neutralization: 0.72, lookPreservation: 0.42, warmthBias: 0.16, tintBias: 0.04, toneStyle: -0.08, highlightProtection: 0.55, skinPriority: 0.95 },
  },
  {
    key: "slide",
    labelKey: "adjust.styleSlide",
    style: { preset: "slide", neutralization: 0.88, lookPreservation: 0.36, warmthBias: 0.04, tintBias: 0, toneStyle: 0.82, highlightProtection: 0.58, skinPriority: 0.1 },
  },
  {
    key: "soft",
    labelKey: "adjust.styleSoft",
    style: { preset: "soft", neutralization: 0.55, lookPreservation: 0.58, warmthBias: 0.12, tintBias: 0, toneStyle: -0.82, highlightProtection: 0.78, skinPriority: 0.2 },
  },
];

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function clampSigned(value: number): number {
  return Math.min(1, Math.max(-1, value));
}

function expandSignedStyleAxis(value: number): number {
  const signed = clampSigned(value);
  if (Math.abs(signed) < 0.001) return 0;
  return Math.sign(signed) * Math.pow(Math.abs(signed), 0.82);
}

export function InspectorAdjustPanel({ order, workbench }: InspectorAdjustPanelProps) {
  const collapseScope = "workbench";
  const autoBest = workbench.selectedFile?.result?.processing?.auto_best;
  const selectedAutoMode = workbench.selectedFile?.result?.processing?.auto_best_selected_mode;
  const style = workbench.autoStyle;
  const tone = workbench.toneRecovery;
  const toneAnalysis = workbench.selectedFile?.result?.processing?.tone_recovery;
  const styleMapRef = useRef<HTMLDivElement>(null);
  const colorCompassRef = useRef<HTMLDivElement>(null);
  const castA = workbench.selectedFile?.result?.input?.lab?.a_mean ?? 0;
  const castB = workbench.selectedFile?.result?.input?.lab?.b_star_mean ?? 0;
  const castLeft = 50 + clampSigned(castA / 18) * 42;
  const castTop = 50 - clampSigned(castB / 18) * 42;

  const updateStyleMapFromPointer = (event: PointerEvent<HTMLDivElement>, commit: boolean) => {
    const rect = styleMapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = clamp01((event.clientX - rect.left) / Math.max(rect.width, 1));
    const y = clamp01((event.clientY - rect.top) / Math.max(rect.height, 1));
    const preserve = Math.pow(x, 0.82);
    const toneStyle = expandSignedStyleAxis(1 - y * 2);
    const next = {
      ...style,
      preset: "custom" as const,
      lookPreservation: preserve,
      toneStyle,
      neutralization: clamp01(0.98 - preserve * 0.34 + Math.max(0, toneStyle) * 0.04 - Math.max(0, -toneStyle) * 0.1),
      highlightProtection: clamp01(0.18 + preserve * 0.2 + Math.max(0, toneStyle) * 0.5 + Math.max(0, -toneStyle) * 0.35),
    };
    if (commit) workbench.commitAutoStyle(next, t("history.autoStyle"));
    else workbench.previewAutoStyle(next);
  };

  const updateColorCompassFromPointer = (event: PointerEvent<HTMLDivElement>, commit: boolean) => {
    const rect = colorCompassRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = clamp01((event.clientX - rect.left) / Math.max(rect.width, 1));
    const y = clamp01((event.clientY - rect.top) / Math.max(rect.height, 1));
    const next = {
      ...style,
      preset: "custom" as const,
      tintBias: clampSigned(x * 2 - 1),
      warmthBias: clampSigned(1 - y * 2),
    };
    if (commit) workbench.commitAutoStyle(next, t("history.autoColorBias"));
    else workbench.previewAutoStyle(next);
  };

  return (
    <InspectorPanelSections
      order={order}
      sections={[
        {
          key: "main-calibration",
          content: (
            <PaneSection
              collapseStorageScope={collapseScope}
              collapseStorageKey="inspector-adjust-main-calibration"
              collapsible
              emphasis="primary"
              testId="main-calibration-section"
              title={t("adjust.title")}
            >
              <div className="pc-form-stack">
                <label className="pc-field pc-field-checkbox">
                  <input
                    checked={workbench.negativeBaseEnabled}
                    data-testid="negative-base-toggle"
                    onChange={(event) => workbench.setNegativeBaseCommitted(event.currentTarget.checked)}
                    type="checkbox"
                  />
                  <span>{t("adjust.negativeBase")}</span>
                </label>
                <label className="pc-field">
                  <span>{t("adjust.mode")}</span>
                  <select data-testid="mode-select" onChange={(event) => workbench.setModeCommitted(event.target.value)} value={workbench.mode}>
                    {MODE_OPTIONS.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  {workbench.mode === "auto-best" && selectedAutoMode ? (
                    <span className="pc-field-hint" data-testid="auto-best-result">
                      {t("adjust.selectedModeScore", { mode: selectedAutoMode, score: workbench.selectedFile?.result?.processing?.auto_best_score?.toFixed(2) ?? "-" })}
                    </span>
                  ) : null}
                  {workbench.mode === "auto-best" && autoBest?.candidates?.length ? (
                    <span className="pc-field-hint" data-testid="auto-best-candidates">
                      {t("adjust.candidates", { candidates: autoBest.candidates.slice(0, 3).map((item) => `${item.mode} ${item.score.toFixed(1)}`).join(" / ") })}
                    </span>
                  ) : null}
                </label>
                <label className="pc-field">
                  <span>{t("adjust.strength", { value: workbench.strength.toFixed(2) })}</span>
                  <input
                    data-testid="strength-input"
                    max={1.2}
                    min={0}
                    onBlur={(event) => workbench.commitStrength(Number(event.currentTarget.value))}
                    onChange={(event) => workbench.previewAutoStyle({ ...style, neutralization: Number(event.target.value) })}
                    onKeyDown={() => workbench.beginEdit()}
                    onKeyUp={(event) => workbench.commitStrength(Number(event.currentTarget.value))}
                    onPointerDown={() => workbench.beginEdit()}
                    onPointerUp={(event) => workbench.commitStrength(Number(event.currentTarget.value))}
                    step={0.05}
                    type="range"
                    value={workbench.strength}
                  />
                </label>
                <div className="pc-auto-style-presets" data-testid="auto-style-presets">
                  {AUTO_STYLE_PRESETS.map((preset) => (
                    <button
                      className={style.preset === preset.key ? "is-active" : ""}
                      data-testid={`auto-style-preset-${preset.key}`}
                      key={preset.key}
                      onClick={() => {
                        workbench.beginEdit();
                        workbench.commitAutoStyle(preset.style, t("history.autoStylePreset", { preset: t(preset.labelKey) }));
                      }}
                      type="button"
                    >
                      {t(preset.labelKey)}
                    </button>
                  ))}
                </div>
                <div className="pc-style-map-group">
                  <div className="pc-style-map-head">
                    <span>{t("adjust.styleMap")}</span>
                    <span>{t("adjust.styleMapValue", { preserve: Math.round(style.lookPreservation * 100), tone: Math.round(style.toneStyle * 100) })}</span>
                  </div>
                  <div
                    className="pc-style-map"
                    data-testid="auto-style-map"
                    onPointerDown={(event) => {
                      workbench.beginEdit();
                      event.currentTarget.setPointerCapture(event.pointerId);
                      updateStyleMapFromPointer(event, false);
                    }}
                    onPointerMove={(event) => {
                      if ((event.buttons & 1) === 1) updateStyleMapFromPointer(event, false);
                    }}
                    onPointerUp={(event) => updateStyleMapFromPointer(event, true)}
                    ref={styleMapRef}
                  >
                    <span className="pc-style-map-label pc-style-map-top">{t("adjust.styleMapTop")}</span>
                    <span className="pc-style-map-label pc-style-map-bottom">{t("adjust.styleMapBottom")}</span>
                    <span className="pc-style-map-label pc-style-map-left">{t("adjust.styleMapLeft")}</span>
                    <span className="pc-style-map-label pc-style-map-right">{t("adjust.styleMapRight")}</span>
                    <span
                      className="pc-style-map-handle"
                      style={{
                        left: `${style.lookPreservation * 100}%`,
                        top: `${(1 - (style.toneStyle + 1) / 2) * 100}%`,
                      }}
                    />
                  </div>
                </div>
                <div className="pc-style-map-group">
                  <div className="pc-style-map-head">
                    <span>{t("adjust.colorCompass")}</span>
                    <span>{t("adjust.colorCompassValue", { tint: Math.round(style.tintBias * 100), warmth: Math.round(style.warmthBias * 100) })}</span>
                  </div>
                  <div
                    className="pc-color-compass"
                    data-testid="auto-color-compass"
                    onPointerDown={(event) => {
                      workbench.beginEdit();
                      event.currentTarget.setPointerCapture(event.pointerId);
                      updateColorCompassFromPointer(event, false);
                    }}
                    onPointerMove={(event) => {
                      if ((event.buttons & 1) === 1) updateColorCompassFromPointer(event, false);
                    }}
                    onPointerUp={(event) => updateColorCompassFromPointer(event, true)}
                    ref={colorCompassRef}
                  >
                    <span className="pc-style-map-label pc-style-map-top">{t("adjust.colorWarm")}</span>
                    <span className="pc-style-map-label pc-style-map-bottom">{t("adjust.colorCool")}</span>
                    <span className="pc-style-map-label pc-style-map-left">{t("adjust.colorGreen")}</span>
                    <span className="pc-style-map-label pc-style-map-right">{t("adjust.colorMagenta")}</span>
                    <span className="pc-color-compass-cast" style={{ left: `${castLeft}%`, top: `${castTop}%` }} />
                    <span
                      className="pc-style-map-handle"
                      style={{
                        left: `${(style.tintBias + 1) * 50}%`,
                        top: `${(1 - (style.warmthBias + 1) / 2) * 100}%`,
                      }}
                    />
                  </div>
                  <span className="pc-field-hint">{t("adjust.colorCompassHint")}</span>
                </div>
              </div>
            </PaneSection>
          ),
        },
        {
          key: "tone-recovery",
          content: (
            <PaneSection
              collapseStorageScope={collapseScope}
              collapseStorageKey="inspector-adjust-tone-recovery"
              collapsible
              testId="tone-recovery-section"
              title={t("adjust.toneTitle")}
            >
              <div className="pc-form-stack">
                <label className="pc-field pc-field-checkbox">
                  <input
                    checked={tone.enabled}
                    data-testid="tone-recovery-toggle"
                    onChange={(event) => workbench.setToneRecoveryCommitted({ ...tone, enabled: event.currentTarget.checked })}
                    type="checkbox"
                  />
                  <span>{t("adjust.toneEnable")}</span>
                </label>
                <label className="pc-field">
                  <span>{t("adjust.toneStrength", { value: tone.strength.toFixed(2) })}</span>
                  <input
                    data-testid="tone-recovery-strength"
                    disabled={!tone.enabled}
                    max={1}
                    min={0}
                    onBlur={(event) => workbench.commitToneRecovery({ ...tone, strength: Number(event.currentTarget.value) })}
                    onChange={(event) => workbench.previewToneRecovery({ ...tone, strength: Number(event.target.value) })}
                    onKeyDown={() => workbench.beginEdit()}
                    onKeyUp={(event) => workbench.commitToneRecovery({ ...tone, strength: Number(event.currentTarget.value) })}
                    onPointerDown={() => workbench.beginEdit()}
                    onPointerUp={(event) => workbench.commitToneRecovery({ ...tone, strength: Number(event.currentTarget.value) })}
                    step={0.05}
                    type="range"
                    value={tone.strength}
                  />
                </label>
                {toneAnalysis?.enabled ? (
                  <span className="pc-field-hint" data-testid="tone-recovery-analysis">
                    {t("adjust.toneAnalysis", {
                      range: Math.round((toneAnalysis.dynamic_range ?? 0) * 100),
                      black: Math.round((toneAnalysis.black_point ?? 0) * 100),
                      white: Math.round((toneAnalysis.white_point ?? 1) * 100),
                      strength: Number(toneAnalysis.recommended_strength ?? 0).toFixed(2),
                    })}
                  </span>
                ) : null}
              </div>
            </PaneSection>
          ),
        },
      ]}
    />
  );
}
