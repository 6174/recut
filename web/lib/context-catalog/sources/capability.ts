/*
 * [INPUT]: 依赖 context-catalog/types、skill/mcp_tool context payload、技能与工具目录类型与 lucide 图标
 * [OUTPUT]: 对外提供 capability 组来源：skill（平台/App 工作流）与 mcp_tool（MCP 工具，含 inputSchema 预览）
 * [POS]: web/lib/context-catalog/sources 的能力域来源；M4 来源，引用为强提示非硬约束
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { createElement } from "react";
import { Sparkles, Wrench } from "lucide-react";
import { mcpToolContextPayload, skillContextPayload } from "@/components/agent-panel-types";
import { matchScore, sourceLimit } from "../search";
import type { ContextOption, ContextPreview, ContextSource } from "../types";

export const skillSource: ContextSource = {
  type: "skill",
  attrs: ["appid", "skillid", "name"],
  identity: (attrs) => (attrs.appid && attrs.skillid ? `${attrs.appid}:${attrs.skillid}` : null),
  group: "capability",
  titleKey: "agent.context.source.skill",
  insertMode: "inline",
  inlineInsertable: true,
  icon: () => createElement(Sparkles, { className: "size-3.5" }),
  label: (attrs) => String(attrs.name ?? attrs.skillid ?? "Skill"),
  toContext: (attrs) =>
    attrs.appid && attrs.skillid ? skillContextPayload(String(attrs.appid), String(attrs.skillid)) : null,
  search: async (ctx) => {
    const query = ctx.query.trim();
    return ctx.runtime.skills
      .filter((skill) => !query || matchScore(`${skill.name} ${skill.description}`, query) > 0)
      .slice(0, sourceLimit(ctx.query, ctx.group, ctx.limit))
      .map((skill): ContextOption => ({
        key: `skill:${skill.appId}:${skill.id}`,
        sourceType: "skill",
        group: "capability",
        subKind: skill.appId,
        title: skill.name,
        subtitle: skill.description,
        badges: [{ key: "app", label: skill.appId, tone: "muted" }],
        data: skill,
        context: skillContextPayload(skill.appId, skill.id),
        score: 0,
      }));
  },
  preview: (option): ContextPreview => {
    const skill = option.data as { id: string; appId: string; name: string; description: string; source: string; version?: string };
    return {
      title: skill.name,
      subtitle: skill.description,
      facts: [
        { key: "app", label: "App", value: skill.appId },
        { key: "source", label: "路径", value: skill.source },
        { key: "version", label: "版本", value: skill.version ?? "—" },
      ],
      badges: option.badges,
    };
  },
};

export const mcpToolSource: ContextSource = {
  type: "mcp_tool",
  attrs: ["name", "appid"],
  identity: (attrs) => (attrs.name ? `${attrs.appid ? `${attrs.appid}:` : ""}${attrs.name}` : null),
  group: "capability",
  titleKey: "agent.context.source.mcpTool",
  insertMode: "inline",
  inlineInsertable: true,
  icon: () => createElement(Wrench, { className: "size-3.5" }),
  label: (attrs) => String(attrs.name ?? "MCP 工具"),
  toContext: (attrs) =>
    attrs.name ? mcpToolContextPayload(String(attrs.name), attrs.appid ? String(attrs.appid) : undefined) : null,
  search: async (ctx) => {
    const query = ctx.query.trim();
    return ctx.runtime.mcpTools
      .filter((tool) => !query || matchScore(`${tool.name} ${tool.description}`, query) > 0)
      .slice(0, sourceLimit(ctx.query, ctx.group, ctx.limit))
      .map((tool): ContextOption => ({
        key: `mcp_tool:${tool.appId ? `${tool.appId}:` : ""}${tool.name}`,
        sourceType: "mcp_tool",
        group: "capability",
        subKind: tool.appId,
        title: tool.name,
        subtitle: tool.description,
        badges: [{ key: "app", label: tool.appName ?? tool.appId ?? "Global", tone: "muted" }],
        data: tool,
        context: mcpToolContextPayload(tool.name, tool.appId),
        score: 0,
      }));
  },
  preview: (option): ContextPreview => {
    const tool = option.data as { name: string; description: string; inputSchema?: Record<string, unknown>; appId?: string };
    return {
      title: tool.name,
      subtitle: tool.description,
      body: tool.inputSchema ? JSON.stringify(tool.inputSchema, null, 2) : undefined,
      facts: [{ key: "app", label: "App", value: tool.appId ?? "Global" }],
      badges: option.badges,
    };
  },
};
