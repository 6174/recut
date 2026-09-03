/**
 * [INPUT]: Playwright Chromium、真实 Recut 项目页与编辑器 iframe 的 WebGL 预览画布。
 * [OUTPUT]: 验证真实 HTML 组件在前进后回到同一时间点仍有稳定画面的端到端回归用例。
 * [POS]: tests/e2e 的真实项目验证；覆盖独立 harness 无法发现的宿主 iframe 与 HTML-in-Canvas 链路。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { expect, test } from "@playwright/test";

const PROJECT_ID = "8b3e3797f1835b1eb435a6a0";
const PROJECT_URL = `http://localhost:3000/projects/${PROJECT_ID}`;

type PixelStats = { bright: number; opaque: number };

async function readPreviewPixels({
	canvas,
}: {
	canvas: import("@playwright/test").Locator;
}): Promise<PixelStats> {
	return canvas.evaluate((element) => {
		const canvas = element as HTMLCanvasElement;
		const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
		if (!gl) throw new Error("真实预览画布没有 WebGL context");
		const pixels = new Uint8Array(canvas.width * canvas.height * 4);
		gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
		let bright = 0;
		let opaque = 0;
		for (let offset = 0; offset < pixels.length; offset += 4) {
			const red = pixels[offset];
			const green = pixels[offset + 1];
			const blue = pixels[offset + 2];
			const alpha = pixels[offset + 3];
			if (alpha > 0) opaque += 1;
			if (Math.max(red, green, blue) > 96) bright += 1;
		}
		return { bright, opaque };
	});
}

test("真实项目：Hello World 在往返 seek 后不被首帧字符裁切", async ({ page }) => {
	await page.goto(PROJECT_URL, { waitUntil: "domcontentloaded" });
	const editor = await expect
		.poll(
			() =>
				page
					.frames()
					.find((frame) => frame.url().includes("/v1/apps/recut.editor/")) ?? null,
			{ timeout: 15_000 },
		)
		.not.toBeNull();
	void editor;

	const frame = page
		.frames()
		.find((candidate) => candidate.url().includes("/v1/apps/recut.editor/"));
	if (!frame) throw new Error("没有加载真实 Recut 编辑器 iframe");

	const canvasDrawElementEnabled = await frame.evaluate(
		() => typeof HTMLCanvasElement.prototype.captureElementImage === "function",
	);
	expect(canvasDrawElementEnabled).toBe(true);

	const canvas = frame.locator("canvas[data-recut-canvas]");
	const ruler = frame.getByRole("button", { name: "Timeline ruler" });
	await expect(canvas).toBeVisible({ timeout: 15_000 });
	await expect(ruler).toBeVisible();

	// 45px 位于本项目的 Hello World 逐字显现段；132px 已越过该组件。
	// 全程经真实 iframe 的时间线 UI 操作，不改应用状态也不用独立 harness。
	await ruler.click({ position: { x: 45, y: 8 } });
	await expect.poll(() => readPreviewPixels({ canvas }), { timeout: 8_000 }).toMatchObject({
		bright: expect.any(Number),
	});
	const first = await readPreviewPixels({ canvas });
	expect(first.bright).toBeGreaterThan(10_000);
	expect(first.opaque).toBeGreaterThan(1_000_000);

	await ruler.click({ position: { x: 132, y: 8 } });
	await page.waitForTimeout(300);

	await ruler.click({ position: { x: 45, y: 8 } });
	await expect
		.poll(() => readPreviewPixels({ canvas }), { timeout: 8_000 })
		.toEqual(first);
});
