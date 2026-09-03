import { test, expect } from "@playwright/test";
import { openDemo } from "./helpers";

// 固定英文 locale：本 spec 的断言文案均为英文，不依赖浏览器默认语言。
const openDemoEn = (page: any) => openDemo(page, { query: "test=1&locale=en" });

test.describe("audio library", () => {
	test("catalog loads and music items render", async ({ page }) => {
		await openDemoEn(page);

		// Open the assets panel "Audio" tab via the "More categories" dropdown
		await page.getByRole("button", { name: "More categories" }).click();
		await page.getByRole("menuitem", { name: /Audio/ }).click();
		await page.waitForTimeout(500);

		// Music tab should be default; verify at least one known item appears
		await expect(
			page.getByText("Feelin Good", { exact: false }).first(),
		).toBeVisible({ timeout: 15_000 });

		// Switch to sound effects tab
		await page.getByRole("tab", { name: /Sound effects/ }).click();
		await expect(
			page.getByText("click_001", { exact: false }).first(),
		).toBeVisible({ timeout: 10_000 });
	});

	test("moves overflow sound categories into the more menu", async ({ page }) => {
		await openDemoEn(page);

		await page.getByRole("button", { name: "More categories" }).click();
		await page.getByRole("menuitem", { name: /Audio/ }).click();
		await page.getByRole("tab", { name: /Sound effects/ }).click();

		await page.getByRole("button", { name: "More sound effect categories" }).click();
		await page.getByRole("menuitem", { name: "click", exact: true }).click();

		await expect(
			page.getByRole("button", { name: "click", exact: true }),
		).toHaveAttribute("aria-current", "page");
		await expect(
			page.getByText("click_001", { exact: false }).first(),
		).toBeVisible({ timeout: 10_000 });
	});

	test("downloads a sound effect via the play slot, then adds it to the timeline (Jianying mode)", async ({
		page,
	}) => {
		await openDemoEn(page);

		// Open the assets panel "Audio" (sounds) tab.
		await page.getByRole("button", { name: "More categories" }).click();
		await page.getByRole("menuitem", { name: /Audio/ }).click();
		await page.waitForTimeout(500);

		// Switch to sound effects.
		await page.getByRole("tab", { name: /Sound effects/ }).click();
		const itemText = page.getByText("click_001", { exact: false }).first();
		await expect(itemText).toBeVisible({ timeout: 10_000 });

		// The play slot doubles as the download action before download.
		const row = itemText
			.locator("xpath=ancestor::div[contains(@class,'group')]")
			.first();
		const playSlot = row.locator("button[title]").first();
		await expect(playSlot).toHaveAttribute("title", /Download/, {
			timeout: 10_000,
		});

		// Dispatch a DOM click (panel hit-testing occludes playwright's pointer
		// events in the demo layout) to start the download.
		await playSlot.evaluate((el) => {
			(el as HTMLButtonElement).click();
		});

		// After the download completes the same slot flips to a Play action.
		await expect(playSlot).toHaveAttribute("title", "Play", { timeout: 20_000 });

		// Adding to timeline works from the downloaded state.
		const addButton = row.getByRole("button", { name: /Add to timeline/i });
		await expect(addButton).toBeEnabled();
		await addButton.evaluate((el) => {
			(el as HTMLButtonElement).click();
		});
		await page.waitForTimeout(500);

		// The downloaded audio must NOT appear in the "Media" (assets) panel —
		// it lives only in the internal audio library cache. Check the assets
		// listbox specifically (body text includes the timeline track name).
		await page.getByRole("button", { name: "Media" }).click();
		await page.waitForTimeout(500);
		const assetsList = page.getByRole("listbox", { name: /Assets/ });
		await expect(assetsList).toBeVisible();
		const assetsPanelHasAudio = await assetsList.evaluate((el) =>
			el.textContent?.includes("click_001"),
		);
		expect(assetsPanelHasAudio).toBe(false);
	});
});
