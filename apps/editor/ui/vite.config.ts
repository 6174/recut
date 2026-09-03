import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: /^next\/navigation$/, replacement: fileURLToPath(new URL("./src/shims/next/navigation.ts", import.meta.url)) },
      { find: /^next\/link$/, replacement: fileURLToPath(new URL("./src/shims/next/link.tsx", import.meta.url)) },
      { find: /^next\/image$/, replacement: fileURLToPath(new URL("./src/shims/next/image.tsx", import.meta.url)) },
      { find: /^next$/, replacement: fileURLToPath(new URL("./src/shims/next/index.ts", import.meta.url)) },
      { find: /^opencut-wasm$/, replacement: fileURLToPath(new URL("./src/wasm/index.ts", import.meta.url)) },
      { find: /^@\//, replacement: fileURLToPath(new URL("./src/", import.meta.url)) },
    ],
    dedupe: ["react", "react-dom", "three"],
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        metalforge: fileURLToPath(new URL("./metalforge.html", import.meta.url)),
        demo: fileURLToPath(new URL("./demo.html", import.meta.url)),
        world: fileURLToPath(new URL("./world.html", import.meta.url)),
        "component-harness": fileURLToPath(new URL("./component-harness.html", import.meta.url)),
        "motion-runtime-harness": fileURLToPath(new URL("./motion-runtime-harness.html", import.meta.url)),
      },
    },
  },
  server: {
    port: 5183,
  },
});
