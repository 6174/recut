/*
 * [INPUT]: 依赖 service endpoint、全局与 App Skill 状态、安全软链接与 Agent MCP 注册 HTTP API、工作台 Button/Badge 原子与 i18n 字典
 * [OUTPUT]: 对外提供全部 Skill 的按归属分组面板：平台 Skill（全局）保持详细链接/启用体验，已安装 App 的 Skill 以更紧凑的行提供链接操作，并将非 JSON 服务错误转为可读提示
 * [POS]: web/components 的全局设置子面板；只展示 daemon 管理的 Skill 来源，绝不在浏览器写入用户目录或配置
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Check, Link2, LoaderCircle, RefreshCw, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { t, useI18n } from "@/lib/i18n/index";
import { interpolate } from "@/lib/i18n/workspace-dict";
import { useLocaleStore } from "@/lib/i18n/locale-store";
import { recutHeaders } from "@/lib/service-endpoint";

type SkillTarget = { id: string; name: string; path: string; status: "available" | "linked" | "conflict" | "broken" | "unavailable"; mcp: "configured" | "not-configured" | "not-applicable" | "unavailable" };
type SkillLink = { id: string; appId: string; name: string; description: string; source: string; version?: string; targets: SkillTarget[] };
type SkillGroup = { appId: string; name: string; kind: string; description: string; skills: SkillLink[] };
type SkillCatalog = { global: SkillLink[]; apps: SkillGroup[] };

const platformSkillAppID = "recut.platform";
const recutSkillID = "recut";

const statusLabelKey: Record<SkillTarget["status"], string> = {
  available: "skill.status.available",
  linked: "skill.status.linked",
  conflict: "skill.status.conflict",
  broken: "skill.status.broken",
  unavailable: "skill.status.unavailable",
};

function canLink(target: SkillTarget) { return target.status === "available" || target.status === "broken"; }
function needsSetup(target: SkillTarget) { return canLink(target) || (target.status === "linked" && target.mcp === "not-configured"); }
function linkedCount(targets: SkillTarget[]) { return targets.filter((target) => target.status === "linked").length; }
function mergeSummary(previous: SkillLink, updated: SkillLink): SkillLink {
  return { ...previous, source: updated.source ?? previous.source, version: updated.version ?? previous.version, targets: updated.targets ?? previous.targets };
}

async function readSkillResponse(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json") ? await response.json() : null;
  if (!response.ok) {
    const locale = useLocaleStore.getState().locale;
    throw new Error(body?.error ?? interpolate(t("workspace", locale, "skill.request.failed"), { status: response.status }));
  }
  if (!body) throw new Error(t("workspace", useLocaleStore.getState().locale, "skill.response.invalid"));
  return body;
}

export function RecutSkillSettings({ apiBase }: { apiBase: string }) {
  const { t: text } = useI18n();
  const [catalog, setCatalog] = useState<SkillCatalog | null>(null);
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState<string | null>(null);

  const load = useCallback(async () => {
    setMessage("");
    try {
      const response = await fetch(`${apiBase}/v1/skills`, { cache: "no-store", headers: recutHeaders() });
      const body = await readSkillResponse(response);
      setCatalog(body);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : text("skill.load.failed")); }
  }, [apiBase]);

  useEffect(() => { void load(); }, [load]);

  function updateCatalog(appId: string, skillId: string, updated: SkillLink) {
    setCatalog((current) => {
      if (!current) return current;
      if (appId === platformSkillAppID) {
        return { ...current, global: current.global.map((skill) => skill.id === skillId ? mergeSummary(skill, updated) : skill) };
      }
      return { ...current, apps: current.apps.map((group) => group.appId === appId ? { ...group, skills: group.skills.map((skill) => skill.id === skillId ? mergeSummary(skill, updated) : skill) } : group) };
    });
  }

  async function linkSkill(skill: SkillLink, targets: string[], key: string) {
    setWorking(key); setMessage("");
    try {
      const isRecut = skill.appId === platformSkillAppID && skill.id === recutSkillID;
      const response = await fetch(isRecut ? `${apiBase}/v1/skills/recut/links` : `${apiBase}/v1/skills/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...recutHeaders() },
        body: JSON.stringify(isRecut ? { targets } : { appId: skill.appId, skillId: skill.id, targets }),
      });
      const updated = await readSkillResponse(response);
      updateCatalog(skill.appId, skill.id, updated);
      setMessage(isRecut ? text("skill.linked.recut") : text("skill.linked.app"));
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : text("skill.linked.failure")); } finally { setWorking(null); }
  }

  function linkAll(skill: SkillLink) {
    const targets = skill.targets.filter(needsSetup).map((target) => target.id);
    if (targets.length === 0) return;
    void linkSkill(skill, targets, `all-${skill.id}`);
  }

  if (!catalog && !message) return <div className="grid min-h-80 place-items-center"><LoaderCircle className="size-5 animate-spin text-muted-foreground" /></div>;
  if (!catalog) return <section className="max-w-2xl pt-6"><div className="border border-destructive/35 bg-destructive/5 p-4 text-xs text-destructive">{message}<Button className="mt-3" onClick={() => void load()} type="button" variant="outline">{text("skill.retry")}</Button></div></section>;

  return <section className="max-w-2xl space-y-5 pt-6">
    <div className="border bg-muted/20 p-5">
      <div className="flex items-start gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground"><Link2 className="size-4" /></span><div><div className="flex items-center gap-2"><p className="text-sm font-medium">{text("skill.title")}</p><Badge>{catalog.global.length + catalog.apps.reduce((total, group) => total + group.skills.length, 0)} SKILLS</Badge></div><p className="mt-1 text-xs leading-5 text-muted-foreground">{text("skill.desc")}</p></div></div>
      <div className="mt-4 flex justify-end"><Button disabled={working !== null} onClick={() => void load()} type="button" variant="ghost"><RefreshCw className={`size-3.5 ${working === "refresh" ? "animate-spin" : ""}`} />{text("skill.refresh")}</Button></div>
    </div>

    <div className="border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3"><div><p className="text-sm font-medium">{text("skill.platform")}</p><p className="mt-1 text-[11px] text-muted-foreground">{text("skill.platform.desc")}</p></div><span className="text-[11px] text-muted-foreground">{interpolate(text("skill.count"), { count: catalog.global.length })}</span></div>
      <div className="divide-y">{catalog.global.map((skill) => <GlobalSkillRow disabled={working !== null} key={skill.id} linkAll={() => linkAll(skill)} onLink={(targets, key) => void linkSkill(skill, targets, key)} skill={skill} working={working} />)}</div>
    </div>

    <div className="space-y-4">
      <div className="flex items-center justify-between border-b pb-2"><p className="text-sm font-medium">{text("skill.app.title")}</p><span className="text-[11px] text-muted-foreground">{interpolate(text("skill.app.summary"), { apps: catalog.apps.length, skills: catalog.apps.reduce((total, group) => total + group.skills.length, 0) })}</span></div>
      {catalog.apps.length ? catalog.apps.map((group) => <div className="border bg-card" key={group.appId}>
        <div className="flex items-start justify-between gap-3 border-b px-4 py-3"><div className="min-w-0"><div className="flex items-center gap-2"><p className="text-sm font-medium">{group.name}</p><Badge>{group.kind === "project" ? "PROJECT" : "STANDALONE"}</Badge></div><code className="mt-1 block font-mono text-[10px] text-muted-foreground">{group.appId}</code></div><span className="shrink-0 text-[11px] text-muted-foreground">{interpolate(text("skill.group.count"), { count: group.skills.length })}</span></div>
        <p className="border-b px-4 py-2.5 text-[11px] leading-4 text-muted-foreground">{group.description}</p>
        <div className="divide-y">{group.skills.map((skill) => <AppSkillRow disabled={working !== null} key={skill.id} onLink={(targets, key) => void linkSkill(skill, targets, key)} skill={skill} working={working} />)}</div>
      </div>) : <div className="grid min-h-40 place-items-center border border-dashed p-6 text-center"><p className="text-xs text-muted-foreground">{text("skill.app.empty")}</p></div>}
    </div>
    {message && <p className="text-xs leading-5 text-muted-foreground" role="status">{message}</p>}
  </section>;
}

function GlobalSkillRow({ disabled, linkAll, onLink, skill, working }: { disabled: boolean; linkAll: () => void; onLink: (targets: string[], key: string) => void; skill: SkillLink; working: string | null }) {
  const { t: text } = useI18n();
  const setupTargets = skill.targets.filter(needsSetup);
  return <div className="px-4 py-4">
    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2"><p className="text-sm font-medium">{skill.name}{skill.version ? <span className="font-mono text-xs text-muted-foreground">v{skill.version}</span> : null}</p></div><p className="mt-1 text-xs leading-5 text-muted-foreground">{skill.description}</p></div><Button className="h-7 px-2 text-[11px]" disabled={disabled || setupTargets.length === 0} onClick={linkAll} type="button"><Link2 className="size-3.5" />{text("skill.enableAll")}</Button></div>
    <div className="mt-3 border bg-background px-3 py-2.5"><p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">{text("skill.installed.path")}</p><code className="mt-1 block break-all text-xs">{skill.source}</code></div>
    <div className="mt-3 divide-y">{skill.targets.map((target) => <div className="flex items-center gap-3 py-2.5" key={target.id}><span className={`grid size-7 shrink-0 place-items-center rounded-full ${target.status === "linked" ? "bg-primary/10 text-primary" : target.status === "conflict" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}`}>{target.status === "linked" ? <Check className="size-3.5" /> : target.status === "conflict" ? <TriangleAlert className="size-3.5" /> : <Link2 className="size-3.5" />}</span><div className="min-w-0 flex-1"><p className="text-xs font-medium">{target.name}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{target.mcp === "configured" ? text("skill.mcp.configured") : target.mcp === "not-configured" ? text("skill.mcp.notConfigured") : target.mcp === "unavailable" ? text("skill.mcp.unavailable") : text("skill.mcp.native")}</p></div><span className="hidden text-[11px] text-muted-foreground sm:block">{text(statusLabelKey[target.status])}</span>{needsSetup(target) ? <Button className="h-7 px-2 text-[11px]" disabled={disabled} onClick={() => onLink([target.id], `${skill.id}:${target.id}`)} type="button" variant="outline">{working === `${skill.id}:${target.id}` ? <LoaderCircle className="size-3.5 animate-spin" /> : <Link2 className="size-3.5" />}{target.status === "broken" ? text("skill.repair") : target.status === "linked" ? text("skill.enableMCP") : text("skill.link")}</Button> : null}</div>)}</div>
  </div>;
}

function AppSkillRow({ disabled, onLink, skill, working }: { disabled: boolean; onLink: (targets: string[], key: string) => void; skill: SkillLink; working: string | null }) {
  const { t: text } = useI18n();
  const linked = linkedCount(skill.targets);
  const ready = skill.targets.filter(canLink).map((target) => target.id);
  const conflict = skill.targets.some((target) => target.status === "conflict");
  return <div className="flex items-center gap-3 px-4 py-3">
    <span className={`grid size-7 shrink-0 place-items-center rounded-full ${linked === skill.targets.length ? "bg-primary/10 text-primary" : conflict ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}`}>{linked === skill.targets.length ? <Check className="size-3.5" /> : conflict ? <TriangleAlert className="size-3.5" /> : <Link2 className="size-3.5" />}</span>
    <div className="min-w-0 flex-1"><p className="text-xs font-medium">{skill.name}</p><p className="mt-0.5 truncate text-[10px] text-muted-foreground" title={skill.description}>{skill.description}</p></div>
    <span className="hidden shrink-0 text-[10px] text-muted-foreground sm:block">{interpolate(text("skill.linked.count"), { linked, total: skill.targets.length })}</span>
    <Button className="h-7 px-2 text-[11px]" disabled={disabled || ready.length === 0} onClick={() => onLink(ready, skill.id)} type="button" variant="outline">{working === skill.id ? <LoaderCircle className="size-3.5 animate-spin" /> : <Link2 className="size-3.5" />}{linked === skill.targets.length ? text("skill.linked.short") : text("skill.link")}</Button>
  </div>;
}
