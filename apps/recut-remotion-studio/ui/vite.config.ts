import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@compositions": path.resolve(__dirname, "../render/src"),
    },
  },
  optimizeDeps: {
    exclude: ["@remotion/player"],
  },
});
