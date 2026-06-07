import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(function (_a) {
    var mode = _a.mode;
    var env = loadEnv(mode, ".", "");
    var apiProxyTarget = env.VITE_DEV_API_PROXY_TARGET || "http://127.0.0.1:8766";
    return {
        base: "./",
        plugins: [react()],
        server: {
            host: "127.0.0.1",
            port: 4176,
            proxy: {
                "/api": {
                    target: apiProxyTarget,
                    changeOrigin: true,
                },
            },
        },
        preview: {
            host: "127.0.0.1",
            port: 4177,
        },
    };
});
