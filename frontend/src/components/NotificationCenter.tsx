import { useEffect } from "react";
import type { NotificationItem } from "../types";

type NotificationCenterProps = {
  items: NotificationItem[];
  onDismiss: (id: string) => void;
  focusMode?: boolean;
  duration?: number;
};

function NotificationToast({ item, onDismiss, duration = 5000 }: { item: NotificationItem; onDismiss: (id: string) => void; duration?: number }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(item.id), duration);
    return () => clearTimeout(timer);
  }, [item.id, duration, onDismiss]);

  return (
    <article className={`pc-toast pc-toast-${item.tone}`}>
      <div className="pc-toast-copy">
        <strong>{item.title}</strong>
        <span>{item.message}</span>
      </div>
      <button className="pc-toast-close" onClick={() => onDismiss(item.id)} type="button" aria-label="Dismiss notification">
        ×
      </button>
    </article>
  );
}

export function NotificationCenter({ items, onDismiss, focusMode = false, duration = 5000 }: NotificationCenterProps) {
  return (
    <div aria-live="polite" className={`pc-notification-stack ${focusMode ? "is-focus" : ""}`}>
      {items.map((item) => (
        <NotificationToast key={item.id} duration={duration} item={item} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
