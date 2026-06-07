import { useEffect, useRef, useState } from "react";

type ViewerHudLifecycleOptions = {
  focusMode: boolean;
  resetDeps: unknown[];
};

export function useViewerHudLifecycle({ focusMode, resetDeps }: ViewerHudLifecycleOptions) {
  const [overlayActive, setOverlayActive] = useState(true);
  const hideHudTimerRef = useRef<number | null>(null);

  function clearHudTimer() {
    if (hideHudTimerRef.current != null) {
      window.clearTimeout(hideHudTimerRef.current);
      hideHudTimerRef.current = null;
    }
  }

  function scheduleHudHide(delay = 1800) {
    if (!focusMode) return;
    clearHudTimer();
    hideHudTimerRef.current = window.setTimeout(() => {
      setOverlayActive(false);
      hideHudTimerRef.current = null;
    }, delay);
  }

  function wakeHud() {
    if (!focusMode) return;
    if (!overlayActive) setOverlayActive(true);
    scheduleHudHide();
  }

  useEffect(() => {
    setOverlayActive(true);
    if (focusMode) {
      scheduleHudHide(2200);
    } else {
      clearHudTimer();
    }
    return clearHudTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusMode, ...resetDeps]);

  return {
    overlayActive,
    scheduleHudHide,
    wakeHud,
  };
}
