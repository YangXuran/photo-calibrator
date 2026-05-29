import { registerInspectorExtension } from "./extensions.js";
import { currentFile } from "./store.js";
import { t } from "./i18n.js";

export function registerBuiltinPanelExtensions({ state }) {
  registerInspectorExtension({
    id: "workspace-status",
    panelId: "adjust",
    order: 100,
    render(node) {
      const file = currentFile();
      node.innerHTML = `
        <div class="dock-panel" data-testid="workspace-status-extension">
          <div class="dock-panel-header"><span>${t("ext.workspaceStatus")}</span></div>
          <div class="library-section">
            <div class="library-meta-row"><span>${t("ext.activeTool")}</span><strong>${state.activeTool}</strong></div>
            <div class="library-meta-row"><span>${t("ext.currentFile")}</span><strong>${file ? file.name : t("ext.none")}</strong></div>
            <div class="library-meta-row"><span>${t("ext.documentCache")}</span><strong>${state.documents.size}</strong></div>
          </div>
        </div>
      `;
    },
  });
}
