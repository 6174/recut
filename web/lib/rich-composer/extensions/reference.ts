/*
 * [INPUT]: 依赖 @tiptap/core 的 Node/mergeAttributes 与 protocol/types 注册表
 * [OUTPUT]: 对外提供 createReferenceExtension(registry)：单一 reference 原子节点，属性由所有 descriptor.attrs 并集决定，判别属性 refType
 * [POS]: web/lib/rich-composer/extensions 的引用节点定义（协议 RFC §4/§5）；不依赖 React，NodeView 由 L1 注入
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { mergeAttributes, Node } from "@tiptap/core";
import type { RefAttrRecord, RefProtocolRegistry } from "../protocol/types";
import { REFERENCE_NODE_TYPE, REFERENCE_TYPE_ATTR } from "../protocol/serialize";

export function referenceLabel(registry: RefProtocolRegistry, refType: string, attrs: RefAttrRecord): string {
  const source = registry.find((item) => item.type === refType);
  return String(attrs.name ?? attrs.title ?? source?.type ?? refType);
}

export function referenceAttributeNames(registry: RefProtocolRegistry): string[] {
  const names = new Set<string>([REFERENCE_TYPE_ATTR]);
  for (const protocol of registry) for (const attr of protocol.attrs) names.add(attr);
  return [...names];
}

export function createReferenceExtension(registry: RefProtocolRegistry, nodeView?: () => unknown) {
  return Node.create({
    name: REFERENCE_NODE_TYPE,
    group: "inline",
    inline: true,
    atom: true,
    selectable: false,

    addAttributes() {
      return Object.fromEntries(referenceAttributeNames(registry).map((name) => [name, { default: null }]));
    },

    parseHTML() {
      return [{ tag: 'span[data-type="reference"]' }];
    },

    renderHTML({ HTMLAttributes }) {
      const refType = String(HTMLAttributes[REFERENCE_TYPE_ATTR] ?? "");
      const label = referenceLabel(registry, refType, HTMLAttributes as RefAttrRecord);
      return [
        "span",
        mergeAttributes(HTMLAttributes, {
          "data-type": "reference",
          "data-ref-type": refType,
        }),
        `@${label}`,
      ];
    },

    renderText({ node }) {
      const refType = String(node.attrs[REFERENCE_TYPE_ATTR] ?? "");
      return `@${referenceLabel(registry, refType, node.attrs as RefAttrRecord)}`;
    },

    // NodeView 由 L1 注入，保持 L0 无 React 依赖。
    ...(nodeView ? { addNodeView: nodeView as never } : {}),
  });
}
