import { resolve } from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { releaseAssets } from "./scripts/release_assets.mjs";
import { alphaGenomeBridge } from "./tools/alphagenome/viteBridge.js";

export default defineConfig({
  base: "./",
  plugins: [releaseAssets(), react(), alphaGenomeBridge()],
  worker: { format: "es" },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        bench: resolve(__dirname, "bench.html")
      }
    }
  },
  server: {
    fs: { deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "**/local-reviews/**", "**/.venv-alphagenome/**", "**/*.local"] },
    port: 5180,
    open: false
  }
});
