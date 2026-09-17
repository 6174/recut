/**
 * [INPUT]: segmentText 的 Unicode 分段能力。
 * [OUTPUT]: 锁定 whole/line/word/grapheme 的内容、顺序与稳定 ID。
 * [POS]: runtime 文本动画单元测试；DOM capture 与浏览器像素验证见 Playwright。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { describe, expect, it } from "vitest";
import { segmentText } from "./text-segmentation";

describe("segmentText", () => {
	it("按 grapheme 保留 emoji 与组合音标，不拆 surrogate 或组合字符", () => {
		const result = segmentText("A👩‍💻é", "grapheme");
		expect(result.map((segment) => segment.text)).toEqual(["A", "👩‍💻", "é"]);
		expect(result.map((segment) => segment.id)).toEqual(["g-0", "g-1", "g-2"]);
	});

	it("按 line 保留空行，按 whole 保留整段", () => {
		expect(segmentText("甲\n\n乙", "line").map((segment) => segment.text)).toEqual([
			"甲",
			"",
			"乙",
		]);
		expect(segmentText("甲\n\n乙", "whole")).toEqual([
			{ id: "whole-0", text: "甲\n\n乙", index: 0 },
		]);
	});

	it("按 word 保留空白边界，空字符串仍有一个可注册 whole segment", () => {
		const result = segmentText("Hello 世界", "word");
		expect(result.map((segment) => segment.text).join("|")).toBe("Hello| |世界");
		expect(segmentText("", "whole")).toEqual([
			{ id: "whole-0", text: "", index: 0 },
		]);
	});
});
