/*
 * [INPUT]: 依赖 Three.js（WebGL 渲染、曲线、几何、材质、Canvas 纹理）、逐语言输入标签与平台标签（props）、浏览器的尺寸 / 可见性 / 减少动态效果偏好
 * [OUTPUT]: 对外提供 MarketingWorldStage——首页第一区块的 3D 舞台：左侧四类「真实形态」的输入卡（文稿页面 / 视频片段 / 文章页 / 账号主页）
 *   沿流动贝塞尔曲线汇入中心世界观模型（越近越小、带侧向散开、随后淡出），右侧产出三张 9:16 竖版成片卡（带 YouTube / TikTok / 小红书 平台标签）
 *   沿曲线逐条落位；曲线亮度朝核心渐亮、流粒子沿线流动，表达「输入 → 世界观 → 成片」
 * [POS]: web/components 的官网首页 3D 表现层；每类卡的界面用 Canvas 纹理自绘、不依赖网络素材，指针视差、离屏暂停、尊重 prefers-reduced-motion
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

const ACCENTS = ["#7fe6a8", "#ffd479", "#9fb2ff", "#ff9fc4"];
const PLATFORM_COLORS = ["#ff4d4d", "#25f4ee", "#ff2442"];
const CARD_FONT = '"Space Grotesk", "Smiley Sans", "PingFang SC", "Noto Sans SC", system-ui, sans-serif';
const TEXTURE_ERROR = "marketing-world-stage: 2D canvas context unavailable";

/** 四类输入：文稿 / 视频 / 文章 / 账号，各自的入场高度与卡面尺寸。 */
const INPUT_SPECS = [
  { y: -2.72, z: -1.2 },
  { y: -0.92, z: 0.86 },
  { y: 0.92, z: -0.86 },
  { y: 2.72, z: 1.2 },
];
const CARD_SIZES = [
  { w: 0.96, h: 1.28 }, // 文稿：竖版页面
  { w: 1.5, h: 0.84 }, // 视频：16:9 片段
  { w: 1.4, h: 1 }, // 文章：网页卡片
  { w: 1.3, h: 1 }, // 账号：主页卡片
];
const INPUT_PER_CURVE = 3;
/** 右侧三张 9:16 竖版成片，横向铺开一列，让右半画面与左侧等重。 */
const OUTPUT_SLOTS = [
  { x: 4.7, y: 0.5, z: 0.35 },
  { x: 6.75, y: -0.12, z: 0 },
  { x: 8.8, y: 0.44, z: -0.35 },
];
const OUTPUT_SIZE = { w: 1.4, h: 2.5 };
/** 成片节奏：每条视频的周期（秒）、三条错开量，以及「飞入 / 停留 / 发布滑出」的相位。 */
const OUTPUT_CYCLE = 7;
const OUTPUT_CYCLE_STAGGER = 1.1;
const OUTPUT_ARRIVE = 0.3;
const OUTPUT_EXIT = 0.86;
const FLOW_COUNT = 150;
/** 左侧「素材流」尘点：没有卡片经过的瞬间，左半画面也不该是空的。 */
const MOTE_COUNT = 360;
const MOTE_SPAN_X = 11.6;
/** 每条输入拖尾的采样点数（多段曲线，够顺滑即可）。 */
const TRAIL_POINTS = 22;
const CORE_GREEN = new THREE.Color(0.34, 0.95, 0.6);

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function smooth(amount: number): number {
  return amount * amount * (3 - 2 * amount);
}

function roundedPath(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

function canvas2d(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error(TEXTURE_ERROR);
  return [canvas, context];
}

function finishTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // 开 mipmap + 各向异性：卡片被推远或斜视时，细边框不再产生摩尔纹闪动。
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  return texture;
}

/** 深色面板底座（面板圆角 + 边框），各类卡共用。 */
function darkPanel(context: CanvasRenderingContext2D, width: number, height: number, radius: number, top: string, bottom: string) {
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, top);
  gradient.addColorStop(1, bottom);
  roundedPath(context, 8, 8, width - 16, height - 16, radius);
  context.fillStyle = gradient;
  context.fill();
  context.strokeStyle = "rgba(126,240,172,0.2)";
  context.lineWidth = 5;
  context.stroke();
}

function gradientBlock(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number, colors: [string, string]) {
  const gradient = context.createLinearGradient(x, y, x + width, y + height);
  gradient.addColorStop(0, colors[0]);
  gradient.addColorStop(1, colors[1]);
  roundedPath(context, x, y, width, height, radius);
  context.fillStyle = gradient;
  context.fill();
}

/** 文稿：浅色纸面 + 标题 + 正文行，一眼是「一页文档」。 */
function documentTexture(label: string): THREE.CanvasTexture {
  const width = 384;
  const height = 512;
  const [canvas, context] = canvas2d(width, height);
  const paper = context.createLinearGradient(0, 0, width, height);
  paper.addColorStop(0, "#f6f8f3");
  paper.addColorStop(1, "#dde5dd");
  roundedPath(context, 8, 8, width - 16, height - 16, 30);
  context.fillStyle = paper;
  context.fill();
  context.strokeStyle = "rgba(18,32,24,0.2)";
  context.lineWidth = 5;
  context.stroke();

  context.fillStyle = "#2f9e63";
  roundedPath(context, 46, 58, 56, 10, 5);
  context.fill();

  context.font = `600 52px ${CARD_FONT}`;
  context.fillStyle = "#16241c";
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.fillText(label, 46, 126);

  context.fillStyle = "rgba(22,36,28,0.24)";
  [254, 296, 216, 282, 190, 268, 158].forEach((lineWidth, index) => {
    roundedPath(context, 46, 196 + index * 40, lineWidth, 13, 6.5);
    context.fill();
  });
  return finishTexture(canvas);
}

/** 视频：来源片段——标签、播放符号、时间码与进度。 */
function videoClipTexture(label: string): THREE.CanvasTexture {
  const width = 640;
  const height = 360;
  const [canvas, context] = canvas2d(width, height);
  darkPanel(context, width, height, 36, "rgba(30,48,40,0.98)", "rgba(11,22,18,0.98)");

  context.font = `600 30px ${CARD_FONT}`;
  const chipWidth = context.measureText(label).width + 48;
  roundedPath(context, 40, 40, chipWidth, 46, 23);
  context.fillStyle = "rgba(255,255,255,0.08)";
  context.fill();
  context.fillStyle = "#8df0b4";
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.fillText(label, 64, 64);

  roundedPath(context, 40, 110, width - 80, 148, 18);
  context.fillStyle = "rgba(255,255,255,0.05)";
  context.fill();
  context.strokeStyle = "rgba(255,255,255,0.12)";
  context.lineWidth = 2;
  context.stroke();
  context.fillStyle = "rgba(255,255,255,0.88)";
  context.beginPath();
  context.moveTo(width / 2 - 20, 154);
  context.lineTo(width / 2 + 28, 184);
  context.lineTo(width / 2 - 20, 214);
  context.closePath();
  context.fill();

  context.fillStyle = "rgba(255,255,255,0.16)";
  roundedPath(context, 40, 300, width - 80, 10, 5);
  context.fill();
  context.fillStyle = "#4fd98c";
  roundedPath(context, 40, 300, (width - 80) * 0.34, 10, 5);
  context.fill();
  context.beginPath();
  context.arc(40 + (width - 80) * 0.34, 305, 9, 0, Math.PI * 2);
  context.fillStyle = "#eafff2";
  context.fill();

  context.font = `500 24px ${CARD_FONT}`;
  context.fillStyle = "rgba(255,255,255,0.5)";
  context.textAlign = "right";
  context.fillText("00:12", width - 44, 305);
  return finishTexture(canvas);
}

/** 文章：浏览器栏 + 标题 + 正文 + 缩略图。 */
function articleTexture(label: string): THREE.CanvasTexture {
  const width = 560;
  const height = 400;
  const [canvas, context] = canvas2d(width, height);
  darkPanel(context, width, height, 34, "rgba(26,42,36,0.98)", "rgba(11,22,18,0.98)");

  ["#5a6b62", "#6d7f75", "#5a6b62"].forEach((color, index) => {
    context.beginPath();
    context.arc(46 + index * 22, 48, 7, 0, Math.PI * 2);
    context.fillStyle = color;
    context.fill();
  });
  roundedPath(context, 122, 36, 396, 24, 12);
  context.fillStyle = "rgba(255,255,255,0.06)";
  context.fill();

  context.font = `600 44px ${CARD_FONT}`;
  context.fillStyle = "#eef7f1";
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.fillText(label, 44, 116);

  context.fillStyle = "rgba(238,247,241,0.3)";
  roundedPath(context, 44, 152, 300, 13, 6.5);
  context.fill();
  roundedPath(context, 44, 180, 210, 13, 6.5);
  context.fill();

  [0, 1, 2].forEach((index) => {
    gradientBlock(context, 44 + index * 162, 222, 148, 96, 12, index === 1 ? ["#3a2f66", "#7d6ad6"] : index === 2 ? ["#134a3f", "#4fb79c"] : ["#3a2330", "#c97a5a"]);
  });

  context.fillStyle = "rgba(238,247,241,0.22)";
  roundedPath(context, 44, 344, 360, 12, 6);
  context.fill();
  return finishTexture(canvas);
}

/** 账号：头像 + 名称 + 数据 + 作品缩略图。 */
function accountTexture(label: string): THREE.CanvasTexture {
  const width = 520;
  const height = 400;
  const [canvas, context] = canvas2d(width, height);
  darkPanel(context, width, height, 34, "rgba(27,42,37,0.98)", "rgba(11,22,18,0.98)");

  const avatar = context.createLinearGradient(44, 60, 136, 152);
  avatar.addColorStop(0, "#2f9e63");
  avatar.addColorStop(1, "#8fb2ff");
  context.beginPath();
  context.arc(90, 106, 46, 0, Math.PI * 2);
  context.fillStyle = avatar;
  context.fill();
  context.font = `600 44px ${CARD_FONT}`;
  context.fillStyle = "rgba(8,18,13,0.85)";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(Array.from(label)[0] ?? "·", 90, 108);

  context.font = `600 38px ${CARD_FONT}`;
  context.fillStyle = "#eef7f1";
  context.textAlign = "left";
  context.fillText(label, 156, 92);
  context.font = `500 26px ${CARD_FONT}`;
  context.fillStyle = "rgba(238,247,241,0.45)";
  context.fillText("@recut", 156, 132);

  context.fillStyle = "rgba(238,247,241,0.4)";
  roundedPath(context, 44, 196, 300, 13, 6.5);
  context.fill();

  [0, 1, 2].forEach((index) => {
    gradientBlock(context, 44 + index * 146, 240, 132, 104, 12, index === 1 ? ["#211c39", "#7d6ad6"] : index === 2 ? ["#0f2e2c", "#4fb79c"] : ["#332a1c", "#c9a468"]);
  });
  return finishTexture(canvas);
}

/** 成片：9:16 竖版（Mobile）+ 平台标签（YouTube / TikTok / 小红书）+ 播放符号与进度；有真实封面时铺满画面区。 */
function videoTexture(platform: string, platformColor: string, accent: string, poster: HTMLImageElement | null): THREE.CanvasTexture {
  const width = 576;
  const height = 1024;
  const [canvas, context] = canvas2d(width, height);
  darkPanel(context, width, height, 44, "rgba(30,58,45,0.98)", "rgba(11,22,17,0.98)");

  context.font = `600 30px ${CARD_FONT}`;
  const chipWidth = context.measureText(platform).width + 88;
  roundedPath(context, 44, 44, chipWidth, 60, 30);
  context.fillStyle = "rgba(255,255,255,0.08)";
  context.fill();
  context.beginPath();
  context.arc(44 + 34, 74, 11, 0, Math.PI * 2);
  context.fillStyle = platformColor;
  context.fill();
  context.fillStyle = "rgba(255,255,255,0.88)";
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.fillText(platform, 44 + 62, 75);

  const areaX = 44;
  const areaY = 142;
  const areaWidth = width - 88;
  const areaHeight = height - 322;
  context.save();
  roundedPath(context, areaX, areaY, areaWidth, areaHeight, 24);
  context.clip();
  if (poster) {
    const scale = Math.max(areaWidth / poster.width, areaHeight / poster.height);
    const drawWidth = poster.width * scale;
    const drawHeight = poster.height * scale;
    context.drawImage(poster, areaX + (areaWidth - drawWidth) / 2, areaY + (areaHeight - drawHeight) / 2, drawWidth, drawHeight);
  } else {
    context.fillStyle = "rgba(255,255,255,0.045)";
    context.fillRect(areaX, areaY, areaWidth, areaHeight);
  }
  // 压暗一层，保证播放符号与进度在任何封面上都读得清。
  const scrim = context.createLinearGradient(0, areaY, 0, areaY + areaHeight);
  scrim.addColorStop(0, "rgba(8,16,12,0.34)");
  scrim.addColorStop(0.55, "rgba(8,16,12,0.12)");
  scrim.addColorStop(1, "rgba(8,16,12,0.52)");
  context.fillStyle = scrim;
  context.fillRect(areaX, areaY, areaWidth, areaHeight);
  context.restore();
  roundedPath(context, areaX, areaY, areaWidth, areaHeight, 24);
  context.strokeStyle = "rgba(255,255,255,0.12)";
  context.lineWidth = 2;
  context.stroke();

  const centerY = areaY + areaHeight / 2;
  context.fillStyle = "rgba(255,255,255,0.9)";
  context.beginPath();
  context.moveTo(width / 2 - 26, centerY - 38);
  context.lineTo(width / 2 + 34, centerY);
  context.lineTo(width / 2 - 26, centerY + 38);
  context.closePath();
  context.fill();

  context.fillStyle = "rgba(255,255,255,0.16)";
  roundedPath(context, 44, height - 110, width - 88, 12, 6);
  context.fill();
  context.fillStyle = accent;
  roundedPath(context, 44, height - 110, (width - 88) * 0.58, 12, 6);
  context.fill();

  context.font = `500 26px ${CARD_FONT}`;
  context.fillStyle = "rgba(255,255,255,0.45)";
  context.textAlign = "left";
  context.fillText("00:30", 44, height - 64);
  return finishTexture(canvas);
}

export function MarketingWorldStage({ labels, platforms, posters = [] }: { labels: string[]; platforms: string[]; posters?: string[] }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef(labels);
  const platformsRef = useRef(platforms);
  const postersRef = useRef(posters);
  labelsRef.current = labels;
  platformsRef.current = platforms;
  postersRef.current = posters;

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    let cancelled = false;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, canvas });
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 2, 0.1, 120);
    camera.position.set(0, 0, 15);
    camera.lookAt(0, 0, 0);

    scene.add(new THREE.HemisphereLight(0xbfeecf, 0x0a1410, 1.1));
    const keyLight = new THREE.PointLight(0x6dffae, 10, 40, 2);
    keyLight.position.set(-6, 6, 10);
    scene.add(keyLight);
    const fillLight = new THREE.PointLight(0x8fb6ff, 5, 40, 2);
    fillLight.position.set(8, -5, 9);
    scene.add(fillLight);

    const disposables: Array<THREE.BufferGeometry | THREE.Material | THREE.Texture> = [];
    const track = <T extends THREE.BufferGeometry | THREE.Material | THREE.Texture>(item: T): T => {
      disposables.push(item);
      return item;
    };

    // —— 中心：世界观模型 ——
    const core = new THREE.Group();
    scene.add(core);
    core.add(new THREE.Mesh(
      track(new THREE.SphereGeometry(1.14, 48, 48)),
      track(new THREE.MeshStandardMaterial({ color: 0x0d271b, emissive: 0x1f9155, emissiveIntensity: 0.95, roughness: 0.4, metalness: 0.14 })),
    ));
    const coreWire = new THREE.Mesh(
      track(new THREE.IcosahedronGeometry(1.5, 1)),
      track(new THREE.MeshBasicMaterial({ color: 0x5fe79c, wireframe: true, transparent: true, opacity: 0.14 })),
    );
    core.add(coreWire);

    const ringMaterial = track(new THREE.MeshBasicMaterial({ color: 0x53e494, transparent: true, opacity: 0.24 }));
    const rings: THREE.Mesh[] = [];
    for (let index = 0; index < 3; index += 1) {
      const ring = new THREE.Mesh(track(new THREE.TorusGeometry(1.92 + index * 0.17, 0.02, 8, 150)), ringMaterial);
      ring.rotation.set(0.6 + index * 0.7, index * 0.5, index * 0.9);
      rings.push(ring);
      core.add(ring);
    }

    const orbitCount = 200;
    const orbitPositions = new Float32Array(orbitCount * 3);
    for (let index = 0; index < orbitCount; index += 1) {
      const radius = 1.68 + Math.random() * 0.62;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      orbitPositions[index * 3] = radius * Math.sin(phi) * Math.cos(theta);
      orbitPositions[index * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      orbitPositions[index * 3 + 2] = radius * Math.cos(phi);
    }
    const orbitGeometry = track(new THREE.BufferGeometry());
    orbitGeometry.setAttribute("position", new THREE.BufferAttribute(orbitPositions, 3));
    core.add(new THREE.Points(orbitGeometry, track(new THREE.PointsMaterial({ color: 0x8dffbf, size: 0.042, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }))));

    // —— 流动连线：左侧弯入核心，核心再弯出成片 ——
    const inputCurves = INPUT_SPECS.map(({ y, z }) => new THREE.CubicBezierCurve3(
      new THREE.Vector3(-9, y * 1.08, z * 1.05),
      new THREE.Vector3(-6.8, y * 1.22, z * 1.32),
      new THREE.Vector3(-3.8, y * 0.1, z * 0.04),
      new THREE.Vector3(-1.62, 0, 0),
    ));
    const outputCurves = OUTPUT_SLOTS.map(({ x, y, z }) => new THREE.CubicBezierCurve3(
      new THREE.Vector3(1.62, 0, 0),
      new THREE.Vector3(2.6, y * 0.2, z * 0.12),
      new THREE.Vector3(3.6, y * 1.35, z * 1.4),
      new THREE.Vector3(x, y, z),
    ));
    const lineMaterial = track(new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));

    // —— 左侧输入卡：每类一条曲线、每线三张，沿曲线流动并侧向散开 ——
    const inputMaterials: THREE.MeshBasicMaterial[] = [];
    const inputCards = inputCurves.flatMap((curve, curveIndex) => Array.from({ length: INPUT_PER_CURVE }, (_, slot) => {
      const size = CARD_SIZES[curveIndex % CARD_SIZES.length];
      const material = track(new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
      inputMaterials[curveIndex * INPUT_PER_CURVE + slot] = material;
      const card = new THREE.Mesh(track(new THREE.PlaneGeometry(size.w, size.h)), material);
      card.userData = {
        curve,
        offset: slot / INPUT_PER_CURVE + curveIndex * 0.07 + 0.02,
        turn: (curveIndex % 2 === 0 ? 1 : -1) * 0.12,
        spreadY: (slot - (INPUT_PER_CURVE - 1) / 2) * 0.9,
        spreadZ: (slot === 0 ? -1 : 1) * 0.3 * (curveIndex % 2 === 0 ? 1 : -1),
      };
      scene.add(card);
      return card;
    }));

    // —— 每张输入卡一条只属于自己的拖尾：只从卡片当前位置画到核心，卡到哪儿线到哪儿 ——
    const inputTrails = inputCards.map(() => {
      const geometry = track(new THREE.BufferGeometry());
      geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(TRAIL_POINTS * 3), 3));
      geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(TRAIL_POINTS * 3), 3));
      geometry.setDrawRange(0, 0);
      const line = new THREE.Line(geometry, lineMaterial);
      line.frustumCulled = false;
      scene.add(line);
      return geometry;
    });

    // —— 右侧成片卡：9:16 竖版 + 平台标签，沿输出曲线逐条落位 ——
    const outputMaterials: THREE.MeshBasicMaterial[] = [];
    const outputCards = outputCurves.map((curve, index) => {
      const material = track(new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
      outputMaterials[index] = material;
      const card = new THREE.Mesh(track(new THREE.PlaneGeometry(OUTPUT_SIZE.w, OUTPUT_SIZE.h)), material);
      card.visible = false;
      card.userData = { curve, cycle: 0, posterIndex: -1 };
      scene.add(card);
      return card;
    });

    // 成片封面池：先载当前一轮的三张，其余按节奏渐进载入（封面可达数 MB，避免首屏一起抢带宽）；
    // 每张卡按自己的轮次从池里换封面，真实视频就位时只需换这里的数据源。
    const posterImages: Array<HTMLImageElement | null> = [];
    const requestedPosters = new Set<number>();
    const paintInputTextures = () => {
      const names = labelsRef.current;
      for (let index = 0; index < inputMaterials.length; index += 1) {
        const kind = Math.floor(index / INPUT_PER_CURVE) % CARD_SIZES.length;
        const label = names[kind] ?? "";
        const material = inputMaterials[index];
        material.map?.dispose();
        material.map = kind === 0 ? documentTexture(label) : kind === 1 ? videoClipTexture(label) : kind === 2 ? articleTexture(label) : accountTexture(label);
        material.needsUpdate = true;
      }
    };
    const paintOutputTexture = (index: number) => {
      const pool = Math.max(1, postersRef.current.length);
      const posterIndex = ((outputCards[index].userData.cycle as number) * OUTPUT_SLOTS.length + index) % pool;
      const material = outputMaterials[index];
      material.map?.dispose();
      material.map = track(videoTexture(platformsRef.current[index] ?? "", PLATFORM_COLORS[index % PLATFORM_COLORS.length], ACCENTS[index % ACCENTS.length], posterImages[posterIndex] ?? null));
      material.needsUpdate = true;
      outputCards[index].userData.posterIndex = posterIndex;
    };
    const paintOutputTextures = () => outputMaterials.forEach((_, index) => paintOutputTexture(index));
    const loadPoster = (index: number) => {
      const url = postersRef.current[index];
      if (!url || requestedPosters.has(index)) return;
      requestedPosters.add(index);
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.decoding = "async";
      image.onload = () => { if (cancelled) return; posterImages[index] = image; paintOutputTextures(); };
      image.src = url;
    };
    paintInputTextures();
    paintOutputTextures();
    let posterCursor = Math.min(OUTPUT_SLOTS.length, postersRef.current.length);
    for (let index = 0; index < posterCursor; index += 1) loadPoster(index);
    const posterTimer = window.setInterval(() => {
      if (cancelled || posterCursor >= postersRef.current.length) { window.clearInterval(posterTimer); return; }
      loadPoster(posterCursor);
      posterCursor += 1;
    }, 1400);

    // —— 成片卡同样各自一条拖尾：从核心一直画到卡片当前位置，视频滑出去时线也跟着走 ——
    const outputTrails = outputCards.map(() => {
      const geometry = track(new THREE.BufferGeometry());
      geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(TRAIL_POINTS * 3), 3));
      geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(TRAIL_POINTS * 3), 3));
      geometry.setDrawRange(0, 0);
      const line = new THREE.Line(geometry, lineMaterial);
      line.frustumCulled = false;
      scene.add(line);
      return geometry;
    });

    // —— 流粒子：贴着输入曲线往核心里走的细小光点流 ——
    const flowPositions = new Float32Array(FLOW_COUNT * 3);
    const flowCurveIndex = new Int32Array(FLOW_COUNT);
    const flowT = new Float32Array(FLOW_COUNT);
    const flowSpeed = new Float32Array(FLOW_COUNT);
    for (let index = 0; index < FLOW_COUNT; index += 1) {
      flowCurveIndex[index] = index % inputCurves.length;
      flowT[index] = Math.random();
      flowSpeed[index] = 0.1 + Math.random() * 0.14;
    }
    const flowGeometry = track(new THREE.BufferGeometry());
    flowGeometry.setAttribute("position", new THREE.BufferAttribute(flowPositions, 3));
    scene.add(new THREE.Points(flowGeometry, track(new THREE.PointsMaterial({ color: 0x86f7b8, size: 0.05, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }))));

    // —— 左半「素材流」尘点：卡片之间的空隙靠它们撑住，避免出现光秃秃的长空档 ——
    const motePositions = new Float32Array(MOTE_COUNT * 3);
    const moteSpeed = new Float32Array(MOTE_COUNT);
    for (let index = 0; index < MOTE_COUNT; index += 1) {
      // 只铺左半（x 约 -11.6 … -0.6），右半留给成片与连线。
      motePositions[index * 3] = -MOTE_SPAN_X + Math.random() * MOTE_SPAN_X * 0.95;
      motePositions[index * 3 + 1] = (Math.random() - 0.5) * 7.6;
      motePositions[index * 3 + 2] = (Math.random() - 0.5) * 4.4 - 0.5;
      moteSpeed[index] = 0.2 + Math.random() * 0.7;
    }
    const moteGeometry = track(new THREE.BufferGeometry());
    moteGeometry.setAttribute("position", new THREE.BufferAttribute(motePositions, 3));
    scene.add(new THREE.Points(moteGeometry, track(new THREE.PointsMaterial({ color: 0x8ef0bb, size: 0.035, transparent: true, opacity: 0.34, depthWrite: false, blending: THREE.AdditiveBlending }))));

    const pointer = { x: 0, y: 0 };
    const bounds = { left: 0, top: 0, width: 1, height: 1 };
    const onPointerMove = (event: PointerEvent) => {
      pointer.x = ((event.clientX - bounds.left) / bounds.width - 0.5) * 2;
      pointer.y = ((event.clientY - bounds.top) / bounds.height - 0.5) * 2;
    };
    host.addEventListener("pointermove", onPointerMove);

    const resize = () => {
      const rect = host.getBoundingClientRect();
      const { width, height } = rect;
      if (!width || !height) return;
      bounds.left = rect.left;
      bounds.top = rect.top;
      bounds.width = rect.width;
      bounds.height = rect.height;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      // 以固定设计宽度（左右各 ±10.2）适配，窄屏收紧到最小纵深，避免主体缩成一点。
      const zoom = 10.2 / (Math.tan((camera.fov * Math.PI) / 360) * camera.aspect);
      camera.position.z = Math.min(20, Math.max(11, zoom));
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    window.addEventListener("scroll", resize, { passive: true });
    resize();

    const point = new THREE.Vector3();
    let frame = 0;
    let visible = true;
    const clock = new THREE.Clock();
    let elapsed = 0;
    const flowAttribute = flowGeometry.getAttribute("position") as THREE.BufferAttribute;
    const moteAttribute = moteGeometry.getAttribute("position") as THREE.BufferAttribute;

    const render = () => {
      frame = requestAnimationFrame(render);
      const delta = Math.min(clock.getDelta(), 0.05);
      if (!visible) return;
      if (!reduced) elapsed += delta;

      core.rotation.y += delta * 0.12;
      core.rotation.x = Math.sin(elapsed * 0.22) * 0.05;
      coreWire.rotation.y -= delta * 0.18;
      rings.forEach((ring, index) => { ring.rotation.z += delta * (0.07 + index * 0.03) * (index % 2 === 0 ? 1 : -1); });

      inputCards.forEach((card, cardIndex) => {
        const progress = reduced ? 0.08 + card.userData.offset * 0.8 : (elapsed * 0.1 + card.userData.offset) % 1;
        // 越靠近世界观模型越小、并侧向散开，像被吸进去而非堆在球面上。
        const eased = smooth(progress);
        const curve = card.userData.curve as THREE.CubicBezierCurve3;
        curve.getPointAt(eased, point);
        card.position.copy(point);
        card.position.y += (card.userData.spreadY as number) * eased;
        card.position.z += (card.userData.spreadZ as number) * eased;
        card.scale.setScalar(lerp(1.08, 0.34, eased));
        card.rotation.y = 0.34 - progress * 0.34;
        card.rotation.z = (card.userData.turn as number) * Math.sin(progress * Math.PI) * 0.7;
        const opacity = progress < 0.1 ? progress / 0.1 : progress > 0.62 ? Math.max(0, (1 - progress) / 0.24) : 1;
        (card.material as THREE.MeshBasicMaterial).opacity = opacity;

        // 拖尾：从卡片当前位置采样到核心；卡片淡出时拖尾同步消失。
        const trail = inputTrails[cardIndex];
        if (opacity <= 0.02) {
          trail.setDrawRange(0, 0);
          return;
        }
        const positions = trail.getAttribute("position") as THREE.BufferAttribute;
        const colors = trail.getAttribute("color") as THREE.BufferAttribute;
        for (let step = 0; step < TRAIL_POINTS; step += 1) {
          const t = eased + (1 - eased) * (step / (TRAIL_POINTS - 1));
          curve.getPointAt(t, point);
          positions.setXYZ(step, point.x, point.y, point.z);
          const brightness = 0.14 + 0.86 * smooth(step / (TRAIL_POINTS - 1));
          colors.setXYZ(step, CORE_GREEN.r * brightness, CORE_GREEN.g * brightness, CORE_GREEN.b * brightness);
        }
        positions.needsUpdate = true;
        colors.needsUpdate = true;
        trail.setDrawRange(0, TRAIL_POINTS);
      });

      outputCards.forEach((card, index) => {
        // 每条通道按自己的节奏不断产出：飞入 → 停留 → 发布滑出，随后换下一支。
        const raw = reduced ? 0 : Math.max(0, elapsed - index * OUTPUT_CYCLE_STAGGER);
        const cycle = reduced ? 0 : Math.floor(raw / OUTPUT_CYCLE);
        const local = reduced ? 0.5 : (raw % OUTPUT_CYCLE) / OUTPUT_CYCLE;
        if ((card.userData.cycle as number) !== cycle) {
          card.userData.cycle = cycle;
          paintOutputTexture(index);
        }
        const arrive = local < OUTPUT_ARRIVE ? local / OUTPUT_ARRIVE : 1;
        const exit = local > OUTPUT_EXIT ? (local - OUTPUT_EXIT) / (1 - OUTPUT_EXIT) : 0;
        const eased = 1 - (1 - arrive) * (1 - arrive);
        const curve = card.userData.curve as THREE.CubicBezierCurve3;
        curve.getPointAt(eased, point);
        card.position.copy(point);
        // 发布：到点后继续向右滑出画面，给下一支让位。
        card.position.x += exit * 1.5;
        card.position.y += Math.sin(elapsed * 0.75 + index) * 0.06 * (1 - exit);
        card.visible = arrive > 0 && exit < 1;
        card.scale.setScalar(lerp(0.72, 1, eased) * (1 - exit * 0.18));
        card.rotation.y = -0.22 + eased * 0.16;
        card.rotation.z = Math.sin(elapsed * 0.6 + index) * 0.012;
        const opacity = Math.min(1, arrive) * (1 - exit);
        (card.material as THREE.MeshBasicMaterial).opacity = opacity;

        // 拖尾：从核心采样到卡片当前位置，并把末点钉在卡片上，滑出时线随视频一起走。
        const trail = outputTrails[index];
        if (opacity <= 0.02) {
          trail.setDrawRange(0, 0);
          return;
        }
        const positions = trail.getAttribute("position") as THREE.BufferAttribute;
        const colors = trail.getAttribute("color") as THREE.BufferAttribute;
        for (let step = 0; step < TRAIL_POINTS; step += 1) {
          curve.getPointAt(eased * (step / (TRAIL_POINTS - 1)), point);
          positions.setXYZ(step, point.x, point.y, point.z);
          const brightness = 0.14 + 0.86 * smooth(1 - step / (TRAIL_POINTS - 1));
          colors.setXYZ(step, CORE_GREEN.r * brightness, CORE_GREEN.g * brightness, CORE_GREEN.b * brightness);
        }
        positions.setXYZ(TRAIL_POINTS - 1, card.position.x, card.position.y, card.position.z);
        positions.needsUpdate = true;
        colors.needsUpdate = true;
        trail.setDrawRange(0, TRAIL_POINTS);
      });

      for (let index = 0; index < FLOW_COUNT; index += 1) {
        let t = flowT[index];
        if (!reduced) {
          t += delta * flowSpeed[index];
          if (t > 1) { t = 0; flowCurveIndex[index] = (flowCurveIndex[index] + 1 + Math.floor(Math.random() * 2)) % inputCurves.length; }
          flowT[index] = t;
        }
        inputCurves[flowCurveIndex[index]].getPointAt(reduced ? flowT[index] : t, point);
        flowPositions[index * 3] = point.x;
        flowPositions[index * 3 + 1] = point.y;
        flowPositions[index * 3 + 2] = point.z;
      }
      flowAttribute.needsUpdate = true;

      if (!reduced) {
        for (let index = 0; index < MOTE_COUNT; index += 1) {
          let x = motePositions[index * 3] + moteSpeed[index] * delta;
          if (x > -0.4) x -= MOTE_SPAN_X;
          motePositions[index * 3] = x;
        }
        moteAttribute.needsUpdate = true;
      }

      // 指针视差只做轻微推镜：位移过大时 1px 细线会沿屏幕扫动，观感像闪动。
      camera.position.x += (pointer.x * 0.32 - camera.position.x) * 0.06;
      camera.position.y += (-pointer.y * 0.2 - camera.position.y) * 0.06;
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
    };

    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }, { threshold: 0.02 });
    observer.observe(host);
    render();

    // 显示字体就绪后重绘卡面文字，避免首帧用回退字体绘制。
    const fonts = document.fonts;
    if (fonts?.ready) void fonts.ready.then(() => { if (!cancelled) { paintInputTextures(); paintOutputTextures(); } }).catch(() => undefined);

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      window.clearInterval(posterTimer);
      observer.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener("scroll", resize);
      host.removeEventListener("pointermove", onPointerMove);
      disposables.forEach((item) => item.dispose());
      renderer.dispose();
    };
  }, []);

  return (
    <div aria-hidden="true" className="absolute inset-0" ref={hostRef}>
      <canvas className="size-full" ref={canvasRef} />
    </div>
  );
}
