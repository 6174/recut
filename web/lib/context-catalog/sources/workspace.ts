/*
 * [INPUT]: 依赖 context-catalog/types、project/app context payload、Workspace 目录类型与 lucide 图标
 * [OUTPUT]: 对外提供 workspace 组来源：project（项目）与 app（应用，project/standalone 子类型）
 * [POS]: web/lib/context-catalog/sources 的工作台域来源；M4 来源，后端 materializer 同批补齐
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { createElement } from "react";
import { AppWindow, FolderKanban } from "lucide-react";
import { appContextPayload, projectContextPayload } from "@/components/agent-panel-types";
import { matchScore } from "../search";
import type { ContextOption, ContextPreview, ContextSource } from "../types";

export const projectSource: ContextSource = {
  type: "project",
  attrs: ["projectid", "name"],
  identity: (attrs) => (attrs.projectid ? String(attrs.projectid) : null),
  group: "workspace",
  titleKey: "agent.context.source.project",
  insertMode: "inline",
  inlineInsertable: true,
  icon: () => createElement(FolderKanban, { className: "size-3.5" }),
  label: (attrs) => String(attrs.name ?? attrs.projectid ?? "项目"),
  toContext: (attrs) => (attrs.projectid ? projectContextPayload(String(attrs.projectid)) : null),
  search: async (ctx) => {
    const query = ctx.query.trim();
    const matched = ctx.runtime.projects
      .filter((project) => !query || matchScore(`${project.name} ${project.appId}`, query) > 0);
    return matched.map((project): ContextOption => ({
      key: `project:${project.id}`,
      sourceType: "project",
      group: "workspace",
      title: project.name,
      subtitle: project.appId,
      badges: [{ key: "kind", label: "项目", tone: "default" }],
      data: project,
      context: projectContextPayload(project.id),
      score: 0,
    }));
  },
  preview: (option, ctx): ContextPreview => {
    const project = option.data as { id: string; name: string; appId: string };
    const app = ctx.runtime.apps.find((item) => item.manifest.id === project.appId);
    return {
      title: project.name,
      subtitle: app?.manifest.name ?? project.appId,
      facts: [
        { key: "app", label: "App", value: app?.manifest.name ?? project.appId },
        { key: "kind", label: "App 类型", value: app?.manifest.type ?? "—" },
        { key: "id", label: "项目 ID", value: project.id },
      ],
      badges: option.badges,
      open: { labelKey: "agent.context.preview.openProject", href: `/projects/${project.id}` },
    };
  },
};

export const appSource: ContextSource = {
  type: "app",
  attrs: ["appid", "name"],
  identity: (attrs) => (attrs.appid ? String(attrs.appid) : null),
  group: "workspace",
  titleKey: "agent.context.source.app",
  insertMode: "inline",
  inlineInsertable: true,
  icon: () => createElement(AppWindow, { className: "size-3.5" }),
  label: (attrs) => String(attrs.name ?? attrs.appid ?? "应用"),
  toContext: (attrs) => (attrs.appid ? appContextPayload(String(attrs.appid)) : null),
  search: async (ctx) => {
    const query = ctx.query.trim();
    const installed = ctx.runtime.installations.map((installation) => installation.manifest);
    const catalog = ctx.runtime.apps.map((app) => app.manifest);
    const byID = new Map<string, (typeof installed)[number]>();
    for (const manifest of [...catalog, ...installed]) byID.set(manifest.id, manifest);
    return [...byID.values()]
      .filter((manifest) => !query || matchScore(`${manifest.name} ${manifest.description ?? ""}`, query) > 0)
      .map((manifest): ContextOption => ({
        key: `app:${manifest.id}`,
        sourceType: "app",
        group: "workspace",
        subKind: manifest.type,
        title: manifest.name,
        subtitle: manifest.description,
        badges: [{ key: "kind", label: manifest.type === "standalone" ? "独立应用" : "项目应用", tone: "muted" }],
        data: manifest,
        context: appContextPayload(manifest.id),
        score: 0,
      }));
  },
  preview: (option): ContextPreview => {
    const manifest = option.data as {
      id: string;
      name: string;
      description?: string;
      author?: string;
      version?: string;
      type: string;
      agentSurface?: { domain: string; defaultIntent: string; requiredSkill?: string };
    };
    return {
      title: manifest.name,
      subtitle: manifest.description,
      facts: [
        { key: "author", label: "作者", value: manifest.author ?? "—" },
        { key: "version", label: "版本", value: manifest.version ?? "—" },
        { key: "kind", label: "类型", value: manifest.type },
        { key: "domain", label: "领域", value: manifest.agentSurface?.domain ?? "—" },
        { key: "intent", label: "默认意图", value: manifest.agentSurface?.defaultIntent ?? "—" },
        { key: "skill", label: "Required Skill", value: manifest.agentSurface?.requiredSkill ?? "—" },
      ],
      badges: option.badges,
    };
  },
};
