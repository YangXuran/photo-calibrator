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
          <div class="dock-panel-header"><span>工作区状态</span></div>
          <div class="library-section">
            <div class="library-meta-row"><span>当前工具</span><strong>${state.activeTool}</strong></div>
            <div class="library-meta-row"><span>当前文件</span><strong>${file ? file.name : "未选择"}</strong></div>
            <div class="library-meta-row"><span>文档缓存</span><strong>${state.documents.size}</strong></div>
          </div>
        </div>
      `;
    },
  });
}
