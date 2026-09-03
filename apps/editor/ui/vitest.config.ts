import { defineConfig } from "vitest/config";
import viteConfig from "./vite.config";

export default defineConfig({
	...viteConfig,
	test: {
		include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
		exclude: ["node_modules", "tests/e2e"],
		environment: "node",
		setupFiles: ["./vitest.setup.ts"],
	},
});
