import { useEffect, useMemo, useRef, useState } from "react";
import { BriefForm } from "./brief-form";
import { Studio } from "./studio";
import { recut, apiBase, projectId, mediaContentURL } from "./recut-sdk";
import type { Design } from "@compositions/types";

export interface Brief {
  id: string;
  template: string;
  topic: string;
  details: string;
  expectedDurationSec: number;
  materialAssetIds: string[];
  createdAt: string;
}

export interface DesignResource {
  id: string;
  briefId: string;
  title: string;
  content: Design;
  createdAt: string;
  updatedAt: string;
}

export interface Catalog {
  styleTemplates: Record<string, { label: string; description: string; style: Record<string, string>; motion: string }>;
  captionThemes: Array<{ id: string; label: string; description: string }>;
  effects: Array<{ id: string; label: string; kind: string; description: string }>;
  canvasSizes: Array<{ id: string; label: string; width: number; height: number; fps: number }>;
}

export interface MediaAsset {
  id: string;
  kind: "image" | "video" | "audio";
  name: string;
  mimeType?: string;
  status: string;
  createdAt?: string;
}

export interface MediaMap {
  [assetId: string]: { kind: "image" | "video" | "audio"; url: string };
}

async function loadCatalog(): Promise<Catalog> {
  return recut.state.query("catalog.list");
}

async function loadAssets(): Promise<MediaAsset[]> {
  if (!projectId) return [];
  const response = await fetch(`${apiBase}/v1/media/assets?projectId=${encodeURIComponent(projectId)}`);
  if (!response.ok) throw new Error(`素材列表读取失败：${response.status}`);
  return response.json();
}

export function buildMediaMap(assets: MediaAsset[]): MediaMap {
  const map: MediaMap = {};
  for (const asset of assets) {
    if (asset.status !== "completed") continue;
    if (asset.kind === "video" || asset.kind === "audio" || asset.kind === "image") {
      map[asset.id] = { kind: asset.kind, url: mediaContentURL(asset.id) };
    }
  }
  return map;
}

export default function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [design, setDesign] = useState<DesignResource | null>(null);
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [status, setStatus] = useState("连接中…");
  const [diagnostic, setDiagnostic] = useState("等待资源连接");
  const [waiting, setWaiting] = useState(false);
  const loadingRef = useRef(false);

  const mediaMap = useMemo(() => buildMediaMap(assets), [assets]);

  const refresh = async (silent = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      if (!silent) setDiagnostic("正在同步项目状态");
      const [nextCatalog, nextAssets, composition] = await Promise.all([loadCatalog(), loadAssets(), recut.state.query("composition.latest").catch(() => null)]);
      setCatalog(nextCatalog);
      setAssets(nextAssets);
      setDesign(composition?.design ?? null);
      setBrief(composition?.brief ?? null);
      setWaiting(false);
      setDiagnostic(`状态已同步：${composition?.design ? "已有一份设计" : "尚无设计"}`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "未知错误";
      setDiagnostic(`同步失败：${message}`);
      if (!silent) console.error("[remotion-studio] refresh failed", cause);
    } finally {
      loadingRef.current = false;
    }
  };

  useEffect(() => {
    window.addEventListener("recut-sdk-ready", () => void refresh());
    void refresh();
    const unsubscribe = recut.events.subscribe((event) => {
      const capability = event as { type?: string; appId?: string; name?: string };
      if (capability.type === "app.capability.completed" && capability.appId === "recut.remotion-studio" && ["composition.save", "composition.update", "project.create"].includes(String(capability.name))) {
        void refresh(true);
      }
    });
    return () => { window.removeEventListener("recut-sdk-ready", () => void refresh()); unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => void refresh(true), 5000);
    return () => window.clearInterval(timer);
  }, [waiting]);

  const startDesign = async (input: { template: string; topic: string; details: string; expectedDurationSec: number; materialAssetIds: string[] }) => {
    setStatus("正在保存项目 Brief…");
    const saved = await recut.background.call("project.create", input);
    setBrief(saved.value ?? saved);
    const template = catalog?.styleTemplates[input.template];
    const materialText = input.materialAssetIds.length
      ? `\n已选用素材（assetId）：\n${input.materialAssetIds.join("\n")}\n`
      : "";
    const prompt = `我要用 Remotion Studio 做一支程序化视频。\n\n项目 Brief：\n- 风格模板：${input.template}（${template?.label ?? ""} ${template?.motion ?? ""}）\n- 选题：${input.topic}\n- 详细描述：${input.details || "无额外补充"}\n- 预期时长：${input.expectedDurationSec} 秒${materialText}\n\n请开始设计（这是设计阶段，不是渲染阶段）：\n1. 先调用 workflow.context 查看阶段、设计契约与可用目录。\n2. 依据风格模板的色板与动效气质，为每个场景设计标题、旁白（若有）、画面素材引用（imageAssetId 使用素材库已有 assetId，不要凭空编造）、可选特效与时长；所有场景时长之和必须等于 ${input.expectedDurationSec} 秒。\n3. 用 composition.save 保存一份通过校验的设计（含 style.captionTheme、style.effectId、场景数组）。\n4. 保存后停止，等待我预览后提出修改。`;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(prompt);
    } catch { /* 剪贴板不可用不影响 compose */ }
    await recut.agent.compose({ prompt });
    setWaiting(true);
    setStatus("设计任务已交给 AI。提示词已写入右侧 Agent 面板并复制到剪贴板；发送后这里会自动出现实时预览。");
  };

  const resubmitDesign = async () => {
    if (!brief) return;
    setStatus("设计请求已重新交给 AI。");
    setWaiting(true);
  };

  if (!catalog) {
    return <div className="app"><div className="topbar"><h1>Remotion Studio</h1><span className="status">{diagnostic}</span></div><div className="panel-body muted" style={{ padding: 24 }}>{diagnostic}</div></div>;
  }

  return (
    <div className="app">
      <div className="topbar">
        <div className="flex grow">
          <h1>Remotion Studio</h1>
          {brief ? <span className="meta">{brief.topic} · {catalog.styleTemplates[brief.template]?.label ?? brief.template}</span> : null}
        </div>
        <span className="status mono" data-testid="diagnostic">{diagnostic}</span>
      </div>
      {!design ? (
        <BriefForm brief={brief} catalog={catalog} onStart={startDesign} status={status} />
      ) : (
        <Studio assets={assets} catalog={catalog} designResource={design} mediaMap={mediaMap} onDesignSaved={(next) => { setDesign(next); setStatus("设计已更新，预览已刷新。"); }} onRedesign={() => { void resubmitDesign(); setDesign(null); }} setStatus={setStatus} />
      )}
      {waiting && !design && (
        <div className="toast">等待 AI 完成设计… 完成后会自动出现实时预览。</div>
      )}
    </div>
  );
}
