/*
 * [INPUT]: 依赖 service endpoint 配置、Recut Skill 状态、media-configuration-store 的 Provider/Credential/Route 快照、工作台 UI 原子组件（含 CustomSelect 全局下拉）、i18n 字典与 /v1/preferences 语言偏好持久化
 * [OUTPUT]: 对外提供全局设置面板，以及通用设置（界面语言）、本机/LAN service 连接、Recut Skill 软链接、Recut MCP 工具清单、Provider 连接/删除和用途模型配置体验；连接 Provider 走二级弹框，只列出需要密钥的服务商，Audio Studio 本机 TTS 作为语音生成的免密钥特殊选项直接出现在用途模型里；只展示已可用的设置项，加载完成前保留明确等待态，图片用途可选择无需密钥的 Codex 原生生图，表单字段均有可见标签，服务商与用途模型下拉统一复用 CustomSelect（Radix Popover Portal，避免重叠/裁剪）
 * [POS]: web/components 的工作台级设置入口；通用偏好（语言）、service 地址、Recut Skill、Provider、Codex 原生图片与用途模型的唯一用户配置界面，不暴露尚未实现的应用管理入口，API Key 草稿不外泄到全局缓存；打开时从 /v1/preferences 载入语言偏好
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Check, Copy, Image, Link2, Mic2, Plug, Plus, Server, Settings, SlidersHorizontal, Sparkles, Trash2, Video, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { RecutMCPSettings } from "@/components/recut-mcp-settings";
import { RecutSkillSettings } from "@/components/recut-skill-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CustomSelect } from "@/components/ui/select-field";
import { useI18n, type Locale } from "@/lib/i18n/index";
import { interpolate } from "@/lib/i18n/workspace-dict";
import { useLocaleStore } from "@/lib/i18n/locale-store";
import { loadLocalePreference, saveLocalePreference } from "@/lib/i18n/preferences";
import { fetchRecutJSON, normalizeServiceEndpoint } from "@/lib/service-endpoint";
import {
  useMediaConfigurationStore,
  type MediaCredential as Credential,
  type MediaProvider as Provider,
} from "@/lib/media-configuration-store";
import { useServiceStore } from "@/lib/service-store";
import { useWorkspaceStore } from "@/lib/workspace-store";
import type { Model } from "@/app/media/media-types";

type SettingSection = "general" | "service" | "multimodal" | "skill" | "mcp";
const codexImageModel: Model = { id: "codex/image", provider: "codex", name: "Codex", capability: "image.generate", available: true, inputModes: ["text"] };
const codexImageProvider: Provider = { id: "codex", name: "Codex", defaultApiBase: "", models: [codexImageModel] };
const localAudioProviderId = "local-audio";

const sections: { id: SettingSection; labelKey: string; icon: typeof Server }[] = [
  { id: "general", labelKey: "settings.section.general", icon: SlidersHorizontal },
  { id: "service", labelKey: "settings.section.service", icon: Server },
  { id: "skill", labelKey: "settings.section.skill", icon: Link2 },
  { id: "mcp", labelKey: "settings.section.mcp", icon: Plug },
  { id: "multimodal", labelKey: "settings.section.multimodal", icon: Sparkles },
];

const capabilities = [
  { id: "image.generate", labelKey: "capability.image.generate", descriptionKey: "capability.image.generate.desc", icon: Image },
  { id: "video.generate", labelKey: "capability.video.generate", descriptionKey: "capability.video.generate.desc", icon: Video },
  { id: "speech.generate", labelKey: "capability.speech.generate", descriptionKey: "capability.speech.generate.desc", icon: Mic2 },
];

const providerGuidance: Record<string, { useKey: string; noteKey: string }> = {
  "atlas-cloud": { useKey: "provider.atlas-cloud.use", noteKey: "provider.atlas-cloud.note" },
  "skymind-token": { useKey: "provider.skymind-token.use", noteKey: "provider.skymind-token.note" },
  openai: { useKey: "provider.openai.use", noteKey: "provider.openai.note" },
  "openai-compatible": { useKey: "provider.openai-compatible.use", noteKey: "provider.openai-compatible.note" },
  gemini: { useKey: "provider.gemini.use", noteKey: "provider.gemini.note" },
  grok: { useKey: "provider.grok.use", noteKey: "provider.grok.note" },
  minimax: { useKey: "provider.minimax.use", noteKey: "provider.minimax.note" },
  elevenlabs: { useKey: "provider.elevenlabs.use", noteKey: "provider.elevenlabs.note" },
};

function capabilityLabel(t: (key: string) => string, id: string) { return t(capabilities.find((item) => item.id === id)?.labelKey ?? "common.fallback"); }
function providerInfo(t: (key: string) => string, id: string) {
  const guidance = providerGuidance[id];
  return guidance ? { use: t(guidance.useKey), note: t(guidance.noteKey) } : { use: t("provider.guidance.fallback.use"), note: t("provider.guidance.fallback.note") };
}

export function SettingsPanel({ open: controlledOpen, onOpenChange, section }: { open?: boolean; onOpenChange?: (open: boolean) => void; section?: SettingSection }) {
  const { t } = useI18n();
  const apiBase = useServiceStore((state) => state.endpoint);
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const [selectedSection, setSelectedSection] = useState<SettingSection>("general");
  const open = controlledOpen ?? uncontrolledOpen;
  const activeSection = section ?? selectedSection;
  function setOpen(next: boolean) { if (controlledOpen === undefined) setUncontrolledOpen(next); onOpenChange?.(next); }
  useEffect(() => { if (!open) return; const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); }; window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close); }, [open]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    void loadLocalePreference(apiBase).then((locale) => { if (active) useLocaleStore.getState().setLocale(locale); });
    return () => { active = false; };
  }, [open, apiBase]);
  const sectionDescription = activeSection === "general" ? t("settings.desc.general") : activeSection === "service" ? t("settings.desc.service") : activeSection === "multimodal" ? t("settings.desc.multimodal") : activeSection === "skill" ? t("settings.desc.skill") : t("settings.desc.mcp");
  return (
    <>
      <button aria-expanded={open} aria-haspopup="dialog" aria-label={t("settings.open.aria")} className="grid size-8 place-items-center rounded-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" onClick={() => setOpen(true)} title={t("settings.open.aria")} type="button">
        <Settings className="size-4" />
      </button>
      {open && (
        <div aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-foreground/20 p-6 backdrop-blur-[1px]" onMouseDown={() => setOpen(false)} role="dialog">
          <section className="grid h-[min(760px,calc(100vh-3rem))] w-full max-w-6xl overflow-hidden rounded-sm border bg-card shadow-2xl [grid-template-columns:224px_minmax(0,1fr)]" onMouseDown={(event) => event.stopPropagation()}>
            <nav aria-label={t("settings.nav.aria")} className="border-r bg-muted/40 p-4">
              <div className="mb-7 px-2 pt-1"><p className="font-mono text-[10px] tracking-wide text-muted-foreground">RECUT</p><p className="mt-1.5 text-sm font-semibold">{t("settings.title")}</p></div>
              <div className="space-y-1">{sections.map((item) => { const Icon = item.icon; return <button className={`flex h-9 w-full items-center gap-2.5 rounded-xs px-3 text-left text-xs ${activeSection === item.id ? "bg-card font-medium text-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`} key={item.id} onClick={() => setSelectedSection(item.id)} type="button"><Icon className="size-3.5" />{t(item.labelKey)}</button>; })}</div>
            </nav>
            <div className="min-w-0 overflow-y-auto p-8">
              <div className="flex items-start justify-between border-b pb-6"><div><h2 className="text-lg font-semibold">{t(sections.find((item) => item.id === activeSection)?.labelKey ?? "settings.title")}</h2><p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{sectionDescription}</p></div><button aria-label={t("settings.close.aria")} className="grid size-8 place-items-center rounded-xs text-muted-foreground hover:bg-muted" onClick={() => setOpen(false)} type="button"><X className="size-4" /></button></div>
              {activeSection === "general" ? <LanguageSettings /> : activeSection === "service" ? <ServiceEndpointSettings /> : activeSection === "multimodal" ? <ProviderSettings /> : activeSection === "skill" ? <RecutSkillSettings apiBase={apiBase} /> : <RecutMCPSettings apiBase={apiBase} />}
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function LanguageSettings() {
  const { t, locale, setLocale } = useI18n();
  const apiBase = useServiceStore((state) => state.endpoint);
  const options: { value: Locale; label: string }[] = [
    { value: "zh", label: t("locale.zh") },
    { value: "en", label: t("locale.en") },
  ];
  function choose(next: Locale) {
    if (next === locale) return;
    setLocale(next);
    void saveLocalePreference(apiBase, next);
    // 语言变化后重取目录数据：App 名称/描述按 Accept-Language 本地化，缓存按 endpoint 只取一次。
    if (apiBase) void useWorkspaceStore.getState().load(apiBase, true);
  }
  return <section className="max-w-2xl pt-6"><div className="border bg-muted/20 p-5"><div className="flex items-start gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground"><Settings className="size-4" /></span><div><p className="text-sm font-medium">{t("settings.language.title")}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{t("settings.language.desc")}</p></div></div><fieldset className="mt-4 flex flex-col gap-2"><legend className="sr-only">{t("settings.language.title")}</legend>{options.map((option) => <label className="flex cursor-pointer items-center gap-2 rounded-xs border bg-background px-3 py-2 text-xs hover:bg-muted" htmlFor={`locale-${option.value}`} key={option.value}><input checked={locale === option.value} className="accent-primary" id={`locale-${option.value}`} name="workspace-locale" onChange={() => choose(option.value)} type="radio" value={option.value} /><span className="flex-1">{option.label}</span>{locale === option.value && <Check className="size-3.5 text-primary" />}</label>)}</fieldset></div></section>;
}

function ServiceEndpointSettings() {
  const { t } = useI18n();
  const savedEndpoint = useServiceStore((state) => state.endpoint);
  const setServiceEndpoint = useServiceStore((state) => state.setEndpoint);
  const resetServiceEndpoint = useServiceStore((state) => state.resetEndpoint);
  const refreshService = useServiceStore((state) => state.refresh);
  const [endpoint, setEndpoint] = useState(savedEndpoint);
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);
  const installCommand = "curl -fsSL https://recut.video/install.sh | sh";

  useEffect(() => { setEndpoint(savedEndpoint); }, [savedEndpoint]);

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage(""); setWorking(true);
    try {
      const nextEndpoint = normalizeServiceEndpoint(endpoint);
      setServiceEndpoint(nextEndpoint);
      await refreshService();
      const insecureRemote = window.location.protocol === "https:" && nextEndpoint.startsWith("http:") && !nextEndpoint.includes("127.0.0.1") && !nextEndpoint.includes("localhost");
      setMessage(insecureRemote ? t("settings.endpoint.insecure") : t("settings.endpoint.saved"));
    } catch (cause) { setMessage(`${cause instanceof Error ? cause.message : t("settings.endpoint.save.failed")}。`); } finally { setWorking(false); }
  }

  async function useLocalService() {
    resetServiceEndpoint();
    await refreshService();
    setMessage(t("settings.endpoint.restored"));
  }

  async function copyInstallCommand() {
    try { await navigator.clipboard.writeText(installCommand); setMessage(t("settings.endpoint.copied")); } catch { setMessage(t("settings.endpoint.copy.failed")); }
  }

  return <section className="max-w-2xl pt-6"><div className="border bg-muted/20 p-5"><div className="flex items-start gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground"><Server className="size-4" /></span><div><p className="text-sm font-medium">{t("settings.endpoint.title")}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{interpolate(t("settings.endpoint.desc"), { code: ":17373", example: "http://192.168.1.9:17373" })}</p></div></div><form className="mt-5" onSubmit={connect}><label className="mb-1.5 block text-xs font-medium" htmlFor="service-endpoint">{t("settings.endpoint.label")}</label><div className="flex gap-2"><Input id="service-endpoint" onChange={(event) => setEndpoint(event.target.value)} placeholder={t("settings.endpoint.placeholder")} value={endpoint} /><Button disabled={!endpoint.trim() || working} type="submit">{working ? t("settings.endpoint.verify") : t("settings.endpoint.connect")}</Button></div><p className="mt-2 text-[11px] leading-4 text-muted-foreground">{t("settings.endpoint.hint")}</p></form><div className="mt-5 border-t pt-4"><p className="text-xs font-medium">{t("settings.endpoint.install.title")}</p><p className="mt-1 text-[11px] leading-4 text-muted-foreground">{interpolate(t("settings.endpoint.install.desc"), { code: "127.0.0.1:17373" })}</p><div className="mt-3 flex items-center gap-2 rounded-sm border bg-background p-2"><code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap px-1 font-mono text-[11px]">{installCommand}</code><Button aria-label={t("settings.endpoint.copy.aria")} className="size-7 shrink-0 px-0" onClick={() => void copyInstallCommand()} title={t("settings.endpoint.copy.title")} type="button" variant="outline"><Copy className="size-3.5" /></Button></div></div><div className="mt-5 flex items-center justify-between border-t pt-4"><div><p className="text-xs font-medium">{t("settings.endpoint.restore.title")}</p><p className="mt-1 text-[11px] text-muted-foreground">{t("settings.endpoint.restore.desc")}</p></div><Button onClick={useLocalService} type="button" variant="outline">{t("settings.endpoint.restore.submit")}</Button></div>{message && <p className="mt-4 border-l-2 border-warning/60 pl-3 text-xs text-warning">{message}</p>}</div></section>;
}

function ProviderSettings() {
  const { t } = useI18n();
  const apiBase = useServiceStore((state) => state.endpoint);
  const configuredProviders = useMediaConfigurationStore((state) => state.providers);
  const credentials = useMediaConfigurationStore((state) => state.credentials);
  const routes = useMediaConfigurationStore((state) => state.routes);
  const configurationState = useMediaConfigurationStore((state) => state.state);
  const loadConfiguration = useMediaConfigurationStore((state) => state.load);
  const providers = useMemo(
    () => configuredProviders.some((item) => item.id === codexImageProvider.id) ? configuredProviders : [...configuredProviders, codexImageProvider],
    [configuredProviders],
  );
  const [adding, setAdding] = useState(false);
  const [providerID, setProviderID] = useState("atlas-cloud");
  const [name, setName] = useState("");
  const [apiBaseValue, setAPIBaseValue] = useState("");
  const [apiKey, setAPIKey] = useState("");
  const [message, setMessage] = useState("");
  const loading = configurationState === "idle" || configurationState === "loading";
  useEffect(() => { void loadConfiguration(apiBase); }, [apiBase, loadConfiguration]);
  useEffect(() => { if (!apiBaseValue) setAPIBaseValue(providers.find((item) => item.id === providerID)?.defaultApiBase ?? ""); }, [apiBaseValue, providerID, providers]);
  const provider = providers.find((item) => item.id === providerID);
  function chooseProvider(id: string) { const next = providers.find((item) => item.id === id); setProviderID(id); setAPIBaseValue(next?.defaultApiBase ?? ""); }
  function beginAdding(preferred?: string) { if (preferred) chooseProvider(preferred); setAdding(true); setMessage(""); }
  async function addProvider(event: FormEvent) { event.preventDefault(); try { await fetchRecutJSON(apiBase, "/v1/media/credentials", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: providerID, name: name || provider?.name || providerID, apiBase: apiBaseValue, apiKey }) }); } catch { setMessage(t("settings.provider.connect.failed")); return; } setAdding(false); setName(""); setAPIKey(""); setMessage(interpolate(t("settings.provider.connected"), { name: provider?.name ?? "Provider" })); await loadConfiguration(apiBase, true); }
  async function deleteProvider(credential: Credential) { if (!window.confirm(interpolate(t("settings.provider.delete.confirm"), { name: credential.name }))) return; try { await fetchRecutJSON(apiBase, `/v1/media/credentials/${encodeURIComponent(credential.id)}`, { method: "DELETE" }); } catch { setMessage(t("settings.provider.delete.failed")); return; } setMessage(interpolate(t("settings.provider.deleted"), { name: credential.name })); await loadConfiguration(apiBase, true); }
  async function chooseModel(capability: string, modelID: string) { const model = modelID === codexImageModel.id ? codexImageModel : providers.flatMap((item) => item.models).find((item) => item.id === modelID); const credential = credentials.find((item) => item.provider === model?.provider); const keyless = model?.id === codexImageModel.id || model?.provider === localAudioProviderId; if (!model || (!keyless && !credential)) { setMessage(t("settings.provider.need.credential")); return; } try { await fetchRecutJSON(apiBase, "/v1/media/routes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: `${capability}.default`, capability, modelId: modelID, credentialId: credential?.id ?? "", enabled: true }) }); } catch { setMessage(t("settings.route.save.failed")); return; } setMessage(model.id === codexImageModel.id ? t("settings.route.codex") : interpolate(t("settings.route.switched"), { capability: capabilityLabel(t, capability), model: model.provider === localAudioProviderId ? t("settings.route.local.title") : model.name })); await loadConfiguration(apiBase, true); }
  if (loading) return <div className="grid min-h-80 place-items-center border border-dashed bg-muted/20 px-4 text-center"><div><p className="text-sm font-medium">{t("settings.provider.loading.title")}</p><p className="mt-1 text-xs text-muted-foreground">{t("settings.provider.loading.desc")}</p></div></div>;
  return <div className="space-y-9 pt-6"><section><div className="flex items-start justify-between"><div><p className="text-sm font-medium">{t("settings.provider.title")}</p><p className="mt-1 text-xs text-muted-foreground">{t("settings.provider.desc")}</p></div><Button className="size-8 px-0" onClick={() => beginAdding()} title={t("settings.provider.connect")} type="button" variant="outline"><Plus className="size-4" /></Button></div>{credentials.length ? <div className="mt-4 grid gap-2 sm:grid-cols-2">{credentials.map((credential) => { const connected = providers.find((item) => item.id === credential.provider); const info = providerInfo(t, credential.provider); return <div className="border bg-card p-3" key={credential.id}><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-medium">{credential.name}</p><p className="mt-1 text-[11px] text-muted-foreground">{connected?.name ?? credential.provider}</p></div><div className="flex items-center gap-1.5"><Badge>CONNECTED</Badge><Button aria-label={interpolate(t("settings.provider.delete.aria"), { name: credential.name })} className="size-7 px-0" onClick={() => void deleteProvider(credential)} title={t("settings.provider.delete.title")} type="button" variant="ghost"><Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" /></Button></div></div><p className="mt-3 text-[11px] leading-4 text-muted-foreground">{info.use}</p></div>; })}</div> : <div className="mt-4 flex items-center justify-between border border-dashed p-4"><p className="text-xs text-muted-foreground">{t("settings.provider.empty")}</p><Button onClick={() => beginAdding()} type="button">{t("settings.provider.connect")}</Button></div>}{adding && <ProviderConnectDialog apiBaseValue={apiBaseValue} apiKey={apiKey} name={name} onCancel={() => setAdding(false)} onProviderChange={chooseProvider} onSubmit={addProvider} providers={providers} selectedID={providerID} setAPIBaseValue={setAPIBaseValue} setAPIKey={setAPIKey} setName={setName} />}</section><section><div><p className="text-sm font-medium">{t("settings.route.title")}</p><p className="mt-1 text-xs text-muted-foreground">{t("settings.route.desc")}</p></div><div className="mt-4 space-y-3">{capabilities.map((capability) => <ModelRouteCard capability={capability} key={capability.id} models={providers.flatMap((item) => item.models).filter((model) => model.capability === capability.id)} onChoose={chooseModel} onConnect={(preferred) => beginAdding(preferred)} providerName={(id) => providers.find((item) => item.id === id)?.name ?? id} selectedID={routes.find((route) => route.capability === capability.id)?.modelId} />)}</div></section>{message && <p className="border-l-2 border-warning/60 pl-3 text-xs text-warning">{message}</p>}</div>;
}

function ProviderConnectDialog({ apiBaseValue, apiKey, name, onCancel, onProviderChange, onSubmit, providers, selectedID, setAPIBaseValue, setAPIKey, setName }: { apiBaseValue: string; apiKey: string; name: string; onCancel: () => void; onProviderChange: (id: string) => void; onSubmit: (event: FormEvent) => void; providers: Provider[]; selectedID: string; setAPIBaseValue: (value: string) => void; setAPIKey: (value: string) => void; setName: (value: string) => void }) {
  const { t } = useI18n();
  const selected = providers.find((item) => item.id === selectedID); const info = providerInfo(t, selectedID);
  const needsCustomAPIBase = selectedID === "openai-compatible";
  return <div aria-modal="true" className="fixed inset-0 z-[60] grid place-items-center bg-foreground/30 p-6" onMouseDown={onCancel} role="dialog"><section className="w-full max-w-lg border bg-card p-5 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><div className="flex items-start justify-between"><div><p className="text-sm font-medium">{t("settings.provider.connect")}</p><p className="mt-1 text-xs text-muted-foreground">{t("settings.provider.desc")}</p></div><button aria-label={t("settings.provider.form.cancel")} className="grid size-8 place-items-center rounded-xs text-muted-foreground hover:bg-muted" onClick={onCancel} type="button"><X className="size-4" /></button></div><form className="mt-4 grid content-start gap-3" onSubmit={onSubmit}><div><p className="text-xs font-medium">{t("settings.provider.form.choose")}</p><ProviderPicker onChoose={onProviderChange} providers={providers} selectedID={selectedID} /><p className="mt-3 text-xs leading-5 text-muted-foreground">{info.use}<br />{info.note}</p>{selected && <div className="mt-3 flex flex-wrap gap-1.5">{selected.models.map((model) => <span className="border bg-background px-2 py-1 text-[10px] text-muted-foreground" key={model.id}>{capabilityLabel(t, model.capability)}</span>)}</div>}</div><div><label className="mb-1.5 block text-xs font-medium" htmlFor="credential-name">{t("settings.provider.form.credential")}</label><Input id="credential-name" onChange={(event) => setName(event.target.value)} placeholder={t("settings.provider.form.credential.placeholder")} value={name} /></div>{needsCustomAPIBase && <div><label className="mb-1.5 block text-xs font-medium" htmlFor="credential-api-base">{t("settings.provider.form.apiBase")}</label><Input id="credential-api-base" onChange={(event) => setAPIBaseValue(event.target.value)} placeholder={t("settings.provider.form.apiBase.placeholder")} value={apiBaseValue} /></div>}<div><label className="mb-1.5 block text-xs font-medium" htmlFor="credential-api-key">{t("settings.provider.form.apiKey")}</label><Input id="credential-api-key" onChange={(event) => setAPIKey(event.target.value)} placeholder={t("settings.provider.form.apiKey.placeholder")} type="password" value={apiKey} /></div><div className="mt-2 flex justify-end gap-2"><Button onClick={onCancel} type="button" variant="ghost">{t("settings.provider.form.cancel")}</Button><Button disabled={!apiKey.trim() || (needsCustomAPIBase && !apiBaseValue.trim())} type="submit">{interpolate(t("settings.provider.form.submit"), { name: selected?.name ?? "Provider" })}</Button></div></form></section></div>;
}

function ProviderPicker({ onChoose, providers, selectedID }: { onChoose: (id: string) => void; providers: Provider[]; selectedID: string }) {
  const { t } = useI18n();
  const selectableProviders = providers.filter((item) => item.id !== codexImageProvider.id && item.id !== localAudioProviderId);
  return <div className="mt-2"><CustomSelect id="provider-picker" onChange={onChoose} options={selectableProviders.map((provider) => ({ label: provider.name, value: provider.id, description: providerInfo(t, provider.id).use }))} value={selectedID} /></div>;
}

function ModelRouteCard({ capability, models, onChoose, onConnect, providerName, selectedID }: { capability: (typeof capabilities)[number]; models: Model[]; onChoose: (capability: string, modelID: string) => void; onConnect: (provider?: string) => void; providerName: (id: string) => string; selectedID?: string }) {
  const { t } = useI18n();
  const Icon = capability.icon;
  const label = t(capability.labelKey);
  function modelTitle(model: Model) { return model.provider === localAudioProviderId ? t("settings.route.local.title") : model.name; }
  function modelSubtitle(model: Model) { return model.provider === localAudioProviderId ? t("settings.route.local.desc") : `${providerName(model.provider)} · ${label}`; }
  return <article className="grid gap-4 border bg-card p-4 md:grid-cols-[210px_minmax(0,1fr)]"><div><div className="flex items-center gap-2"><span className="grid size-7 place-items-center border bg-muted/40"><Icon className="size-3.5" /></span><p className="text-xs font-medium">{label}</p></div><p className="mt-2 text-[11px] leading-4 text-muted-foreground">{t(capability.descriptionKey)}</p></div><div>{models.length ? <CustomSelect id={`model-route-${capability.id}`} onChange={(modelID) => void onChoose(capability.id, modelID)} options={models.map((model) => ({ label: modelTitle(model), value: model.id, description: modelSubtitle(model) }))} value={selectedID ?? ""} /> : <div className="flex min-h-12 items-center justify-between border border-dashed px-3"><span className="text-xs text-muted-foreground">{interpolate(t("settings.model.empty"), { capability: label })}</span><Button onClick={() => onConnect(capability.id === "speech.generate" ? "elevenlabs" : undefined)} type="button" variant="outline">{t("settings.model.connect")}</Button></div>}</div></article>;
}
