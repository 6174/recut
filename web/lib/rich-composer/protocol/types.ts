/*
 * [INPUT]: 无外部依赖；纯类型定义
 * [OUTPUT]: 对外提供 L0 内核协议的最小接口：RefProtocol（type/attrs/identity）与注册表、解析结果 ParsedRef/ExtractedRef
 * [POS]: web/lib/rich-composer/protocol 的协议类型层；不依赖 React / 任何 store，序列化与提取可在 Node / Worker / 测试中运行
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

// 解析后的属性表：键统一小写（XML 属性命名规范 RFC §6.3），值为去转义后的字符串。
export type RefAttrRecord = Record<string, string>;

// RefProtocol 是「协议组」的最小纯字段集：选择面 RFC 的 ContextSource 必须满足它。
// identity 只消费已归一化的小写属性；返回 null 表示该标签不构成合法引用。
export type RefProtocol = {
  /** XML 标签名，也是 PM 节点 attrs.type 值。小写、稳定。 */
  type: string;
  /** 序列化/解析时允许出现在 XML 上的属性白名单（含 name 展示冗余）。 */
  attrs: readonly string[];
  /** 稳定身份字段（提取 refs 与 contexts 对齐）；null = 非法 */
  identity: (attrs: RefAttrRecord) => string | null;
  /** 只读展示文案（如 `@小黄牛`）；缺省回退 attrs.name/title */
  label?: (attrs: RefAttrRecord) => string;
};

export type RefProtocolRegistry = readonly RefProtocol[];

// 解析到的一处内联标签（保留位置，供编辑器替换/回填）。
export type ParsedRef = {
  type: string;
  attrs: RefAttrRecord;
  raw: string;
  start: number;
  end: number;
};

// 去重后的结构化引用：key = `${type}:${identity}`。
export type ExtractedRef = {
  type: string;
  attrs: RefAttrRecord;
  identity: string;
  key: string;
};
