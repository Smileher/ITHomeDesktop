import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createCipheriv } from "node:crypto";

function appCommentsPath(path: string): string {
  const url = new URL(path, "http://localhost");
  const id = url.searchParams.get("id") || "";
  if (!/^\d{1,9}$/.test(id) || Number(id) === 0)
    throw new Error("评论编号无效");
  const key = Buffer.from("(#i@x*l%");
  // Repeating a DES key in 3DES is equivalent to DES and works with Node 24.
  const cipher = createCipheriv("des-ede3", Buffer.concat([key, key, key]), null);
  cipher.setAutoPadding(false);
  const bytes = Buffer.alloc(Math.ceil(id.length / 8) * 8);
  bytes.write(id);
  const sn = Buffer.concat([cipher.update(bytes), cipher.final()]).toString("hex");
  url.searchParams.delete("id");
  url.searchParams.set(url.pathname.endsWith("getcommentcontent") ? "commentid" : "sn", sn);
  return url.pathname.replace("/__appcomments", "") + url.search;
}

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
      "/__appcomments": {
        target: "https://cmt.ithome.com",
        changeOrigin: true,
        headers: { Referer: "https://www.ithome.com/" },
        rewrite: appCommentsPath,
      },
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
