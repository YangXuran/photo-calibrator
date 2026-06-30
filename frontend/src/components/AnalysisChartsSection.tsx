import { useState } from "react";
import { t } from "../i18n";
import type { CalibrationPayload } from "../types";
import { BarChart } from "./BarChart";
import { ChartPanel } from "./ChartPanel";
import { HistogramChart } from "./HistogramChart";
import { LabVectorChart } from "./LabVectorChart";
import { LutRadarChart } from "./LutRadarChart";
import { PaneSection } from "./PaneSection";
import { ZoneChart } from "./ZoneChart";

type AnalysisChartsSectionProps = {
  collapseScope?: string;
  result?: CalibrationPayload;
};

function CccCard({ ccc }: { ccc?: Record<string, number> }) {
  if (!ccc) return null;
  return (
    <ChartPanel title={t("analysis.cccCircle")}>
      <div className="pc-metrics-row">
        <div className="pc-metric"><span className="pc-metric-label">μ</span><span className="pc-metric-value">{ccc.mu?.toFixed(1)}</span></div>
        <div className="pc-metric"><span className="pc-metric-label">σ</span><span className="pc-metric-value">{ccc.sigma?.toFixed(1)}</span></div>
        <div className="pc-metric"><span className="pc-metric-label">k</span><span className="pc-metric-value">{ccc.k?.toFixed(2)}</span></div>
        <div className="pc-metric"><span className="pc-metric-label">d/σ</span><span className="pc-metric-value">{ccc.d_sigma?.toFixed(2)}</span></div>
      </div>
    </ChartPanel>
  );
}

function PciCard({ pci }: { pci?: Record<string, number> }) {
  if (!pci) return null;
  return (
    <ChartPanel title={t("analysis.pciIndex")}>
      <div className="pc-metrics-row">
        <div className="pc-metric"><span className="pc-metric-label">PCI</span><span className="pc-metric-value">{pci.value?.toFixed(1)}</span></div>
        <div className="pc-metric"><span className="pc-metric-label">{t("analysis.weightedDelta")}</span><span className="pc-metric-value">{pci.weighted_delta?.toFixed(1)}</span></div>
        <div className="pc-metric"><span className="pc-metric-label">{t("analysis.luminanceFactor")}</span><span className="pc-metric-value">{pci.luminance_factor?.toFixed(2)}</span></div>
      </div>
    </ChartPanel>
  );
}

function RgbMeansCard({ rgb_means }: { rgb_means?: Record<string, Record<string, number>> }) {
  if (!rgb_means) return null;
  const inp = rgb_means.input;
  const out = rgb_means.output;
  return (
    <ChartPanel title={t("analysis.rgbMeans")}>
      <div className="pc-metrics-row">
        <div className="pc-metric"><span className="pc-metric-label">{t("analysis.inputOutputR")}</span><span className="pc-metric-value">{inp?.r?.toFixed(0)} → {out?.r?.toFixed(0)}</span></div>
        <div className="pc-metric"><span className="pc-metric-label">{t("analysis.inputOutputG")}</span><span className="pc-metric-value">{inp?.g?.toFixed(0)} → {out?.g?.toFixed(0)}</span></div>
        <div className="pc-metric"><span className="pc-metric-label">{t("analysis.inputOutputB")}</span><span className="pc-metric-value">{inp?.b?.toFixed(0)} → {out?.b?.toFixed(0)}</span></div>
      </div>
    </ChartPanel>
  );
}

export function AnalysisChartsSection({ collapseScope, result }: AnalysisChartsSectionProps) {
  const [showCalibrated, setShowCalibrated] = useState(true);
  const hasCalibrated = Boolean(result?.charts?.calibrated_rgb_histogram);

  return (
    <PaneSection
      collapseStorageScope={collapseScope}
      collapseStorageKey="inspector-analysis-charts"
      collapsible
      testId="analysis-charts-section"
      title={t("analysis.title")}
    >
      <div className="pc-analysis-grid">
        <ChartPanel
          title={t("analysis.rgbHistogram")}
          actions={
            hasCalibrated ? (
              <button className="pc-histogram-toggle" onClick={() => setShowCalibrated(!showCalibrated)} type="button">
                {showCalibrated ? t("analysis.calibrated") : t("analysis.original")}
              </button>
            ) : undefined
          }
        >
          <HistogramChart
            calibratedHistogram={result?.charts?.calibrated_rgb_histogram}
            histogram={result?.charts?.rgb_histogram}
            showCalibrated={showCalibrated}
          />
        </ChartPanel>
        <CccCard ccc={result?.charts?.ccc} />
        <PciCard pci={result?.charts?.pci} />
        <RgbMeansCard rgb_means={result?.charts?.rgb_means} />
        <ChartPanel title={t("analysis.zoneCast")}>
          <ZoneChart zones={result?.charts?.zones} />
        </ChartPanel>
        <ChartPanel title={t("analysis.labVector")}>
          <LabVectorChart vectors={result?.charts?.lab_vectors} />
        </ChartPanel>
        <ChartPanel title={t("analysis.castStrength")}>
          <BarChart items={result?.charts?.strengths} />
        </ChartPanel>
        {result?.charts?.lut_analysis ? (
          <ChartPanel title={t("analysis.lutRadar")}>
            <LutRadarChart vectors={result.charts.lut_analysis.vectors} />
          </ChartPanel>
        ) : null}
      </div>
    </PaneSection>
  );
}
