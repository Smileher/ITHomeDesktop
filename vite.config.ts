import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**", "**/site/dist/**", "**/test-results/**"],
    },
    proxy: {
      "/__news": {
        target: "https://api.ithome.com",
        changeOrigin: true,
        rewrite: (p) => p.replace("/__news", ""),
      },
      "/__page": {
        target: "https://www.ithome.com",
        changeOrigin: true,
        rewrite: (p) => p.replace("/__page", ""),
      },
      "/__more": {
        target: "https://m.ithome.com",
        changeOrigin: true,
        rewrite: (p) => p.replace("/__more", ""),
      },
      "/__comments": {
        target: "https://cmt.ithome.com",
        changeOrigin: true,
        headers: { Referer: "https://www.ithome.com/" },
        rewrite: (p) => p.replace("/__comments", ""),
      },
    },
  },
  build: { target: "es2022", sourcemap: false },
});
