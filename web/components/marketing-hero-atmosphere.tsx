/**
 * [INPUT]: 依赖 Three.js WebGL 渲染、Hero 容器尺寸、指针位置与 prefers-reduced-motion
 * [OUTPUT]: 对外提供 MarketingHeroAtmosphere，渲染低频流体渐变、细颗粒与边缘暗角的透明背景层
 * [POS]: components 官网 Hero 的材质层；只负责视觉，不承载文本、导航或业务状态
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  uniform vec2 uResolution;
  uniform vec2 uPointer;
  uniform float uTime;
  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), f.x), f.y);
  }

  float fbm(vec2 p) {
    float value = 0.0;
    value += noise(p) * 0.5;
    value += noise(p * 2.03) * 0.25;
    value += noise(p * 4.07) * 0.125;
    return value / 0.875;
  }

  void main() {
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 p = (vUv - 0.5) * vec2(aspect, 1.0);
    // 运动只作为呼吸感，不让纹理在视野里产生抖动。
    float t = uTime * 0.006;
    float field = fbm(p * 1.35 + vec2(t * 0.9, -t * 0.55));
    vec2 pointer = (uPointer - 0.5) * vec2(aspect, 1.0);
    float warm = exp(-length(p - vec2(-aspect * 0.2, 0.18)) * 1.7);
    float green = exp(-length(p - vec2(aspect * 0.18, -0.04)) * 1.55);
    float blue = exp(-length(p - vec2(aspect * 0.36, 0.28)) * 1.9);
    // 光标是暗底上的唯一亮点：窄、亮、缓慢跟手，不扩散成整片泛白。
    float cursorGlow = exp(-length(p - pointer) * 4.2) * 0.24;
    vec3 color = vec3(0.009, 0.018, 0.014);
    color += vec3(0.95, 0.34, 0.20) * warm * (0.075 + field * 0.05);
    color += vec3(0.08, 0.82, 0.42) * green * (0.065 + field * 0.045);
    color += vec3(0.22, 0.38, 0.96) * blue * (0.055 + field * 0.038);
    color += vec3(0.05, 0.08, 0.065) * field;
    // 颗粒固定在画面空间，用多尺度噪声形成自然的团簇，避免白噪声的均匀撒点感。
    vec2 grainUv = vUv * vec2(aspect, 1.0);
    float grain = fbm(grainUv * 22.0 + vec2(4.7, -2.3));
    grain += noise(grainUv * 78.0 + vec2(-6.1, 8.4)) * 0.22;
    grain = grain - 0.61;
    float vignette = smoothstep(1.15, 0.25, length(p * vec2(0.72, 1.0)));
    color += grain * 0.09;
    // 背景整体压到原来的约三分之一，光标高光单独保留对比度。
    color *= 0.34;
    color += vec3(0.42, 1.0, 0.62) * cursorGlow;
    color *= 0.62 + vignette * 0.38;
    gl_FragColor = vec4(color, 0.72);
  }
`;

export function MarketingHeroAtmosphere() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, canvas, powerPreference: "low-power" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const pointerTarget = new THREE.Vector2(0.5, 0.5);
    const uniforms = { uResolution: { value: new THREE.Vector2(1, 1) }, uPointer: { value: pointerTarget.clone() }, uTime: { value: 0 } };
    const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, transparent: true, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    scene.add(mesh);

    let visible = true;
    let frame = 0;
    const resize = () => {
      const { width, height } = host.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      uniforms.uResolution.value.set(width, height);
    };
    const onPointerMove = (event: PointerEvent) => {
      const bounds = host.getBoundingClientRect();
      pointerTarget.set((event.clientX - bounds.left) / bounds.width, 1 - (event.clientY - bounds.top) / bounds.height);
    };
    const render = (time: number) => {
      frame = requestAnimationFrame(render);
      if (!visible) return;
      uniforms.uTime.value = reducedMotion ? 0 : time * 0.001;
      uniforms.uPointer.value.lerp(pointerTarget, 0.035);
      renderer.render(scene, camera);
    };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }, { threshold: 0.02 });
    const resizeObserver = new ResizeObserver(resize);
    observer.observe(host);
    resizeObserver.observe(host);
    host.addEventListener("pointermove", onPointerMove);
    resize();
    render(0);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      resizeObserver.disconnect();
      host.removeEventListener("pointermove", onPointerMove);
      mesh.geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
  }, []);

  // 内联几何约束是故意的：开发服务器热更新 CSS 时也不能让 canvas 回到静态流布局，
  // 否则 renderer.setSize 会把父级高度反馈给自己，内容会被推到视口之外。
  return <canvas aria-hidden="true" className="marketing-hero-atmosphere" ref={canvasRef} style={{ position: "absolute", inset: 0, zIndex: 0, width: "100%", height: "100%", pointerEvents: "none" }} />;
}
