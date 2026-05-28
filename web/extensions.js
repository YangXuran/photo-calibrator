const inspectorExtensions = [];

export function registerInspectorExtension(definition) {
  inspectorExtensions.push(definition);
}

export function mountRegisteredInspectorExtensions(panelRegistry, context) {
  inspectorExtensions.forEach((definition) => {
    panelRegistry.registerExtension({
      ...definition,
      render(node) {
        definition.render(node, context);
      },
    });
  });
}
