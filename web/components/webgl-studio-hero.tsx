/*
 * [INPUT]: 依赖 Three.js 的轻量 WebGL 渲染能力与 GSAP 时间轴，读取浏览器的尺寸、可见性和减少动态效果偏好
 * [OUTPUT]: 对外提供 WebGLStudioHero 背景组件，渲染半透明分层视频卡、播放符号与漂浮几何体
 * [POS]: components 的 Studio Header 专属视觉层；由 app/page.tsx 置于内容之下，不承载交互或业务状态
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

function roundedRect(width: number, height: number, radius: number) {
  const x = -width / 2;
  const y = -height / 2;
  const shape = new THREE.Shape();
  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + radius);
  shape.lineTo(x + width, y + height - radius);
  shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  shape.lineTo(x + radius, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - radius);
  shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y);
  return shape;
}

function frostedTexture(start: string, end: string, grain: number) {
  const textureCanvas = document.createElement("canvas");
  textureCanvas.width = 256;
  textureCanvas.height = 256;
  const context = textureCanvas.getContext("2d");
  if (!context) throw new Error("无法创建 WebGL 磨砂纹理。");
  const gradient = context.createLinearGradient(0, 0, 256, 256);
  gradient.addColorStop(0, start);
  gradient.addColorStop(0.52, "#f8fff9");
  gradient.addColorStop(1, end);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 256);
  for (let index = 0; index < grain * 1_800; index += 1) {
    const size = Math.random() > 0.9 ? 2 : 1;
    context.fillStyle = Math.random() > 0.52 ? "rgba(255, 255, 255, 0.18)" : "rgba(47, 132, 82, 0.09)";
    context.fillRect(Math.random() * 256, Math.random() * 256, size, size);
  }
  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

function glassPanel(width: number, height: number, opacity: number) {
  const geometry = new THREE.ExtrudeGeometry(roundedRect(width, height, 0.26), { bevelEnabled: true, bevelSegments: 4, bevelSize: 0.025, bevelThickness: 0.025, depth: 0.025 });
  geometry.center();
  const material = new THREE.MeshBasicMaterial({ map: frostedTexture("#ffffff", "#cbedda", 0.15), transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false });
  const panel = new THREE.Mesh(geometry, material);
  panel.renderOrder = 2;
  return panel;
}

function glassFrame(width: number, height: number, thickness: number) {
  const shape = roundedRect(width, height, 0.28);
  shape.holes.push(roundedRect(width - thickness * 2, height - thickness * 2, 0.16));
  const geometry = new THREE.ExtrudeGeometry(shape, { bevelEnabled: true, bevelSegments: 4, bevelSize: 0.03, bevelThickness: 0.03, depth: 0.08 });
  geometry.center();
  const frame = new THREE.Mesh(geometry, new THREE.MeshPhysicalMaterial({ map: frostedTexture("#b8ffcf", "#18b953", 0.09), color: 0xffffff, transparent: true, opacity: 0.78, emissive: 0x11943d, emissiveIntensity: 0.3, roughness: 0.4, clearcoat: 0.75, clearcoatRoughness: 0.28 }));
  frame.renderOrder = 1;
  return frame;
}

function playMark() {
  const shape = new THREE.Shape();
  shape.moveTo(-0.43, -0.48);
  shape.lineTo(-0.43, 0.39);
  shape.quadraticCurveTo(-0.43, 0.58, -0.27, 0.48);
  shape.lineTo(0.47, 0.08);
  shape.quadraticCurveTo(0.61, 0, 0.47, -0.08);
  shape.lineTo(-0.27, -0.57);
  shape.quadraticCurveTo(-0.43, -0.67, -0.43, -0.48);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { bevelEnabled: true, bevelSegments: 4, bevelSize: 0.04, bevelThickness: 0.05, depth: 0.12 });
  geometry.center();
  return new THREE.Mesh(geometry, new THREE.MeshPhysicalMaterial({ color: 0x32dc6a, emissive: 0x129c43, emissiveIntensity: 0.7, roughness: 0.18, metalness: 0, clearcoat: 0.9, clearcoatRoughness: 0.18 }));
}

function floatingCube(size: number) {
  const geometry = new RoundedBoxGeometry(size, size, size, 4, size * 0.18);
  const cube = new THREE.Group();
  const body = new THREE.Mesh(geometry, new THREE.MeshPhysicalMaterial({ color: 0xc9f7dc, transparent: true, opacity: 0.68, roughness: 0.38, transmission: 0.08, thickness: 0.55, clearcoat: 0.5, clearcoatRoughness: 0.3 }));
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 22), new THREE.LineBasicMaterial({ color: 0x8addaa, transparent: true, opacity: 0.32 }));
  cube.add(body, edges);
  return cube;
}

function softGlow() {
  const textureCanvas = document.createElement("canvas");
  textureCanvas.width = 128;
  textureCanvas.height = 128;
  const context = textureCanvas.getContext("2d");
  if (!context) throw new Error("无法创建 WebGL 光晕纹理。");
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, "rgba(106, 255, 159, 0.28)");
  gradient.addColorStop(0.48, "rgba(165, 255, 196, 0.12)");
  gradient.addColorStop(1, "rgba(238, 255, 243, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  const material = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(textureCanvas), transparent: true, depthWrite: false, blending: THREE.NormalBlending });
  const glow = new THREE.Sprite(material);
  glow.renderOrder = -1;
  return glow;
}

export function WebGLStudioHero() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, canvas });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setClearColor(0xffffff, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(27, 1, 0.1, 100);
    camera.position.set(2.65, 1.45, 8.9);
    camera.lookAt(0, 0.12, 0);

    const artwork = new THREE.Group();
    artwork.position.set(0.2, 0.04, 0);
    artwork.rotation.set(-0.16, -0.34, -0.05);
    scene.add(artwork);

    const backPanel = glassPanel(2.25, 2.85, 0.13);
    backPanel.position.set(1.12, 0.72, -0.95);
    backPanel.rotation.set(0.02, 0.02, 0.13);
    artwork.add(backPanel);

    const middlePanel = glassPanel(2.28, 2.88, 0.2);
    middlePanel.position.set(0.54, 0.42, -0.48);
    middlePanel.rotation.set(0.01, 0.02, 0.09);
    artwork.add(middlePanel);

    const greenFrame = glassFrame(2.08, 2.66, 0.22);
    greenFrame.position.set(0.12, 0.12, -0.06);
    greenFrame.rotation.set(-0.01, 0.03, -0.03);
    artwork.add(greenFrame);

    const frontPanel = glassPanel(2.22, 2.96, 0.32);
    frontPanel.position.set(-0.44, -0.16, 0.55);
    frontPanel.rotation.set(-0.015, -0.025, -0.055);
    artwork.add(frontPanel);

    const floorPanel = glassPanel(3.4, 1.1, 0.13);
    floorPanel.position.set(-0.1, -1.52, -0.72);
    floorPanel.rotation.set(0.95, 0.02, -0.02);
    artwork.add(floorPanel);

    const mark = playMark();
    mark.position.set(-0.08, -0.12, 0.86);
    mark.rotation.set(-0.02, -0.03, -0.055);
    mark.scale.setScalar(1.12);
    artwork.add(mark);

    const cubes = [
      { cube: floatingCube(0.45), position: [-1.98, 0.55, -0.32] as const },
      { cube: floatingCube(0.55), position: [1.9, 1.18, -0.58] as const },
      { cube: floatingCube(0.46), position: [1.86, -1.28, 0.22] as const },
    ];
    cubes.forEach(({ cube, position }, index) => { cube.position.set(position[0], position[1], position[2]); cube.rotation.set(0.22 + index * 0.08, -0.25 + index * 0.12, 0.1); artwork.add(cube); });

    const halo = softGlow();
    halo.position.set(-0.12, -0.05, -1.35);
    halo.scale.set(4.5, 4.5, 1);
    artwork.add(halo);

    scene.add(new THREE.HemisphereLight(0xffffff, 0xc9f6df, 2.4));
    const keyLight = new THREE.PointLight(0x98ffbd, 18, 12, 2);
    keyLight.position.set(-2.6, 2.6, 4.8);
    scene.add(keyLight);
    const fillLight = new THREE.PointLight(0xffefb1, 7, 8, 2);
    fillLight.position.set(-0.8, -2.15, 3.4);
    scene.add(fillLight);

    const pointer = { x: 0, y: 0 };
    const baseRotation = { x: artwork.rotation.x, y: artwork.rotation.y };
    const onPointerMove = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      pointer.x = ((event.clientX - bounds.left) / bounds.width - 0.5) * 2;
      pointer.y = ((event.clientY - bounds.top) / bounds.height - 0.5) * 2;
    };
    canvas.parentElement?.addEventListener("pointermove", onPointerMove);

    const timeline = gsap.timeline({ defaults: { ease: "power2.out" } });
    if (!reducedMotion) {
      timeline.fromTo(artwork.scale, { x: 0.72, y: 0.72, z: 0.72 }, { x: 1, y: 1, z: 1, duration: 1.2 })
        .fromTo(artwork.position, { y: -0.3 }, { y: 0.04, duration: 1.1 }, "<")
        .fromTo(backPanel.material, { opacity: 0 }, { opacity: 0.13, duration: 0.65 }, "<0.1")
        .fromTo(middlePanel.material, { opacity: 0 }, { opacity: 0.2, duration: 0.65 }, "<0.12")
        .fromTo(greenFrame.material, { opacity: 0 }, { opacity: 0.78, duration: 0.7 }, "<0.12")
        .fromTo(frontPanel.material, { opacity: 0 }, { opacity: 0.32, duration: 0.7 }, "<0.12")
        .fromTo(floorPanel.material, { opacity: 0 }, { opacity: 0.13, duration: 0.65 }, "<0.12");
      gsap.to(artwork.position, { y: "+=0.17", duration: 3.4, ease: "sine.inOut", yoyo: true, repeat: -1 });
      gsap.to(mark.rotation, { z: "+=0.075", duration: 2.8, ease: "sine.inOut", yoyo: true, repeat: -1 });
      cubes.forEach(({ cube }, index) => gsap.to(cube.position, { y: `+=${0.12 + index * 0.035}`, duration: 2.3 + index * 0.65, ease: "sine.inOut", yoyo: true, repeat: -1 }));
    }

    let frame = 0;
    let visible = true;
    const render = () => {
      frame = requestAnimationFrame(render);
      if (!visible) return;
      artwork.rotation.x += (baseRotation.x - pointer.y * 0.06 - artwork.rotation.x) * 0.035;
      artwork.rotation.y += (baseRotation.y + pointer.x * 0.1 - artwork.rotation.y) * 0.035;
      renderer.render(scene, camera);
    };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }, { threshold: 0.05 });
    observer.observe(canvas);
    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    resize();
    render();

    return () => {
      cancelAnimationFrame(frame);
      timeline.kill();
      gsap.killTweensOf([artwork.position, mark.rotation, ...cubes.map(({ cube }) => cube.position)]);
      observer.disconnect();
      resizeObserver.disconnect();
      canvas.parentElement?.removeEventListener("pointermove", onPointerMove);
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => {
            const texturedMaterial = material as THREE.Material & { map?: THREE.Texture | null };
            texturedMaterial.map?.dispose();
            material.dispose();
          });
        }
        if (object instanceof THREE.Sprite) {
          object.material.map?.dispose();
          object.material.dispose();
        }
      });
      renderer.dispose();
    };
  }, []);

  return <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 hidden w-[52%] overflow-hidden sm:block"><canvas className="size-full" ref={canvasRef} /></div>;
}
