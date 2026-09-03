/**
 * [INPUT]: 依赖 demo 页的 Host 事件桥（recut-project-event）、测试 seam（window.__recutTest.aiComponents）、
 * 组件构建脚本（fixtures → bundle）与内置 GSAP 组件（gsap-reveal-card）。
 * [OUTPUT]: 覆盖两个生产回归：
 *   1) 空素材库下 AI 创建组件素材后，素材面板必须即时出现卡片（空态不得卸载组件素材库监听）；
 *   2) react 组件预览对话框必须提供 FrameTimeContext 驱动 GSAP seek（入场动画不得永久停在 t=0 空白）。
 * [POS]: editor UI 的组件素材库同步与预览对话框端到端回归。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDemo, testGet, settle } from "./helpers";

const SPEC_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(SPEC_DIR, "../../../");
const BUILD_SCRIPT = path.join(APP_ROOT, "scripts", "component-build.js");
const SDK_DIR = path.join(APP_ROOT, "sdk");
const FIXTURES = path.join(SPEC_DIR, "fixtures", "components");

function buildFixture(name: string): { bundle: string; bundleHash: string } {
	const sourcePath = path.join(FIXTURES, `${name}.tsx`);
	const outPath = path.join(os.tmpdir(), `recut-e2e-sync-${name}.js`);
	const result = spawnSync("node", [BUILD_SCRIPT, sourcePath, outPath, SDK_DIR], {
		encoding: "utf8",
	});
	const parsed = JSON.parse(result.stdout || "{}");
	if (!parsed.ok) {
		throw new Error(`build ${name} 失败: ${JSON.stringify(parsed)}`);
	}
	return { bundle: fs.readFileSync(outPath, "utf8"), bundleHash: parsed.bundleHash };
}

const COMPONENT_ID = "ai-live-sync";

/** 注入测试 seam：无宿主时用注入数据服务 asset 列表 / 源码 / bundle 解析。 */
async function installSeam(
	page: import("@playwright/test").Page,
	{ list, resolve }: { list: unknown[]; resolve: Record<string, unknown> },
): Promise<void> {
	await page.evaluate(
		({ list, resolve }) => {
			(window as any).__recutTest.aiComponents = { list, source: {}, resolve };
		},
		{ list, resolve },
	);
}

test.describe("component library live sync (frontend)", () => {
	test("空素材库 + AI 创建组件素材 → 面板即时出现卡片（无需刷新）", async ({ page }) => {
		// 不用 openDemo 的二次 goto（会冲掉 seam）：demo bootstrap 是异步的（媒体生成+项目加载），
		// 在 __recutTest 桥出现后立即注入 seam，保证素材库首次 refresh 即可经 seam 完成。
		await page.goto("/demo.html?test=1");
		await page.waitForFunction(
			() => (window as any).__recutTest != null,
			undefined,
			{ timeout: 15_000 },
		);
		const { bundle, bundleHash } = buildFixture("countdown");
		await installSeam(page, {
			list: [],
			resolve: { [COMPONENT_ID]: { surface: "html", inputs: [], bundle, bundleHash } },
		});
		await page.waitForSelector("canvas[data-recut-canvas]", { timeout: 15_000 });
		await page.waitForFunction(
			() => (window as any).__recutTest?.getNodeBounds("demo-el-glow") != null,
			{ timeout: 15_000 },
		);
		await testGet(page, "setTime", 0);
		await testGet(page, "advanceFrame");
		const reloadsBefore = await testGet(page, "getReloadCount");

		await testGet(page, "setAssetsPanelTab", "media");
		await testGet(page, "clearMediaAssets");

		// 空态：组件素材库必须仍挂载监听（修复点）——空态文本出现即代表 ready 已就绪。
		const emptyState = page.getByText(/Library is empty|素材库为空/);
		await expect(emptyState).toBeVisible({ timeout: 15_000 });

		// 模拟 AI 创建完成：asset 列表出现新组件 + 宿主转发 project.components.changed。
		await page.evaluate(
			({ componentId }) => {
				(window as any).__recutTest.aiComponents.list.push({
					assetId: `component:${componentId}`,
					type: "component",
					refId: componentId,
					refVersionId: `${componentId}@1`,
					componentId,
					name: "Countdown",
					status: "active",
					componentStatus: "verified",
				});
				window.postMessage(
					{
						type: "recut.project.event",
						event: {
							type: "project.components.changed",
							componentId,
							versionId: `${componentId}@1`,
							status: "verified",
							library: { tab: "media" },
						},
					},
					"*",
				);
			},
			{ componentId: COMPONENT_ID },
		);
		await settle(page);

		// 卡片即时出现（bundle 名 Countdown），空态消失，且不触发整页 reload。
		await expect(page.getByText("Countdown").first()).toBeVisible({ timeout: 15_000 });
		await expect(emptyState).toBeHidden();
		expect(await testGet(page, "getReloadCount")).toBe(reloadsBefore);
	});

	test("react GSAP 组件预览对话框：入场动画随预览时间推进，不再永久空白", async ({ page }) => {
		await openDemo(page);
		await testGet(page, "setAssetsPanelTab", "components");

		// 内置 gsap-reveal-card（react surface，根节点 autoAlpha 0 入场）。
		await page.locator('[title="GSAP Reveal Card"]').click();
		const dialog = page.getByRole("dialog");
		await expect(dialog).toBeVisible();

		// 修复前：预览缺少 FrameTimeContext，useTimeline 恒 seek(0) → 内容 opacity 0 永不出现。
		await expect(dialog.getByText("Recut Motion")).toBeVisible({ timeout: 10_000 });
		await expect(dialog.getByText("GSAP-powered title card")).toBeVisible({ timeout: 10_000 });
	});
});
