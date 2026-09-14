/*
 * [INPUT]: 依赖 context-catalog/types 的 ContextRuntime/ContextOption 与各目录快照
 * [OUTPUT]: 对外提供 resolveContextOption(sourceType, attrs, runtime)：从 XML 属性（小写）反查运行时记录，重建可供 descriptor.preview 使用的 ContextOption
 * [POS]: web/lib/context-catalog 的反查层；供内联 chip 的 hover 预览与只读卡片复用，不新增请求
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { ContextOption, ContextRuntime } from "./types";

export function resolveContextOption(
  sourceType: string,
  attrs: Record<string, string>,
  runtime: ContextRuntime,
): ContextOption | null {
  switch (sourceType) {
    case "media": {
      const asset = runtime.mediaAssets.find((item) => item.id === attrs.assetid);
      if (!asset) return null;
      return { key: `media:${asset.id}`, sourceType, group: "media", subKind: asset.kind, title: asset.name, subtitle: `${asset.kind} · ${asset.origin}`, data: asset, score: 0 };
    }
    case "creation_world": {
      const world = runtime.worlds.find((item) => item.id === attrs.worldid);
      if (!world) return null;
      return { key: `creation_world:${world.id}`, sourceType, group: "world", subKind: world.type, title: world.name, subtitle: world.description, data: world, score: 0 };
    }
    case "creation_entity": {
      const entity = runtime.entityFor(attrs.worldid ?? "", attrs.entityid ?? "");
      const title = entity?.name ?? attrs.name ?? attrs.entityid ?? "实体";
      return { key: `creation_entity:${attrs.worldid}:${attrs.entityid}`, sourceType, group: "world", subKind: entity?.typeId ?? attrs.kind, title, data: { worldId: attrs.worldid, entityId: attrs.entityid }, score: 0 };
    }
    case "creation_evidence":
    case "world_evidence":
      return { key: `creation_evidence:${attrs.worldid}:${attrs.evidenceid}`, sourceType: "creation_evidence", group: "world", title: attrs.name ?? attrs.evidenceid ?? "证据", data: { worldId: attrs.worldid, evidenceId: attrs.evidenceid }, score: 0 };
    case "project": {
      const project = runtime.projects.find((item) => item.id === attrs.projectid);
      if (!project) return null;
      return { key: `project:${project.id}`, sourceType, group: "workspace", title: project.name, subtitle: project.appId, data: project, score: 0 };
    }
    case "app": {
      const manifest = runtime.apps.map((app) => app.manifest).find((item) => item.id === attrs.appid)
        ?? runtime.installations.map((item) => item.manifest).find((item) => item.id === attrs.appid);
      if (!manifest) return null;
      return { key: `app:${manifest.id}`, sourceType, group: "workspace", subKind: manifest.type, title: manifest.name, subtitle: manifest.description, data: manifest, score: 0 };
    }
    case "skill": {
      const skill = runtime.skills.find((item) => item.appId === attrs.appid && item.id === attrs.skillid);
      if (!skill) return null;
      return { key: `skill:${skill.appId}:${skill.id}`, sourceType, group: "capability", title: skill.name, subtitle: skill.description, data: skill, score: 0 };
    }
    case "mcp_tool": {
      const tool = runtime.mcpTools.find((item) => item.name === attrs.name && (!attrs.appid || item.appId === attrs.appid));
      if (!tool) return null;
      return { key: `mcp_tool:${attrs.appid ?? ""}:${tool.name}`, sourceType, group: "capability", title: tool.name, subtitle: tool.description, data: tool, score: 0 };
    }
    default:
      return null;
  }
}
