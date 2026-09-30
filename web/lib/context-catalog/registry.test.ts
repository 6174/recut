/*
 * [INPUT]: 依赖 node:test / node:assert 与 context-catalog/registry
 * [OUTPUT]: 回归生成参考协议：`<reference>` 必须进协议表（可解析/可序列化/可渲染 chip），但不进 @ 面板目录
 * [POS]: web/lib/context-catalog 的注册表契约测试；保证 AI 写入的提示词标签不再以原文显示
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { contextProtocolRegistry, contextSourceForType, contextSourcesForGroup } from "./registry";

describe("context protocol registry", () => {
  it("registers <reference> in the protocol table", () => {
    const protocol = contextProtocolRegistry().find((item) => item.type === "reference");
    assert.ok(protocol, "reference 协议必须注册，否则正文标签会原样显示");
    assert.deepEqual([...protocol.attrs], ["id", "kind", "role", "label"]);
    assert.equal(protocol.identity({ id: "asset_1" }), "asset_1");
    assert.equal(protocol.identity({ kind: "image" }), null);
  });

  it("keeps <reference> out of the mentioning panel catalog", () => {
    assert.equal(contextSourceForType("reference")?.inlineInsertable, false);
    assert.equal(contextSourcesForGroup("media").some((source) => source.type === "reference"), false);
  });
});
