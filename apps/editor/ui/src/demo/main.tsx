import { createRoot } from "react-dom/client";
import { EditorShell } from "@/editor/editor-shell";
import { EditorCore } from "@/core";
import { generateDemoImage, generateDemoVideo } from "./demo-media";
import { buildDemoProject } from "./demo-project";
import { setDemoState } from "./demo-store";
import "@/globals.css";

/** /demo.html：脱离 Recut 宿主的编辑器调试入口，注入离线 demo 数据。 */
async function bootstrap() {
	(window as any).__recutDemo = true;

	if (new URLSearchParams(window.location.search).has("test")) {
		const { installRecutTestBridge } = await import("@/test/bridge");
		installRecutTestBridge();
	}

	try {
		const [imageAsset, videoAsset] = await Promise.all([
			generateDemoImage(),
			generateDemoVideo(),
		]);
		const assets = [imageAsset, videoAsset];
		const project = buildDemoProject(assets);
		setDemoState({ project, assets });
	} catch (error) {
		console.error("[demo] failed to build demo data:", error);
		setDemoState({ project: null, assets: [] });
	}

	// 调试钩子：模拟修改文字内容，验证 HIC 重绘闭环
	(window as any).__demoEditText = (text: string) => {
		const editor = EditorCore.getInstance();
		const scene = editor.scenes.getActiveSceneOrNull();
		if (!scene) return false;
		const track = scene.tracks.overlay.find((t) => t.type === "text");
		const element = track?.elements[0];
		if (!track || !element) return false;
		editor.timeline.updateElements({
			updates: [
				{
					trackId: track.id,
					elementId: element.id,
					patch: { params: { ...element.params, content: text } },
				},
			],
		});
		return true;
	};

	// 调试钩子：模拟修改文字字号，验证 fontSize 缩放语义（scaled = fontSize × canvasHeight / 90）
	(window as any).__demoEditFontSize = (fontSize: number) => {
		const editor = EditorCore.getInstance();
		const scene = editor.scenes.getActiveSceneOrNull();
		if (!scene) return false;
		const track = scene.tracks.overlay.find((t) => t.type === "text");
		const element = track?.elements[0];
		if (!track || !element) return false;
		editor.timeline.updateElements({
			updates: [
				{
					trackId: track.id,
					elementId: element.id,
					patch: { params: { ...element.params, fontSize } },
				},
			],
		});
		return true;
	};

	createRoot(document.getElementById("root")!).render(
		<EditorShell projectId="demo-project" />,
	);
}

void bootstrap();
