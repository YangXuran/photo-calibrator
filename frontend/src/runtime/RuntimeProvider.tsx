import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { resolveRuntimeConfig, type RuntimeConfig } from "./config";
import { getShellBridge } from "./shellBridge";
import { installMockShellBridge } from "./mockShellBridge";

const RuntimeContext = createContext<RuntimeConfig | null>(null);

export function RuntimeProvider({ children }: { children: ReactNode }) {
  const config = useMemo(() => resolveRuntimeConfig(), []);

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
