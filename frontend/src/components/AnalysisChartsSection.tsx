import type { CalibrationPayload } from "../types";
import { BarChart } from "./BarChart";
import { ChartPanel } from "./ChartPanel";
import { ChromaticityChart } from "./ChromaticityChart";
import { HistogramChart } from "./HistogramChart";
import { LabVectorChart } from "./LabVectorChart";
import { PaneSection } from "./PaneSection";

type AnalysisChartsSectionProps = {
  collapseScope?: string;
  result?: CalibrationPayload;
};

export function AnalysisChartsSection({ collapseScope, result }: AnalysisChartsSectionProps) {
  return (
    <PaneSection
      collapseStorageScope={collapseScope}
      collapseStorageKey="inspector-analysis-charts"
      collapsible
      defaultCollapsed
      testId="analysis-charts-section"
      title="分析图表"
      meta="backend 返回的结构化图表数据"
    >
      <div className="pc-analysis-grid">
        <ChartPanel title="RGB 直方图">
          <HistogramChart histogram={result?.charts?.rgb_histogram} />
        </ChartPanel>
        <ChartPanel title="Lab 向量">
          <LabVectorChart vectors={result?.charts?.lab_vectors} />
        </ChartPanel>
        <ChartPanel title="偏色强度">
          <BarChart items={result?.charts?.strengths} />
        </ChartPanel>
        {result?.charts?.lut_analysis ? (
          <ChartPanel title="LUT Vectorscope">
            <ChromaticityChart vectors={result.charts.lut_analysis.vectors} />
          </ChartPanel>
        ) : null}
      </div>
    </PaneSection>
  );
}
