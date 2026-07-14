import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { readFileSync } from "fs";
import { tanstackRouter } from "@tanstack/router-plugin/vite";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8"));

function buildTime() {
    // Use UTC+7 (Bangkok time)
    const d = new Date(Date.now() + 7 * 60 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
    define: {
        __APP_VERSION__: JSON.stringify(version),
        __BUILD_TIME__: JSON.stringify(buildTime()),
    },
    server: {
        host: "::",
        port: 8080,
        allowedHosts: ["localhost", "127.0.0.1", "0.0.0.0", "juhkcbiukr.a.pinggy.link"],
    },
    plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    test: {
        globals: true,
        environment: "jsdom",
        setupFiles: ["./src/test/setup.ts"],
    },
}));
