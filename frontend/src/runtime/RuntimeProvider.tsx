import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { resolveRuntimeConfig, type RuntimeConfig } from "./config";
import { getAppBridge } from "./appBridge";
import { getShellBridge } from "./shellBridge";
import { installMockShellBridge } from "./mockShellBridge";

const RuntimeContext = createContext<RuntimeConfig | null>(null);

export function RuntimeProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<RuntimeConfig>(() => resolveRuntimeConfig());

  useEffect(() => {
    const bridge = getAppBridge();
    if (!bridge) return;
    const applyRuntime = (runtime: Partial<RuntimeConfig>) => {
      window.__PHOTO_CALIBRATOR_RUNTIME__ = runtime;
      setConfig(resolveRuntimeConfig(runtime));
    };
    void bridge.getRuntime().then(applyRuntime).catch(() => {});
    return bridge.onRuntimeChanged(applyRuntime);
  }, []);

  useEffect(() => {
    if (!config.enableMockShellBridge) return;
    if (getShellBridge()) return;
    return installMockShellBridge();
  }, [config.enableMockShellBridge]);

  return <RuntimeContext.Provider value={config}>{children}</RuntimeContext.Provider>;
}

export function useRuntimeConfig() {
  const value = useContext(RuntimeContext);
  if (!value) {
    throw new Error("RuntimeProvider is required");
  }
  return value;
}
