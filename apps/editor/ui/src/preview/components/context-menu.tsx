"use client";

import {
	ContextMenuCheckboxItem,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { usePreviewViewport } from "@/preview/components/preview-viewport";
import { useEditor } from "@/editor/use-editor";
import type { PreviewOverlayControl } from "@/preview/overlays";
import { toast } from "sonner";
import { t, useRecutLocale } from "@/i18n";

export function PreviewContextMenu({
	onToggleFullscreen,
	container,
	overlayControls,
	onOverlayVisibilityChange,
}: {
	onToggleFullscreen: () => void;
	container: HTMLElement | null;
	overlayControls: PreviewOverlayControl[];
	onOverlayVisibilityChange: (params: {
		overlayId: string;
		isVisible: boolean;
	}) => void;
}) {
	const locale = useRecutLocale();
	const editor = useEditor();
	const viewport = usePreviewViewport();

	const handleCopySnapshot = async () => {
		const result = await editor.renderer.copySnapshot();

		if (!result.success) {
			toast.error(t(locale, "preview.failedCopy"), {
				description: result.error ?? t(locale, "preview.tryAgain"),
			});
			return;
		}
	};

	const handleSaveSnapshot = async () => {
		const result = await editor.renderer.saveSnapshot();

		if (!result.success) {
			toast.error(t(locale, "preview.failedSave"), {
				description: result.error ?? t(locale, "preview.tryAgain"),
			});
			return;
		}
	};

	return (
		<ContextMenuContent className="w-56" container={container}>
			<ContextMenuItem onClick={viewport.fitToScreen} inset>
				{t(locale, "preview.fitToScreen")}
			</ContextMenuItem>
			<ContextMenuSeparator />
			<ContextMenuItem onClick={onToggleFullscreen} inset>
				{t(locale, "preview.fullScreen")}
			</ContextMenuItem>
			<ContextMenuItem onClick={handleSaveSnapshot} inset>
				{t(locale, "preview.saveSnapshot")}
			</ContextMenuItem>
			<ContextMenuItem onClick={handleCopySnapshot} inset>
				{t(locale, "preview.copySnapshot")}
			</ContextMenuItem>
			{overlayControls.length > 0 ? <ContextMenuSeparator /> : null}
			{overlayControls.map((overlayControl) => (
				<ContextMenuCheckboxItem
					key={overlayControl.id}
					checked={overlayControl.isVisible}
					onCheckedChange={(checked) =>
						onOverlayVisibilityChange({
							overlayId: overlayControl.id,
							isVisible: !!checked,
						})
					}
				>
					{overlayControl.labelKey ? t(locale, overlayControl.labelKey) : overlayControl.label}
				</ContextMenuCheckboxItem>
			))}
		</ContextMenuContent>
	);
}
