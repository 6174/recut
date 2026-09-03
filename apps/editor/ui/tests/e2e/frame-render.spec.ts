/**
 * [INPUT]: 依赖 demo 页的 Host 事件桥（window.postMessage "recut.project.event"）、SDK 的
 *          recut.on / recut.background.call 与编辑器常驻 renderer 的 renderFrameDataUrl。
 * [OUTPUT]: 覆盖 App→UI RPC（recut.on）的浏览器端契约：注册 frame.render → 派发 → 经
 *           rpc.reply 回包（含 fileBase64），以及同 t 两次渲染像素确定性。契约见
 *           docs/platform-comms-contract.md §7–§9。
 * [POS]: editor UI 的 RPC 消费端到端契约；用假 Host MessageChannel 隔离 SDK 桥。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { test, expect } from "@playwright/test";
import { openDemo, testGet, settle } from "./helpers";

/**
 * 注入假 Host：直接向页面 window 派发 recut.ui.connect（携带 MessagePort），
 * 与 SDK 握手；捕获 background.call（rpc.reply）。宿主事件经 recut.project.event 转发。
 */
async function installHostMock(page: import("@playwright/test").Page) {
	await page.evaluate(() => {
		const win = window as any;
		win.__recutHostMock = {
			replies: [] as Array<Record<string, unknown>>,
			errors: [] as Array<Record<string, unknown>>,
		};
		const channel = new MessageChannel();
		channel.port1.onmessage = (event: any) => {
			const req = event.data;
			if (req?.type === "background.call" && req?.input?.name === "rpc.reply") {
				if (req.input.error) {
					win.__recutHostMock.errors.push(req.input.error);
				} else {
					win.__recutHostMock.replies.push({
						id: req.input.id,
						result: req.input.result,
					});
				}
				channel.port1.postMessage({ id: req.id, result: { ok: true } });
				return;
			}
			channel.port1.postMessage({ id: req?.id, result: {} });
		};
		window.postMessage(
			{ type: "recut.ui.connect", origin: "*" },
			"*",
			[channel.port2],
		);
	});
}

test.describe("app→ui rpc (recut.on / frame.render)", () => {
	test("宿主派发 app.rpc.request 时按 method 渲染并经 rpc.reply 回包", async ({ page }) => {
		await openDemo(page);
		await installHostMock(page);
		await page.waitForTimeout(200);

		// 模拟宿主把 app.rpc.request { method:"frame.render" } 投递给 iframe。
		await page.evaluate(() => {
			window.postMessage(
				{
					type: "recut.project.event",
					event: {
						type: "app.rpc.request",
						id: "req-frame-1",
						method: "frame.render",
						payload: { timeSec: 0, width: 320, height: 180 },
					},
				},
				"*",
			);
		});

		// 等待 handler 完成并回包。
		await page.waitForFunction(
			() => (window as any).__recutHostMock?.replies?.length >= 1,
			undefined,
			{ timeout: 15_000 },
		);
		const reply = (await page.evaluate(
			() => (window as any).__recutHostMock.replies[0],
		)) as any;
		expect(reply.id).toBe("req-frame-1");
		expect(typeof reply.result.fileBase64).toBe("string");
		expect(reply.result.fileBase64.length).toBeGreaterThan(0);
		// 默认不缩放 → 画布原尺寸。
		expect(reply.result.width).toBeGreaterThan(0);
		expect(reply.result.height).toBeGreaterThan(0);
	});

	test("同 t 两次渲染像素确定性（Preview==Export）", async ({ page }) => {
		await openDemo(page);
		await installHostMock(page);
		await page.waitForTimeout(200);

		const render = async () => {
			const replyCount = await page.evaluate(
				() => (window as any).__recutHostMock.replies.length,
			);
			await page.evaluate(() => {
				window.postMessage(
					{
						type: "recut.project.event",
						event: {
							type: "app.rpc.request",
							id: `req-${Date.now()}`,
							method: "frame.render",
							payload: { timeSec: 0, width: 320, height: 180 },
						},
					},
					"*",
				);
			});
			await page.waitForFunction(
				(count) => (window as any).__recutHostMock?.replies?.length > count,
				replyCount,
				{ timeout: 15_000 },
			);
			return (await page.evaluate(() => {
				const replies = (window as any).__recutHostMock.replies;
				return replies[replies.length - 1].result.fileBase64 as string;
			})) as string;
		};

		// 第一帧允许异步字体/组件纹理完成水合；其后同 doc + 同 t 必须稳定。
		await render();
		const a = await render();
		const b = await render();
		// 同 doc + 同 t 两次渲染应像素一致（Preview==Export 确定性）。
		// 连续两次渲染间不改变时间线状态，校验稳定渲染位点下的逐字节一致。
		expect(a).toBe(b);
	});

	test("已取消的 RPC 不回包，也不启动帧渲染", async ({ page }) => {
		await openDemo(page);
		await installHostMock(page);
		await page.waitForTimeout(200);
		await page.evaluate(() => {
			window.postMessage(
				{ type: "recut.project.event", event: { type: "app.rpc.cancel", id: "req-cancelled" } },
				"*",
			);
			window.postMessage(
				{
					type: "recut.project.event",
					event: {
						type: "app.rpc.request",
						id: "req-cancelled",
						method: "frame.render",
						payload: { timeSec: 0 },
					},
				},
				"*",
			);
		});
		await page.waitForTimeout(500);
		expect(await page.evaluate(() => (window as any).__recutHostMock.replies)).toEqual([]);
	});

	test("宿主派发 frame.contactSheet 时合成多格并回包", async ({ page }) => {
		await openDemo(page);
		await installHostMock(page);
		await page.waitForTimeout(200);
		await page.evaluate(() => {
			window.postMessage(
				{
					type: "recut.project.event",
					event: {
						type: "app.rpc.request",
						id: "req-sheet-1",
						method: "frame.contactSheet",
						payload: { times: [0, 0.4], width: 160, height: 90 },
					},
				},
				"*",
			);
		});
		await page.waitForFunction(
			() => (window as any).__recutHostMock?.replies?.length >= 1,
			undefined,
			{ timeout: 15_000 },
		);
		const reply = (await page.evaluate(
			() => (window as any).__recutHostMock.replies[0],
		)) as any;
		expect(reply.id).toBe("req-sheet-1");
		expect(typeof reply.result.fileBase64).toBe("string");
		expect(reply.result.fileBase64.length).toBeGreaterThan(0);
		expect(reply.result.width).toBeGreaterThanOrEqual(160);
		expect(reply.result.height).toBeGreaterThanOrEqual(90);
	});
});
