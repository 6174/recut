import { useEditor } from "@/editor/use-editor";
import { isHtmlInCanvasSupported } from "@/three/dom-text-surface";
import { t, useRecutLocale } from "@/i18n";

/**
 * 文字依赖原生 HTML-in-Canvas（Chrome 149+，chrome://flags/#canvas-draw-element）。
 * 未启用时提示用户，文字走兜底渲染。
 */
export function HtmlInCanvasBanner() {
	const hasText = useEditor((editor) => {
		const scene = editor.scenes.getActiveSceneOrNull();
		if (!scene) return false;
		for (const track of [scene.tracks.main, ...scene.tracks.overlay]) {
			if (track.elements.some((element) => element.type === "text")) {
				return true;
			}
		}
		return false;
	});
	const locale = useRecutLocale();

	if (!hasText || isHtmlInCanvasSupported()) return null;

	return (
		<div className="bg-caution flex h-8 items-center justify-center gap-2 border-b px-4 text-xs text-caution-foreground">
			<span>{t(locale, "hic.notEnabled")}</span>
			<a
				href="chrome://flags/#canvas-draw-element"
				target="_blank"
				rel="noreferrer"
				className="underline underline-offset-2"
			>
				{t(locale, "hic.enable")}
			</a>
		</div>
	);
}
