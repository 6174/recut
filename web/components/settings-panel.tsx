/*
 * [INPUT]: 依赖 Media Platform 的 Provider、Credential、Route HTTP API 与工作台 UI 原子组件
 * [OUTPUT]: 对外提供全局设置面板，以及面向用途决策的 Provider 连接和模型配置体验；表单字段均有可见标签，仅兼容 Provider 暴露自定义端点
 * [POS]: web/components 的工作台级设置入口；Provider、音色与用途模型的唯一用户配置界面
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { AppWindow, Bot, Check, ChevronDown, Image, Mic2, Plus, Settings, Sparkles, TerminalSquare, Video, X } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const apiBase = process.env.NEXT_PUBLIC_RECUT_API_URL ?? "http://127.0.0.1:17373";
type SettingSection = "apps" | "cli" | "agents" | "multimodal";
type Model = { id: string; provider: string; name: string; capability: string; available: boolean };
type Provider = { id: string; name: string; defaultApiBase: string; models: Model[] };
type Credential = { id: string; name: string; provider: string };
type Route = { id: string; capability: string; modelId: string; credentialId: string; enabled: boolean };

const sections: { id: SettingSection; label: string; icon: typeof AppWindow }[] = [
  { id: "apps", label: "应用管理", icon: AppWindow },
  { id: "cli", label: "本地 CLI", icon: TerminalSquare },
  { id: "agents", label: "本地 Agent", icon: Bot },
  { id: "multimodal", label: "AI 服务商", icon: Sparkles },
];

const capabilities = [
  { id: "image.generate", label: "图片生成", description: "为分镜、封面和视觉参考生成静态图片。", icon: Image },
  { id: "video.generate", label: "视频生成", description: "把提示词或已有素材转成动态镜头。", icon: Video },
  { id: "speech.generate", label: "文本转语音", description: "为旁白生成音频；创建时可选该凭据的可用音色。", icon: Mic2 },
];

const providerGuidance: Record<string, { use: string; note: string }> = {
  "atlas-cloud": { use: "一把密钥接入多种图像、视频与语音模型。", note: "适合先快速试用不同媒介能力。" },
  openai: { use: "高质量图片生成与编辑。", note: "适合封面、风格图和视觉细节。" },
  "openai-compatible": { use: "兼容 OpenAI 图片协议的自建或聚合服务。", note: "填写服务方提供的 API 地址。" },
  gemini: { use: "Google 的图片和视频模型。", note: "适合已使用 Gemini 账户的团队。" },
  grok: { use: "xAI 的图片和视频模型。", note: "适合将 Grok 纳入同一工作流。" },
  minimax: { use: "中文旁白、系统音色、克隆音色与文生音色。", note: "连接后会实时读取该密钥可用的音色。" },
  elevenlabs: { use: "自然、多语言的高表现力旁白。", note: "连接后会显示账户拥有和可用的音色。" },
};

function capabilityLabel(id: string) { return capabilities.find((item) => item.id === id)?.label ?? id; }
function providerInfo(id: string) { return providerGuidance[id] ?? { use: "连接此 Provider 后可使用其已声明的模型。", note: "密钥只会加密保存在本机。" }; }

export function SettingsPanel({ open: controlledOpen, onOpenChange, section }: { open?: boolean; onOpenChange?: (open: boolean) => void; section?: SettingSection }) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const [selectedSection, setSelectedSection] = useState<SettingSection>("apps");
  const open = controlledOpen ?? uncontrolledOpen;
  const activeSection = section ?? selectedSection;
  function setOpen(next: boolean) { if (controlledOpen === undefined) setUncontrolledOpen(next); onOpenChange?.(next); }
  useEffect(() => { if (!open) return; const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); }; window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close); }, [open]);
  return (
    <>
      <button aria-expanded={open} aria-haspopup="dialog" aria-label="打开设置" className="grid size-8 place-items-center rounded-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" onClick={() => setOpen(true)} title="设置" type="button">
        <Settings className="size-4" />
      </button>
      {open && (
        <div aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-foreground/20 p-6 backdrop-blur-[1px]" onMouseDown={() => setOpen(false)} role="dialog">
          <section className="grid h-[min(760px,calc(100vh-3rem))] w-full max-w-6xl overflow-hidden rounded-sm border bg-card shadow-2xl [grid-template-columns:224px_minmax(0,1fr)]" onMouseDown={(event) => event.stopPropagation()}>
            <nav aria-label="设置分类" className="border-r bg-muted/40 p-4">
              <div className="mb-7 px-2 pt-1"><p className="font-mono text-[10px] tracking-wide text-muted-foreground">RECUT</p><p className="mt-1.5 text-sm font-semibold">设置</p></div>
              <div className="space-y-1">{sections.map((item) => { const Icon = item.icon; return <button className={`flex h-9 w-full items-center gap-2.5 rounded-xs px-3 text-left text-xs ${activeSection === item.id ? "bg-card font-medium text-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`} key={item.id} onClick={() => setSelectedSection(item.id)} type="button"><Icon className="size-3.5" />{item.label}</button>; })}</div>
            </nav>
            <div className="min-w-0 overflow-y-auto p-8">
              <div className="flex items-start justify-between border-b pb-6"><div><h2 className="text-lg font-semibold">{activeSection === "multimodal" ? "AI 服务商" : sections.find((item) => item.id === activeSection)?.label}</h2><p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{activeSection === "multimodal" ? "先连接 Provider，再为每种创作用途选择合适的模型。密钥只在本机加密保存。" : "此设置将在后续版本开放。"}</p></div><button aria-label="关闭设置" className="grid size-8 place-items-center rounded-xs text-muted-foreground hover:bg-muted" onClick={() => setOpen(false)} type="button"><X className="size-4" /></button></div>
              {activeSection === "multimodal" ? <ProviderSettings /> : <div className="grid min-h-80 place-items-center text-xs text-muted-foreground">即将推出</div>}
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function ProviderSettings() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [adding, setAdding] = useState(false);
  const [providerID, setProviderID] = useState("atlas-cloud");
  const [name, setName] = useState("");
  const [apiBaseValue, setAPIBaseValue] = useState("");
  const [apiKey, setAPIKey] = useState("");
  const [message, setMessage] = useState("");
  async function load() { const [providerResponse, credentialResponse, routeResponse] = await Promise.all([fetch(`${apiBase}/v1/media/providers`), fetch(`${apiBase}/v1/media/credentials`), fetch(`${apiBase}/v1/media/routes`)]); if (providerResponse.ok) { const next = await providerResponse.json(); setProviders(next); if (!apiBaseValue) setAPIBaseValue(next.find((item: Provider) => item.id === providerID)?.defaultApiBase ?? ""); } if (credentialResponse.ok) setCredentials(await credentialResponse.json()); if (routeResponse.ok) setRoutes(await routeResponse.json()); }
  useEffect(() => { void load(); }, []);
  const provider = providers.find((item) => item.id === providerID);
  const connectedProviders = new Set(credentials.map((credential) => credential.provider));
  function chooseProvider(id: string) { const next = providers.find((item) => item.id === id); setProviderID(id); setAPIBaseValue(next?.defaultApiBase ?? ""); }
  function beginAdding(preferred?: string) { if (preferred) chooseProvider(preferred); setAdding(true); setMessage(""); }
  async function addProvider(event: FormEvent) { event.preventDefault(); const response = await fetch(`${apiBase}/v1/media/credentials`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: providerID, name: name || provider?.name || providerID, apiBase: apiBaseValue, apiKey }) }); if (!response.ok) { setMessage("无法连接 Provider。请检查密钥和 API 地址后重试。"); return; } setAdding(false); setName(""); setAPIKey(""); setMessage(`${provider?.name ?? "Provider"} 已连接，可以为对应用途选择模型。`); await load(); }
  async function chooseModel(capability: string, modelID: string) { const model = providers.flatMap((item) => item.models).find((item) => item.id === modelID); const credential = credentials.find((item) => item.provider === model?.provider); if (!model || !credential) { setMessage("请先连接此模型所属的 Provider。"); return; } const response = await fetch(`${apiBase}/v1/media/routes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: `${capability}.default`, capability, modelId: modelID, credentialId: credential.id, enabled: true }) }); if (!response.ok) { setMessage("用途模型保存失败，请重试。"); return; } setMessage(`${capabilityLabel(capability)}已切换为 ${model.name}。`); await load(); }
  return <div className="space-y-9 pt-6"><section><div className="flex items-start justify-between"><div><p className="text-sm font-medium">已连接服务商</p><p className="mt-1 text-xs text-muted-foreground">连接后，模型和音色会按该密钥的实际权限出现。</p></div><Button className="size-8 px-0" onClick={() => beginAdding()} title="连接服务商" type="button" variant="outline"><Plus className="size-4" /></Button></div>{credentials.length ? <div className="mt-4 grid gap-2 sm:grid-cols-2">{credentials.map((credential) => { const connected = providers.find((item) => item.id === credential.provider); const info = providerInfo(credential.provider); return <div className="border bg-card p-3" key={credential.id}><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-medium">{credential.name}</p><p className="mt-1 text-[11px] text-muted-foreground">{connected?.name ?? credential.provider}</p></div><Badge>CONNECTED</Badge></div><p className="mt-3 text-[11px] leading-4 text-muted-foreground">{info.use}</p></div>; })}</div> : <div className="mt-4 flex items-center justify-between border border-dashed p-4"><p className="text-xs text-muted-foreground">还没有服务商。先连接一个 Provider 才能开始生成。</p><Button onClick={() => beginAdding()} type="button">连接服务商</Button></div>}{adding && <ProviderConnectForm apiBaseValue={apiBaseValue} apiKey={apiKey} name={name} onCancel={() => setAdding(false)} onProviderChange={chooseProvider} onSubmit={addProvider} providers={providers} selectedID={providerID} setAPIBaseValue={setAPIBaseValue} setAPIKey={setAPIKey} setName={setName} />}</section><section><div><p className="text-sm font-medium">按用途配置模型</p><p className="mt-1 text-xs text-muted-foreground">每种用途独立选择。Agent 只能调用这里已配置的模型，不会自行猜测 Provider。</p></div><div className="mt-4 space-y-3">{capabilities.map((capability) => { const route = routes.find((item) => item.capability === capability.id); const models = providers.filter((item) => connectedProviders.has(item.id)).flatMap((item) => item.models).filter((model) => model.capability === capability.id && model.available); return <ModelRouteCard capability={capability} key={capability.id} models={models} onChoose={chooseModel} onConnect={beginAdding} providerName={(id) => providers.find((item) => item.id === id)?.name ?? id} selectedID={route?.modelId} />; })}</div></section>{message && <p className="border-l-2 border-primary pl-3 text-xs text-muted-foreground">{message}</p>}</div>;
}

function ProviderConnectForm({ apiBaseValue, apiKey, name, onCancel, onProviderChange, onSubmit, providers, selectedID, setAPIBaseValue, setAPIKey, setName }: { apiBaseValue: string; apiKey: string; name: string; onCancel: () => void; onProviderChange: (id: string) => void; onSubmit: (event: FormEvent) => void; providers: Provider[]; selectedID: string; setAPIBaseValue: (value: string) => void; setAPIKey: (value: string) => void; setName: (value: string) => void }) {
  const selected = providers.find((item) => item.id === selectedID); const info = providerInfo(selectedID);
  const needsCustomAPIBase = selectedID === "openai-compatible";
  return <form className="mt-4 border bg-muted/25 p-4" onSubmit={onSubmit}><div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"><div><p className="text-xs font-medium">选择服务商</p><ProviderPicker onChoose={onProviderChange} providers={providers} selectedID={selectedID} /><p className="mt-3 text-xs leading-5 text-muted-foreground">{info.use}<br />{info.note}</p>{selected && <div className="mt-3 flex flex-wrap gap-1.5">{selected.models.map((model) => <span className="border bg-background px-2 py-1 text-[10px] text-muted-foreground" key={model.id}>{capabilityLabel(model.capability)}</span>)}</div>}</div><div className="grid content-start gap-3"><div><label className="mb-1.5 block text-xs font-medium" htmlFor="credential-name">凭据名称</label><Input id="credential-name" onChange={(event) => setName(event.target.value)} placeholder="例如：团队 ElevenLabs" value={name} /></div>{needsCustomAPIBase && <div><label className="mb-1.5 block text-xs font-medium" htmlFor="credential-api-base">API 地址</label><Input id="credential-api-base" onChange={(event) => setAPIBaseValue(event.target.value)} placeholder="例如：https://api.example.com/v1" value={apiBaseValue} /></div>}<div><label className="mb-1.5 block text-xs font-medium" htmlFor="credential-api-key">API Key</label><Input id="credential-api-key" onChange={(event) => setAPIKey(event.target.value)} placeholder="粘贴服务商提供的密钥" type="password" value={apiKey} /></div></div></div><div className="mt-4 flex justify-end gap-2"><Button onClick={onCancel} type="button" variant="ghost">取消</Button><Button disabled={!apiKey.trim() || (needsCustomAPIBase && !apiBaseValue.trim())} type="submit">连接 {selected?.name ?? "Provider"}</Button></div></form>;
}

function ProviderPicker({ onChoose, providers, selectedID }: { onChoose: (id: string) => void; providers: Provider[]; selectedID: string }) {
  const [open, setOpen] = useState(false); const selected = providers.find((item) => item.id === selectedID);
  return <div className="relative mt-2"><button aria-expanded={open} className="flex h-10 w-full items-center justify-between border bg-background px-3 text-left text-xs hover:bg-muted" onClick={() => setOpen((value) => !value)} type="button"><span>{selected?.name ?? "选择服务商"}</span><ChevronDown className="size-3.5 text-muted-foreground" /></button>{open && <div className="absolute z-30 mt-1 w-full border bg-popover p-1 shadow-xl">{providers.map((provider) => { const info = providerInfo(provider.id); return <button className={`block w-full px-3 py-2.5 text-left hover:bg-muted ${provider.id === selectedID ? "bg-accent" : ""}`} key={provider.id} onClick={() => { onChoose(provider.id); setOpen(false); }} type="button"><span className="flex items-center justify-between text-xs font-medium">{provider.name}{provider.id === selectedID && <Check className="size-3.5 text-primary" />}</span><span className="mt-1 block text-[11px] leading-4 text-muted-foreground">{info.use}</span></button>; })}</div>}</div>;
}

function ModelRouteCard({ capability, models, onChoose, onConnect, providerName, selectedID }: { capability: (typeof capabilities)[number]; models: Model[]; onChoose: (capability: string, modelID: string) => void; onConnect: (provider?: string) => void; providerName: (id: string) => string; selectedID?: string }) {
  const [open, setOpen] = useState(false); const selected = models.find((model) => model.id === selectedID); const Icon = capability.icon;
  return <article className="grid gap-4 border bg-card p-4 md:grid-cols-[210px_minmax(0,1fr)]"><div><div className="flex items-center gap-2"><span className="grid size-7 place-items-center border bg-muted/40"><Icon className="size-3.5" /></span><p className="text-xs font-medium">{capability.label}</p></div><p className="mt-2 text-[11px] leading-4 text-muted-foreground">{capability.description}</p></div><div className="relative">{models.length ? <><button aria-expanded={open} className="flex min-h-12 w-full items-center justify-between border bg-background px-3 text-left hover:bg-muted" onClick={() => setOpen((value) => !value)} type="button"><span><span className="block text-xs font-medium">{selected?.name ?? "选择模型"}</span><span className="mt-1 block text-[10px] text-muted-foreground">{selected ? providerName(selected.provider) : "选择一个已连接服务商提供的模型"}</span></span><ChevronDown className="size-3.5 text-muted-foreground" /></button>{open && <div className="absolute z-20 mt-1 w-full border bg-popover p-1 shadow-xl">{models.map((model) => <button className={`block w-full px-3 py-2.5 text-left hover:bg-muted ${model.id === selectedID ? "bg-accent" : ""}`} key={model.id} onClick={() => { void onChoose(capability.id, model.id); setOpen(false); }} type="button"><span className="flex items-center justify-between text-xs font-medium">{model.name}{model.id === selectedID && <Check className="size-3.5 text-primary" />}</span><span className="mt-1 block text-[10px] text-muted-foreground">{providerName(model.provider)} · {capability.label}</span></button>)}</div>}</> : <div className="flex min-h-12 items-center justify-between border border-dashed px-3"><span className="text-xs text-muted-foreground">没有已连接的 {capability.label} 模型。</span><Button onClick={() => onConnect(capability.id === "speech.generate" ? "elevenlabs" : undefined)} type="button" variant="outline">连接服务商</Button></div>}</div></article>;
}
