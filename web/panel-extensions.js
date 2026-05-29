import { registerInspectorExtension } from "./extensions.js";
import { currentFile } from "./store.js";

export function registerBuiltinPanelExtensions({ state }) {
  registerInspectorExtension({
    id: "workspace-status",
    panelId: "adjust",
    order: 100,
    render(node) {
      const file = currentFile();
      node.innerHTML = `
        <div class="dock-panel" data-testid="workspace-status-extension">
          <div class="dock-panel-header"><span>Workspace Status</span></div>
          <div class="library-section">
            <div class="library-meta-row"><span>Active Tool</span><strong>${state.activeTool}</strong></div>
            <div class="library-meta-row"><span>Current File</span><strong>${file ? file.name : "None"}</strong></div>
            <div class="library-meta-row"><span>Document Cache</span><strong>${state.documents.size}</strong></div>
          </div>
        </div>
      `;
    },
  });
}
