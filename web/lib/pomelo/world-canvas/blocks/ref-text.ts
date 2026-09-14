/*
 * [INPUT]: 无外部依赖；纯字符串处理
 * [OUTPUT]: 对外提供 displayRefText：把内联引用 XML 标签替换为 `@name`，未知/无 name 标签原样保留
 * [POS]: lib/pomelo/world-canvas/blocks 的只读展示转换；不 import context-catalog，避免把 React/业务依赖带进画布渲染
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

// 与 lib/rich-composer/protocol/parse.ts 的 tagPattern 保持同一组标签名与属性命名（小写）。
const TAG = /<(media|creation_world|creation_entity|world_evidence|creation_evidence|project|app|skill|mcp_tool)\b((?:"[^"]*"|'[^']*'|[^>"'])*?)\s*\/?>/g;
const ATTR = /([a-z]+)="([^"]*)"/g;

export function displayRefText(text: string): string {
  if (!text || text.indexOf("<") < 0) return text;
  return text.replace(TAG, (raw, _type: string, attrsSource: string) => {
    let name = "";
    for (const match of String(attrsSource).matchAll(ATTR)) {
      if (match[1] === "name") name = match[2];
    }
    return name ? `@${name}` : raw;
  });
}
