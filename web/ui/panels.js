export const PANEL_SLOT_IDS = ["adjust", "analysis", "crop"];

export function createPanelRegistry(els) {
  const panelSlots = new Map(
    PANEL_SLOT_IDS.map((id) => [
      id,
      {
        id,
        root: els.inspectorPanels[id],
        mount(node) {
          this.root.append(node);
        },
        show(visible) {
          this.root.classList.toggle("hidden", !visible);
        },
      },
    ])
  );
  const extensions = new Map();

  function ensureExtensionMount(extension) {
    const panel = panelSlots.get(extension.panelId);
    if (!panel) return null;
    if (!extension.node) {
      extension.node = document.createElement("section");
      extension.node.className = "panel-extension";
      extension.node.dataset.panelExtension = extension.id;
      panel.mount(extension.node);
    }
    return extension.node;
  }

  return {
    get(id) {
      return panelSlots.get(id) || null;
    },
    entries() {
      return [...panelSlots.entries()];
    },
    registerExtension(definition) {
      extensions.set(definition.id, { ...definition, node: null });
    },
    unregisterExtension(id) {
      const extension = extensions.get(id);
      if (extension?.node) {
        extension.node.remove();
      }
      extensions.delete(id);
    },
    renderExtensions(context) {
      [...extensions.values()]
        .sort((a, b) => (a.order || 0) - (b.order || 0))
        .forEach((extension) => {
          const node = ensureExtensionMount(extension);
          if (!node) return;
          extension.render(node, context);
        });
    },
  };
}

export function renderPanelVisibility(panelRegistry, activePanel) {
  panelRegistry.entries().forEach(([id, panel]) => {
    panel.show(id === activePanel);
  });
}
