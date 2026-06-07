import type { HistogramPayload } from "../types";
import { EmptyPanel } from "./EmptyPanel";

type HistogramChartProps = {
  histogram?: HistogramPayload;
};

function pathFor(values: number[], width: number, height: number): string {
  if (!values.length) return "";
  return values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * width;
      const y = height - value * height;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

export function HistogramChart({ histogram }: HistogramChartProps) {
  const width = 360;
  const height = 120;
  if (!histogram) return <EmptyPanel>暂无直方图</EmptyPanel>;
  return (
    <svg className="pc-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="RGB histogram">
      <path d={pathFor(histogram.channels.r.normalized, width, height)} className="pc-line-r" />
      <path d={pathFor(histogram.channels.g.normalized, width, height)} className="pc-line-g" />
      <path d={pathFor(histogram.channels.b.normalized, width, height)} className="pc-line-b" />
    </svg>
  );
}
