import { useRef } from "react";
import * as THREE from "three";
import type { ThreeElements } from "@react-three/fiber";
import { useTimeline } from "../timeline";
import type { ComponentDefinition, ComponentRenderContext } from "../types";

/**
 * GSAP 内置示例（rfc/2026-08-20 §6 P0）：react 与 r3f 各一，验证 useTimeline 的
 * 确定性 seek 驱动（构造确定性 + 驱动靠 seek，Preview==Export 逐帧一致）。
 * 被动画的属性经 ref 由 GSAP 命令式持有，绝不写进 JSX props（rfc §4.1 I2）。
 */

function GsapRevealCard(_props: ComponentRenderContext) {
	const root = useRef<HTMLDivElement>(null);
	const titleRef = useRef<HTMLDivElement>(null);
	const subRef = useRef<HTMLDivElement>(null);
	useTimeline((tl) => {
		if (!root.current || !titleRef.current || !subRef.current) return;
		tl.fromTo(
			root.current,
			{ autoAlpha: 0, y: 24 },
			{ autoAlpha: 1, y: 0, duration: 0.5, ease: "power3.out" },
		)
			.fromTo(
				titleRef.current,
				{ x: -16, autoAlpha: 0 },
				{ x: 0, autoAlpha: 1, duration: 0.4, ease: "power2.out" },
				"-=0.25",
			)
			.fromTo(
				subRef.current,
				{ x: 16, autoAlpha: 0 },
				{ x: 0, autoAlpha: 1, duration: 0.4, ease: "power2.out" },
				"<",
			);
	}, []);
	return (
		<div
			ref={root}
			style={{
				width: "100%",
				height: "100%",
				display: "grid",
				placeItems: "center",
				fontFamily: "sans-serif",
			}}
		>
			<div
				style={{
					background: "#0f172a",
					color: "#f8fafc",
					borderRadius: 20,
					padding: "28px 44px",
					textAlign: "center",
					boxShadow: "0 16px 40px rgba(0,0,0,.3)",
				}}
			>
				<div ref={titleRef} style={{ fontSize: 40, fontWeight: 800, letterSpacing: -0.5 }}>
					Recut Motion
				</div>
				<div ref={subRef} style={{ marginTop: 8, fontSize: 18, color: "#94a3b8" }}>
					GSAP-powered title card
				</div>
			</div>
		</div>
	);
}
GsapRevealCard.displayName = "GSAP Reveal Card";

export const gsapRevealCardComponent: ComponentDefinition = {
	id: "gsap-reveal-card",
	name: "GSAP Reveal Card",
	group: "demo",
	surface: "react",
	keywords: ["gsap", "reveal", "title", "动效", "卡片", "标题"],
	color: "#6366f1",
	inputs: [],
	getBaseSize: () => ({ width: 640, height: 240 }),
	getContentBounds: () => ({ x: 0, y: 0, width: 640, height: 240 }),
	render: GsapRevealCard,
};

function GsapOrbit(_props: ComponentRenderContext) {
	const boxRef = useRef<THREE.Mesh>(null);
	const ringRef = useRef<THREE.Mesh>(null);
	useTimeline((tl) => {
		if (!boxRef.current || !ringRef.current) return;
		tl.to(boxRef.current.rotation, { y: Math.PI * 2, duration: 4, ease: "none" }, 0)
			.to(ringRef.current.rotation, { z: Math.PI * 2, duration: 6, ease: "none" }, 0)
			.fromTo(
				boxRef.current.position,
				{ y: -80 },
				{ y: 0, duration: 0.8, ease: "bounce.out" },
				0,
			)
			.fromTo(
				boxRef.current.scale,
				{ x: 0, y: 0, z: 0 },
				{ x: 1, y: 1, z: 1, duration: 0.6, ease: "back.out(1.8)" },
				0.1,
			);
	}, []);
	return (
		<group>
			<mesh ref={ringRef}>
				<torusGeometry args={[1.8, 0.06, 16, 48]} />
				<meshStandardMaterial color="#22d3ee" />
			</mesh>
			<mesh ref={boxRef} position={[0, 0, 0]}>
				<boxGeometry args={[0.9, 0.9, 0.9]} />
				<meshStandardMaterial color="#6366f1" />
			</mesh>
		</group>
	);
}
GsapOrbit.displayName = "GSAP Orbit";

export const gsapOrbitComponent: ComponentDefinition = {
	id: "gsap-orbit",
	name: "GSAP Orbit",
	group: "demo",
	surface: "r3f",
	keywords: ["gsap", "3d", "orbit", "旋转", "立方体", "循环"],
	color: "#22d3ee",
	inputs: [],
	getBaseSize: () => ({ width: 400, height: 400 }),
	render: GsapOrbit,
};