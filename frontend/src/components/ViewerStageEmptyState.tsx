import { t } from "../i18n";

export function ViewerStageEmptyState() {
  return (
    <div className="pc-stage-empty">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <polyline points="21 15 16 10 5 21" />
      </svg>
      <strong>{t("viewer.empty")}</strong>
    </div>
  );
}
