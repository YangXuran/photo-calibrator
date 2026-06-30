import { EmptyPanel } from "./EmptyPanel";
import { t } from "../i18n";

type Datum = {
  name: string;
  value: number;
};

type BarChartProps = {
  items?: Datum[];
  format?: (value: number) => string;
};

export function BarChart({ items, format = (value) => value.toFixed(1) }: BarChartProps) {
  if (!items?.length) return <EmptyPanel>{t("common.noData")}</EmptyPanel>;
  const max = Math.max(...items.map((item) => item.value), 1);
  return (
    <div className="pc-bars">
      {items.map((item) => (
        <div className="pc-bar-row" key={item.name}>
          <span className="pc-bar-label">{item.name}</span>
          <div className="pc-bar-track">
            <div className="pc-bar-fill" style={{ width: `${(item.value / max) * 100}%` }} />
          </div>
          <strong className="pc-bar-value">{format(item.value)}</strong>
        </div>
      ))}
    </div>
  );
}
