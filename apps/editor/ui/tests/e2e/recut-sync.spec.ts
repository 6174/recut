/**
 * [INPUT]: 依赖 demo 页的 Host 事件桥与 useRecutProjectSync。
 * [OUTPUT]: 覆盖项目重载、AI 锁与组件素材库聚焦的浏览器回归测试。
 * [POS]: editor UI 事件消费的端到端契约；模拟 Host 的 project event 转发。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { test, expect } from "@playwright/test";
import { openDemo, testGet, settle } from "./helpers";
test.describe("recut project sync (frontend)", () => {
	test("agent document.changed 增量应用，ui 回显被忽略", async ({ page }) => {
		await openDemo(page);

		const reloadsBefore = await testGet(page, "getReloadCount");
		const versionBefore = await testGet(page, "getProjectVersion");

		// 1) ui 回显（自身保存）：只更新 knownVersion，不 reload。
		await page.evaluate(
			(v) =>
				window.postMessage(
					{ type: "recut.project.event", event: { type: "project.document.changed", version: v, source: "ui" } },
					"*",
				),
			(versionBefore ?? 0) + 1,
		);
		await settle(page);
		expect(await testGet(page, "getReloadCount")).toBe(reloadsBefore);

		// 2) agent 外部变更携带完整文档：直接应用，不 reload。
		const document = await testGet(page, "getProjectDocument");
		await page.evaluate(
			({ v, document }) =>
				window.postMessage(
					{ type: "recut.project.event", event: { type: "project.document.changed", fromVersion: (v - 49), toVersion: v, source: "agent", document } },
					"*",
				),
			{ v: (versionBefore ?? 0) + 50, document },
		);
		await settle(page);
		expect(await testGet(page, "getReloadCount")).toBe(reloadsBefore);
		expect(await testGet(page, "getProjectVersion")).toBe((versionBefore ?? 0) + 50);

		// 3) 无文档/版本缺口才 fallback reload。
		await page.evaluate(() =>
			window.postMessage(
				{ type: "recut.project.event", event: { type: "project.document.changed", fromVersion: 1, toVersion: 52, source: "agent" } },
				"*",
			),
		);
		await settle(page);
		await page.waitForTimeout(400);
		expect(await testGet(page, "getReloadCount")).toBe(reloadsBefore + 1);
	});

	test("连续 agent delta 与 gap+document 不 reload，播放头保持", async ({ page }) => {
		await openDemo(page);
		const reloadsBefore = await testGet(page, "getReloadCount");
		const versionBefore = (await testGet(page, "getProjectVersion")) ?? 0;
		await testGet(page, "setTime", 1.25);
		await settle(page);
		const playheadBefore = await testGet(page, "getPlaybackTime");
		expect(playheadBefore).toBeGreaterThan(1);

		const document = await testGet(page, "getProjectDocument");
		const post = async (fromVersion: number, toVersion: number) => {
			await page.evaluate(
				({ fromVersion, toVersion, document }) =>
					window.postMessage(
						{
							type: "recut.project.event",
							event: {
								type: "project.document.changed",
								fromVersion,
								toVersion,
								source: "agent",
								document,
							},
						},
						"*",
					),
				{ fromVersion, toVersion, document },
			);
			await settle(page);
		};

		await post(versionBefore, versionBefore + 1);
		await post(versionBefore + 1, versionBefore + 2);
		expect(await testGet(page, "getReloadCount")).toBe(reloadsBefore);
		expect(await testGet(page, "getProjectVersion")).toBe(versionBefore + 2);
		expect(Math.abs((await testGet(page, "getPlaybackTime")) - playheadBefore)).toBeLessThan(0.05);

		// 版本缺口但携带 document：仍走 applyRemoteOperations，不 loadProject。
		await post(1, versionBefore + 20);
		expect(await testGet(page, "getReloadCount")).toBe(reloadsBefore);
		expect(await testGet(page, "getProjectVersion")).toBe(versionBefore + 20);
		expect(Math.abs((await testGet(page, "getPlaybackTime")) - playheadBefore)).toBeLessThan(0.05);
		expect(await page.locator("canvas[data-recut-canvas]").count()).toBe(1);
	});

	test("project:locked/unlocked 不触发 reload，保持编辑器存活", async ({ page }) => {
		await openDemo(page);
		const reloadsBefore = await testGet(page, "getReloadCount");

		await page.evaluate(() =>
			window.postMessage(
				{ type: "recut.project.event", event: { type: "project:locked", owner: "agent-e2e", version: 1 } },
				"*",
			),
		);
		await settle(page);
		expect(await testGet(page, "getReloadCount")).toBe(reloadsBefore);
		// 编辑器仍存活（画布未卸载）。
		expect(await page.locator("canvas[data-recut-canvas]").count()).toBe(1);

		// 解锁：只恢复自动保存；文档同步由 document.changed 事件负责。
		await page.evaluate(() =>
			window.postMessage(
				{ type: "recut.project.event", event: { type: "project:unlocked", version: 1 } },
				"*",
			),
		);
		await settle(page);
		await page.waitForTimeout(400);
		expect(await testGet(page, "getReloadCount")).toBe(reloadsBefore);
	});

	test("新组件可用时聚焦素材库（media），普通变更不抢占当前标签", async ({ page }) => {
		await openDemo(page);
		await testGet(page, "setAssetsPanelTab", "media");

		await page.evaluate(() =>
			window.postMessage(
				{
					type: "recut.project.event",
					event: {
						type: "project.components.changed",
						componentId: "ai-feature-chip",
						status: "verified",
						library: { tab: "media" },
					},
				},
				"*",
			),
		);
		await settle(page);
		expect(await testGet(page, "getAssetsPanelTab")).toBe("media");

		await testGet(page, "setAssetsPanelTab", "media");
		await page.evaluate(() =>
			window.postMessage(
				{
					type: "recut.project.event",
					event: { type: "project.components.changed", componentId: "ai-feature-chip", status: "archived" },
				},
				"*",
			),
		);
		await settle(page);
		expect(await testGet(page, "getAssetsPanelTab")).toBe("media");
	});
});
