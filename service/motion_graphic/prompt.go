/*
 * [INPUT]: 无（本文件由 apps/editor/background/components.js 的提示词/骨架生成，保持受限子 Agent 作者契约一致）。
 * [OUTPUT]: motion-graphic.create/revise 的作者 prompt 与 type-complete 骨架常量，以及 prompt 组装函数。
 * [POS]: service MG 素材操作的提示词层；平台拥有框架，模型只拥有内容。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package motion_graphic

import (
	"fmt"
	"strconv"
	"strings"
)

const mgAuthorHeader = "You are a focused Component Author running in General mode. Do not inspect tools, read skills, use shell/files, or emit commentary. Think and implement normally, then finish by calling mcp__component_author__recut_editor_motion_graphic_commit. Do not return component JSON in chat and do not call any timeline operation: this tool is already bound to the correct project and commits a component-library asset only.\n\nAuthoring contract:\n- Choose html for DOM/card/text visuals, react for JSX interaction-free composition, r3f for real 3D only.\n- The only external import allowed is @recut/runtime. JSX uses that runtime automatically; do not import React or any other package.\n- TYPE MANDATE (hard rule): every parameter MUST carry an explicit type annotation. Use render(ctx: any), or better render(ctx: ComponentRenderContext) with `import type { ComponentRenderContext } from \"@recut/runtime\"`. Every inline arrow/map/for callback parameter MUST be typed, e.g. (i: number) => ..., (item: string) => .... Untyped parameters are rejected; the platform does not guess.\n- Inputs must be ParamDefinition[] objects: {key,label?,type?,default,min?,max?,step?}. Use an array, never an object map.\n- The default export must be ONE of two accepted shapes (the platform validates shape at build time):\n  A) A definition object: export default { surface, name, keywords?, inputs?, render(ctx), getBaseSize?, getContentBounds? } — render(ctx) returns the surface output (html string / JSX / R3F tree).\n  B) A pure function component (react surface): export default function MyComp(props) {...} — props = ctx fields (progress, localTime, time, params, anim) plus your inputs spread as top-level props. Attach getBaseSize/getContentBounds/inputs as static properties on the function.\n- Include sensible base size and stable content bounds when appropriate.\n- ANIMATION: For react/r3f, use GSAP via useTimeline (import { useTimeline } from \"@recut/runtime\") — build a paused timeline once and the runtime seeks it to the current frame time. For html surface use ctx.anim helpers. HARD RULES: timelines must be paused and driven only by seek/progress (never .play()/.restart()/.resume()); animated properties must NOT appear as time-varying JSX props (use refs and let GSAP write them); never use ScrollTrigger/ScrollSmoother/Draggable/Inertia/Observer/gsap.utils.random; no wall-clock APIs, timers, randomness, requestAnimationFrame, network, or browser storage. Use refs as targets (DOM nodes for react, Object3D for r3f).\n- Keep the result compact, visually legible at video scale, and self-contained.\n- If motion-graphic.commit reports a build error, fix THAT exact error first (especially missing type annotations on ctx / arrow params) before committing again. Do not re-submit the same pattern that just failed.\n"

const mgFeatureChipSkeleton = "import { str } from \"@recut/runtime\";\nimport type { ComponentRenderContext } from \"@recut/runtime\";\n\nfunction escapeHtml(value: unknown) {\n  return String(value).replace(/[&<>\"']/g, (char) => ({ \"&\": \"&amp;\", \"<\": \"&lt;\", \">\": \"&gt;\", '\"': \"&quot;\", \"'\": \"&#39;\" }[char] ?? char));\n}\n\nexport default {\n  surface: \"html\",\n  name: \"Feature Chip\",\n  keywords: [\"chip\", \"badge\", \"feature\"],\n  inputs: [\n    { key: \"title\", type: \"text\", default: \"Feature\", label: \"主标题\" },\n    { key: \"subtitle\", type: \"text\", default: \"Ready to use\", label: \"副标题\" },\n    { key: \"accent\", type: \"color\", default: \"#38bdf8\", label: \"强调色\" },\n    { key: \"icon\", type: \"text\", default: \"✦\", label: \"图标\" },\n  ],\n  getBaseSize: () => ({ width: 520, height: 150 }),\n  getContentBounds: () => ({ x: 12, y: 12, width: 496, height: 126 }),\n  render(ctx: ComponentRenderContext) {\n    const title = escapeHtml(str(ctx.params.title, \"Feature\"));\n    const subtitle = escapeHtml(str(ctx.params.subtitle, \"Ready to use\"));\n    const accent = escapeHtml(str(ctx.params.accent, \"#38bdf8\"));\n    const icon = escapeHtml(str(ctx.params.icon, \"✦\"));\n    const rise = ctx.anim.lerp(18, 0, Math.min(1, ctx.progress * 4), { ease: \"outCubic\" });\n    const opacity = Math.min(1, ctx.progress * 5);\n    return `<div style=\"box-sizing:border-box;width:100%;height:100%;display:flex;align-items:center;gap:18px;padding:18px 22px;border:1px solid ${accent};border-radius:28px;background:rgba(9,16,29,.9);box-shadow:0 10px 28px rgba(0,0,0,.28);color:#f8fafc;font-family:ui-sans-serif,system-ui,sans-serif;transform:translateY(${rise}px);opacity:${opacity}\"><span style=\"display:grid;place-items:center;width:54px;height:54px;border-radius:18px;background:${accent};color:#0f172a;font-size:27px;font-weight:800\">${icon}</span><span style=\"display:grid;gap:5px\"><strong style=\"font-size:24px;line-height:1.05;letter-spacing:-.4px\">${title}</strong><small style=\"font-size:15px;line-height:1;color:#cbd5e1\">${subtitle}</small></span></div>`;\n  },\n};\n"

const mgFeatureChipGsapSkeleton = "import { useRef, useTimeline } from \"@recut/runtime\";\n\nexport default function FeatureChip(props: any) {\n  const root = useRef<HTMLDivElement>(null);\n  const iconRef = useRef<HTMLSpanElement>(null);\n  const p = props || {};\n  const title = String(p.title ?? \"Feature\");\n  const subtitle = String(p.subtitle ?? \"Ready to use\");\n  const accent = String(p.accent ?? \"#38bdf8\");\n  const icon = String(p.icon ?? \"✦\");\n  useTimeline((tl) => {\n    if (!root.current || !iconRef.current) return;\n    tl.fromTo(root.current, { y: 24, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.55, ease: \"power3.out\" })\n      .fromTo(iconRef.current, { scale: 0.6, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.35, ease: \"back.out(2)\" }, \"-=0.2\");\n  }, []);\n  return (\n    <div ref={root} style={{ boxSizing: \"border-box\", width: \"100%\", height: \"100%\", display: \"flex\", alignItems: \"center\", gap: 18, padding: \"18px 22px\", border: `1px solid ${accent}`, borderRadius: 28, background: \"rgba(9,16,29,.9)\", boxShadow: \"0 10px 28px rgba(0,0,0,.28)\", color: \"#f8fafc\", fontFamily: \"ui-sans-serif, system-ui, sans-serif\" }}>\n      <span ref={iconRef} style={{ display: \"grid\", placeItems: \"center\", width: 54, height: 54, borderRadius: 18, background: accent, color: \"#0f172a\", fontSize: 27, fontWeight: 800 }}>{icon}</span>\n      <span style={{ display: \"grid\", gap: 5 }}>\n        <strong style={{ fontSize: 24, lineHeight: 1.05, letterSpacing: \"-0.4px\" }}>{title}</strong>\n        <small style={{ fontSize: 15, lineHeight: 1, color: \"#cbd5e1\" }}>{subtitle}</small>\n      </span>\n    </div>\n  );\n}\nFeatureChip.inputs = [\n  { key: \"title\", type: \"text\", default: \"Feature\", label: \"主标题\" },\n  { key: \"subtitle\", type: \"text\", default: \"Ready to use\", label: \"副标题\" },\n  { key: \"accent\", type: \"color\", default: \"#38bdf8\", label: \"强调色\" },\n  { key: \"icon\", type: \"text\", default: \"✦\", label: \"图标\" },\n];\nFeatureChip.getBaseSize = () => ({ width: 520, height: 150 });\nFeatureChip.getContentBounds = () => ({ x: 12, y: 12, width: 496, height: 126 });\n"

const mgFullscreenSkeletonFmt = "import { str } from \"@recut/runtime\";\nimport type { ComponentRenderContext } from \"@recut/runtime\";\n\nexport default {\n  surface: \"html\",\n  name: \"Fullscreen Feature\",\n  keywords: [\"feature\", \"fullscreen\"],\n  inputs: [\n    { key: \"title\", type: \"text\", default: \"主标题\", label: \"主标题\" },\n    { key: \"subtitle\", type: \"text\", default: \"一行辅助说明\", label: \"辅助说明\" },\n    { key: \"background\", type: \"text\", default: \"transparent\", label: \"背景（transparent/light/dark）\" },\n    { key: \"textColor\", type: \"text\", default: \"#0f172a\", label: \"文字颜色\" },\n    { key: \"accent\", type: \"color\", default: \"#22c55e\", label: \"强调色\" },\n  ],\n  getBaseSize: () => ({ width: {{W}}, height: {{H}} }),\n  getContentBounds: () => ({ x: 0, y: 0, width: {{W}}, height: {{H}} }),\n  render(ctx: ComponentRenderContext) {\n    const { params, progress } = ctx;\n    const p = params || {};\n    const title = str(p.title, \"主标题\");\n    const subtitle = str(p.subtitle, \"一行辅助说明\");\n    const bg = str(p.background, \"transparent\");\n    const color = str(p.textColor, \"#0f172a\");\n    const ease = (k: number): number => 1 - Math.pow(1 - Math.max(0, Math.min(1, k)), 3);\n    const enter = ease(progress / 0.2);\n    const ty = (1 - enter) * 60;\n    return `<div style=\"position:absolute;inset:0;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;${bg === \"transparent\" ? \"\" : \"background:\" + bg + \";\"}color:${color};font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;opacity:${enter.toFixed(3)};transform:translateY(${ty.toFixed(1)}px);\">\n  <div style=\"font-size:176px;font-weight:800;line-height:1.12;letter-spacing:6px;text-align:center;\">${title}</div>\n  <div style=\"width:560px;height:60px;margin-top:64px;border-radius:30px;background:linear-gradient(90deg,#22c55e 0%,#22d3ee 100%);\"></div>\n  <div style=\"margin-top:64px;font-size:46px;letter-spacing:4px;text-align:center;\">${subtitle}</div>\n</div>`;\n  },\n};\n"

const mgFullscreenGsapSkeletonFmt = "import { useRef, useTimeline } from \"@recut/runtime\";\n\nexport default function FullscreenFeature(props: any) {\n  const root = useRef<HTMLDivElement>(null);\n  const titleRef = useRef<HTMLDivElement>(null);\n  const barRef = useRef<HTMLDivElement>(null);\n  const subRef = useRef<HTMLDivElement>(null);\n  const p = props || {};\n  const title = String(p.title ?? \"主标题\");\n  const subtitle = String(p.subtitle ?? \"一行辅助说明\");\n  const bg = String(p.background ?? \"transparent\");\n  const color = String(p.textColor ?? \"#0f172a\");\n  useTimeline((tl) => {\n    if (!root.current || !titleRef.current || !barRef.current || !subRef.current) return;\n    tl.fromTo(root.current, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.4, ease: \"power1.out\" }, 0)\n      .fromTo(titleRef.current, { y: 60, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.7, ease: \"power3.out\" }, 0.1)\n      .fromTo(barRef.current, { scaleX: 0, autoAlpha: 0 }, { scaleX: 1, autoAlpha: 1, duration: 0.5, ease: \"power2.out\" }, 0.35)\n      .fromTo(subRef.current, { y: 24, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.5, ease: \"power2.out\" }, 0.5);\n  }, []);\n  return (\n    <div ref={root} style={{ position: \"absolute\", inset: 0, width: \"100%\", height: \"100%\", display: \"flex\", flexDirection: \"column\", alignItems: \"center\", justifyContent: \"center\", backgroundColor: bg === \"transparent\" ? \"transparent\" : bg, color, fontFamily: \"-apple-system,'PingFang SC','Microsoft YaHei',sans-serif\" }}>\n      <div ref={titleRef} style={{ fontSize: 176, fontWeight: 800, lineHeight: 1.12, letterSpacing: 6, textAlign: \"center\" }}>{title}</div>\n      <div ref={barRef} style={{ width: 560, height: 60, marginTop: 64, borderRadius: 30, background: \"linear-gradient(90deg,#22c55e 0%,#22d3ee 100%)\" }} />\n      <div ref={subRef} style={{ marginTop: 64, fontSize: 46, letterSpacing: 4, textAlign: \"center\" }}>{subtitle}</div>\n    </div>\n  );\n}\nFullscreenFeature.inputs = [\n  { key: \"title\", type: \"text\", default: \"主标题\", label: \"主标题\" },\n  { key: \"subtitle\", type: \"text\", default: \"一行辅助说明\", label: \"辅助说明\" },\n  { key: \"background\", type: \"text\", default: \"transparent\", label: \"背景（transparent/light/dark）\" },\n  { key: \"textColor\", type: \"text\", default: \"#0f172a\", label: \"文字颜色\" },\n  { key: \"accent\", type: \"color\", default: \"#22c55e\", label: \"强调色\" },\n];\nFullscreenFeature.getBaseSize = () => ({ width: {{W}}, height: {{H}} });\nFullscreenFeature.getContentBounds = () => ({ x: 0, y: 0, width: {{W}}, height: {{H}} });\n"

func fillSize(tmpl string, w, h int) string {
	out := strings.ReplaceAll(tmpl, "{{W}}", strconv.Itoa(w))
	return strings.ReplaceAll(out, "{{H}}", strconv.Itoa(h))
}

func mgFullscreenSkeleton(w, h int) string {
	return fillSize(mgFullscreenSkeletonFmt, w, h)
}

func mgFullscreenGsapSkeleton(w, h int) string {
	return fillSize(mgFullscreenGsapSkeletonFmt, w, h)
}

// mgSkeletonSource 只用于选 skeleton；返回空串表示无骨架（自由创作）。
func SkeletonSource(item map[string]any, canvas map[string]any) string {
	id := str(item["template"])
	if id == "" {
		if role := str(item["role"]); strings.Contains(role, "feature") || strings.Contains(role, "chip") {
			id = "feature-chip"
		}
	}
	brief := str(item["brief"])
	lower := strings.ToLower(brief)
	wantsGsap := strings.Contains(lower, "gsap") || strings.Contains(lower, "timeline") ||
		strings.Contains(lower, "stagger") || strings.Contains(lower, "animate") || strings.Contains(lower, "animation") ||
		strings.Contains(brief, "动画") || strings.Contains(brief, "动效") || strings.Contains(brief, "入场")
	w, h := 1920, 1080
	if canvas != nil {
		if v := int(number(canvas["width"])); v > 0 {
			w = v
		}
		if v := int(number(canvas["height"])); v > 0 {
			h = v
		}
	}
	mode := str(item["mode"])
	if wantsGsap {
		if id == "feature-chip" || id == "gsap-chip" {
			return mgFeatureChipGsapSkeleton
		}
		if mode == "fullscreen" || id == "fullscreen" || id == "feature-fullscreen" {
			return mgFullscreenGsapSkeleton(w, h)
		}
	}
	if id == "feature-chip" {
		return mgFeatureChipSkeleton
	}
	if mode == "fullscreen" || id == "fullscreen" || id == "feature-fullscreen" {
		return mgFullscreenSkeleton(w, h)
	}
	return ""
}

func CreatePrompt(items []any, canvas, composition map[string]any) string {
	parts := []string{mgAuthorHeader}
	parts = append(parts, fmt.Sprintf("Create %d component(s). Call motion-graphic.commit once per item; each commit produces one distinct component. Match each commit to the item with the same index (nameHint/role below).\n", len(items)))
	w, h := 1920, 1080
	if canvas != nil {
		if v := int(number(canvas["width"])); v > 0 {
			w = v
		}
		if v := int(number(canvas["height"])); v > 0 {
			h = v
		}
	}
	for i, itemValue := range items {
		item := asMap(itemValue)
		if item == nil {
			item = map[string]any{}
		}
		parts = append(parts, fmt.Sprintf("=== Item %d ===", i+1))
		if v := str(item["nameHint"]); v != "" {
			parts = append(parts, "nameHint: "+v)
		}
		if v := str(item["role"]); v != "" {
			parts = append(parts, "role: "+v)
		}
		if v := str(item["mode"]); v != "" {
			parts = append(parts, "mode: "+v)
		}
		parts = append(parts, "brief: "+str(item["brief"]))
		if str(item["mode"]) == "fullscreen" {
			parts = append(parts, fmt.Sprintf("\nThis is a FULLSCREEN component: it must fill the entire canvas. Set getBaseSize to the canvas size (%dx%d) and design to fill it edge-to-edge. If a canvas size is not yet set, default to %dx%d.", w, h, w, h))
		}
		if skeleton := SkeletonSource(item, canvas); skeleton != "" {
			parts = append(parts, "\nUse this TYPE-ANNOTATED skeleton as the starting point (adapt its render body to the brief; keep its signature/inputs/transparency defaults unless the brief requires otherwise):\n"+skeleton)
		}
		if composition != nil && composition["overMedia"] == true {
			parts = append(parts, "\nCOMPOSITION: this component will be composited on top of existing video/image footage. Rules:\n- background DEFAULTS to transparent — do NOT paint an opaque full-canvas background unless the brief explicitly requires one.\n- Choose textColor/graphics for high contrast against the underlying footage. Without a luminance sample, default to dark text (#0f172a) with subtle shadow; if the brief states the footage is dark, use light text.\n- Expose background / textColor / accent as inputs so the user can tweak colors without editing source.")
		}
		parts = append(parts, "")
	}
	return strings.Join(parts, "\n")
}

func RevisePrompt(instruction, source string) string {
	return mgAuthorHeader +
		"Produce a new version of the existing component. Current source is provided only as a reference. Preserve its public inputs and visual identity unless the instruction requires otherwise. Fix the following request:\n" +
		instruction + "\n\nCurrent source:\n" + source
}
