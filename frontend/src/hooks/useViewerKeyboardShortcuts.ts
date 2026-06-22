import { useEffect } from "react";
import type { WorkbenchController } from "./useWorkbench";

type ViewerKeyboardShortcutsController = Pick<
  WorkbenchController,
  "redo" | "resetViewerZoom" | "selectRelativeItem" | "toggleLayoutElement" | "toggleViewerFocusMode" | "undo" | "zoomIn" | "zoomOut"
>;

export function useViewerKeyboardShortcuts(workbench: ViewerKeyboardShortcutsController) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && (target.closest("input, textarea, select, button") || target.isContentEditable)) {
        return;
      }

      const mod = event.metaKey || event.ctrlKey;

      if (event.altKey && event.key === "1") {
        event.preventDefault();
        workbench.toggleLayoutElement("analysis");
        return;
      }
      if (event.altKey && event.key === "2") {
        event.preventDefault();
        workbench.toggleLayoutElement("filmstrip");
        return;
      }
      if (event.altKey && event.key === "3") {
        event.preventDefault();
        workbench.toggleLayoutElement("inspector");
        return;
      }
      if (event.shiftKey && event.key === "F") {
        event.preventDefault();
        workbench.toggleViewerFocusMode();
        return;
      }
      if (mod && event.key === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          workbench.redo();
        } else {
          workbench.undo();
        }
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        workbench.selectRelativeItem(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        workbench.selectRelativeItem(1);
      } else if ((event.key === "0" && mod) || event.key.toLowerCase() === "f") {
        event.preventDefault();
        workbench.resetViewerZoom();
      } else if (event.key === "=" || event.key === "+") {
        event.preventDefault();
        workbench.zoomIn();
      } else if (event.key === "-") {
        event.preventDefault();
        workbench.zoomOut();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [workbench]);
}
