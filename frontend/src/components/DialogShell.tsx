import { useEffect, type ReactNode } from "react";
import { t } from "../i18n";

type DialogShellProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  ariaLabel: string;
  className?: string;
  testId?: string;
  headerActions?: ReactNode;
  children: ReactNode;
};

export function DialogShell({
  open,
  onClose,
  title,
  description,
  ariaLabel,
  className,
  testId,
  headerActions,
  children,
}: DialogShellProps) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="pc-dialog-backdrop" data-testid={testId ? `${testId}-backdrop` : undefined} onClick={onClose} role="presentation">
      <section aria-label={ariaLabel} className={className ? `pc-dialog ${className}` : "pc-dialog"} data-testid={testId} onClick={(event) => event.stopPropagation()} role="dialog">
        <div className="pc-card-header">
          <div className="pc-card-heading">
            <h3>{title}</h3>
            {description ? <p>{description}</p> : null}
          </div>
          <div className="pc-card-actions">
            {headerActions}
            <button className="pc-button pc-button-secondary pc-button-small" onClick={onClose} type="button">
              {t("common.close")}
            </button>
          </div>
        </div>
        <div className="pc-card-body pc-stack">{children}</div>
      </section>
    </div>
  );
}
