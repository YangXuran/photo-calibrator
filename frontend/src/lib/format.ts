export function fmt(value?: number, digits = 1): string {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : "-";
}
