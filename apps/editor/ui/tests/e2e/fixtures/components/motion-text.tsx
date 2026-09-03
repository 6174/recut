/**
 * [INPUT]: @recut/runtime 的 Unicode text segments 与 React surface。
 * [OUTPUT]: 字符粒度的稳定 span 目标，用于生产 HTML-in-Canvas MotionProgram 验证。
 * [POS]: 文本动画 E2E fixture；只验证真实 DOM root、CanvasDrawElement capture 与 seek。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { useMotionTextSegments } from "@recut/runtime";

function MotionText({ text = "ABC" }: { text?: string }) {
	const segments = useMotionTextSegments(text, "grapheme");
	return (
		<div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 8, width: "100%", height: "100%", font: "700 54px system-ui", color: "#ffffff" }}>
			{segments.map((segment) => (
				<span key={segment.id} ref={segment.ref} data-segment-id={segment.id}>
					{segment.text}
				</span>
			))}
		</div>
	);
}

MotionText.inputs = [
	{ key: "text", type: "text", default: "ABC", label: "Text" },
];
MotionText.getBaseSize = () => ({ width: 512, height: 180 });

export default MotionText;
