import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./tests/e2e",
	timeout: 30_000,
	fullyParallel: false,
	workers: 1,
	reporter: "list",
	use: {
		baseURL: "http://localhost:5184",
		headless: true,
		launchOptions: {
			args: [
				"--use-gl=swiftshader",
				"--enable-unsafe-swiftshader",
				"--enable-features=CanvasDrawElement",
			],
		},
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
	webServer: {
		command: "./node_modules/.bin/vite preview --port 5184 --strictPort",
		url: "http://localhost:5184/demo.html",
		reuseExistingServer: true,
		timeout: 30_000,
	},
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
