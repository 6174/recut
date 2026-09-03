import { useRef } from "@recut/runtime";
import { useTimeline } from "@recut/runtime";
import type { ContentBounds } from "@recut/runtime";

/**
 * GSAP 入场卡片（react surface，函数组件形态）：useTimeline 声明 paused Timeline，
 * 运行时逐帧 seek 到当前帧时间。被动画属性（autoAlpha/y/scale）经 ref 由 GSAP 命令式持有，
 * 不进 JSX props——每帧 React 重渲不会覆盖 GSAP 的写入。
 */
function GsapReveal({
  title = "Recut",
  color = "#6366f1",
}: {
  title?: string;
  color?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const badge = useRef<HTMLDivElement>(null);
  useTimeline((tl) => {
    if (!root.current || !badge.current) return;
    tl.fromTo(
      root.current,
      { autoAlpha: 0, y: 24 },
      { autoAlpha: 1, y: 0, duration: 0.6, ease: "power3.out" },
    )
      .fromTo(
        badge.current,
        { scale: 0.6, autoAlpha: 0 },
        { scale: 1, autoAlpha: 1, duration: 0.35, ease: "back.out(2)" },
        "-=0.2",
      );
  }, []);
  return (
    <div
      ref={root}
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "sans-serif",
      }}
    >
      <div
        ref={badge}
        style={{
          background: color,
          color: "#fff",
          fontWeight: 700,
          fontSize: 32,
          padding: "16px 28px",
          borderRadius: 16,
        }}
      >
        {title}
      </div>
    </div>
  );
}

GsapReveal.inputs = [
  { key: "title", type: "text", default: "Recut", label: "文案" },
  { key: "color", type: "color", default: "#6366f1", label: "主色" },
];
GsapReveal.getBaseSize = () => ({ width: 512, height: 512 });
GsapReveal.getContentBounds = (): ContentBounds => ({ x: 140, y: 206, width: 232, height: 100 });

export default GsapReveal;