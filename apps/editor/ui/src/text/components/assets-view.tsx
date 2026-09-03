/**
 * [INPUT]: 依赖统一资源卡片、素材面板骨架、编辑器时间线插入能力与本地化文本默认值。
 * [OUTPUT]: 对外提供 TextView；以与素材/组件相同的自适应资源网格提供默认文本卡片。
 * [POS]: text/components 的资源入口；单项也保持标准卡片宽度，不会撑满左侧面板。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import {
	DraggableItem,
	RESOURCE_CARD_ASPECT_RATIO,
} from "@/components/editor/panels/assets/draggable-item";
import { PanelView } from "@/components/editor/panels/assets/views/base-panel";
import { useEditor } from "@/editor/use-editor";
import { DEFAULTS } from "@/timeline/defaults";
import { buildTextElement } from "@/timeline/element-utils";
import type { MediaTime } from "@/wasm";
import { t, useRecutLocale } from "@/i18n";

export function TextView() {
	const editor = useEditor();
	const locale = useRecutLocale();
	const defaultText = t(locale, "timeline.defaultText");

	const handleAddToTimeline = ({ currentTime }: { currentTime: MediaTime }) => {
		const activeScene = editor.scenes.getActiveScene();
		if (!activeScene) return;

		const element = buildTextElement({
			raw: {
				...DEFAULTS.text.element,
				name: t(locale, "timeline.defaultTextName"),
				params: {
					...DEFAULTS.text.element.params,
					content: defaultText,
				},
			},
			startTime: currentTime,
		});

		editor.timeline.insertElement({
			element,
			placement: { mode: "auto" },
		});
	};

	return (
		<PanelView hideHeader>
			<div
				className="grid gap-2"
				style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 7rem), 1fr))" }}
			>
				<DraggableItem
					name={defaultText}
					preview={
						<div className="bg-muted/30 flex size-full items-center justify-center rounded-md">
							<span className="text-foreground/80 text-xs font-medium select-none">
								{defaultText}
							</span>
						</div>
					}
					dragData={{
						id: "temp-text-id",
						type: DEFAULTS.text.element.type,
						name: DEFAULTS.text.element.name,
						content: defaultText,
					}}
					aspectRatio={RESOURCE_CARD_ASPECT_RATIO}
					onAddToTimeline={handleAddToTimeline}
				/>
			</div>
		</PanelView>
	);
}
