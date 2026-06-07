import { useEffect, useState, type ReactNode } from "react";

const SECTION_COLLAPSE_STORAGE_PREFIX = "photo-calibrator:section-collapsed:";

type PaneSectionProps = {
  title: string;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  testId?: string;
  density?: "default" | "compact";
  emphasis?: "default" | "primary" | "muted";
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  collapseStorageKey?: string;
  collapseStorageScope?: string;
};

function resolveStorageKey(storageKey: string | undefined, scope: string | undefined) {
  if (!storageKey) return undefined;
  return scope ? `${scope}:${storageKey}` : storageKey;
}

function loadCollapsedState(storageKey: string | undefined, fallback: boolean) {
  if (!storageKey || typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(`${SECTION_COLLAPSE_STORAGE_PREFIX}${storageKey}`);
    if (raw == null) return fallback;
    return raw === "1";
  } catch {
    return fallback;
  }
}

export function PaneSection({
  title,
  meta,
  actions,
  children,
  testId,
  density = "default",
  emphasis = "default",
  collapsible = false,
  defaultCollapsed = false,
  collapseStorageKey,
  collapseStorageScope,
}: PaneSectionProps) {
  const resolvedStorageKey = resolveStorageKey(collapseStorageKey, collapseStorageScope);
  const [collapsed, setCollapsed] = useState(() => loadCollapsedState(resolvedStorageKey, defaultCollapsed));

  useEffect(() => {
    setCollapsed(loadCollapsedState(resolvedStorageKey, defaultCollapsed));
  }, [defaultCollapsed, resolvedStorageKey]);

  useEffect(() => {
    if (!resolvedStorageKey) return;
    try {
      window.localStorage.setItem(`${SECTION_COLLAPSE_STORAGE_PREFIX}${resolvedStorageKey}`, collapsed ? "1" : "0");
    } catch {
      // ignore localStorage write failures and keep in-memory behavior
    }
  }, [collapsed, resolvedStorageKey]);

  return (
    <section className={`pc-card pc-card-${density} pc-card-${emphasis} ${collapsed ? "is-collapsed" : ""}`} data-testid={testId}>
      <header className="pc-card-header">
        <div className="pc-card-heading">
          <h3>{title}</h3>
          {meta ? <p>{meta}</p> : null}
        </div>
        <div className="pc-card-actions">
          {actions ? actions : null}
          {collapsible ? (
            <button
              aria-expanded={!collapsed}
              className="pc-section-toggle"
              onClick={() => setCollapsed((current) => !current)}
              type="button"
            >
              {collapsed ? "展开" : "收起"}
            </button>
          ) : null}
        </div>
      </header>
      {!collapsed ? <div className="pc-card-body">{children}</div> : null}
    </section>
  );
}
