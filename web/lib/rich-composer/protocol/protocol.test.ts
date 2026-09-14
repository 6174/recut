/*
 * [INPUT]: 依赖 node:test / node:assert 与 protocol 的 stringToDoc / docToMarkdown / extractRefs / extractRefsFromDoc
 * [OUTPUT]: 对外提供 L0 协议回归测试：往返幂等、多标签解析、去重、未知标签保留（搬运 brainloop prompt-string-to-doc / extract-mentions 用例语义）
 * [POS]: web/lib/rich-composer/protocol 的协议测试；保障 markdown + XML 双向转换稳定
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractRefs, parseInlineRefs, referenceDisplayText, stringToDoc } from "./parse";
import { docToMarkdown, extractRefsFromDoc } from "./serialize";
import type { RefProtocolRegistry } from "./types";

const registry: RefProtocolRegistry = [
  { type: "media", attrs: ["type", "assetid", "name"], identity: (attrs) => attrs.assetid ?? null },
  { type: "creation_world", attrs: ["worldid", "revisionid", "name"], identity: (attrs) => attrs.worldid ?? null, label: (attrs) => attrs.name ?? attrs.worldid ?? "" },
  {
    type: "creation_entity",
    attrs: ["worldid", "entityid", "kind", "name"],
    identity: (attrs) => (attrs.worldid && attrs.entityid ? `${attrs.worldid}:${attrs.entityid}` : null),
  },
];

describe("stringToDoc / docToMarkdown", () => {
  it("restores inline tags into reference nodes and roundtrips", () => {
    const text = '小黄牛 <media type="image" assetid="asset_2" name="图片 2" /> 在陡峭雪坡攀爬。';
    const doc = stringToDoc(text, registry);
    assert.deepEqual(doc.content?.[0]?.content, [
      { type: "text", text: "小黄牛 " },
      { type: "reference", attrs: { refType: "media", type: "image", assetid: "asset_2", name: "图片 2" } },
      { type: "text", text: " 在陡峭雪坡攀爬。" },
    ]);
    assert.equal(docToMarkdown(doc, registry), text);
  });

  it("keeps line breaks and paragraphs stable", () => {
    const doc = stringToDoc("Line 1\nLine 2\n\nSecond block", registry);
    assert.deepEqual(doc, {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Line 1" },
            { type: "hardBreak" },
            { type: "text", text: "Line 2" },
          ],
        },
        { type: "paragraph", content: [{ type: "text", text: "Second block" }] },
      ],
    });
  });

  it("serializes identity attributes first and escapes values", () => {
    const doc = stringToDoc('<creation_entity name="小黄 & 牛" entityid="e_45" worldid="w_123" kind="character" />', registry);
    assert.equal(
      docToMarkdown(doc, registry),
      '<creation_entity worldid="w_123" entityid="e_45" kind="character" name="小黄 &amp; 牛" />',
    );
  });

  it("preserves unknown tags as literal text", () => {
    const text = '前 <future_thing foo="1" /> 后';
    const doc = stringToDoc(text, registry);
    assert.equal(doc.content?.[0]?.content?.[0]?.type, "text");
    assert.equal(docToMarkdown(doc, registry), text);
  });

  it("treats pure plain text as paragraphs with no refs", () => {
    const doc = stringToDoc("只有纯文本", registry);
    assert.deepEqual(extractRefsFromDoc(doc, registry), []);
  });
});

describe("parseInlineRefs / extractRefs", () => {
  it("parses multiple tags with positions", () => {
    const text = '<media type="image" assetid="a1" name="一" /> 与 <creation_world worldid="w1" name="世界" />';
    const refs = parseInlineRefs(text, registry);
    assert.equal(refs.length, 2);
    assert.equal(refs[0]?.type, "media");
    assert.equal(refs[1]?.type, "creation_world");
    assert.equal(text.slice(refs[0]!.start, refs[0]!.end), refs[0]!.raw);
  });

  it("dedupes by identity in first-seen order", () => {
    const text =
      '<media type="image" assetid="a1" name="一" /> <media type="video" assetid="a1" name="一改" /> <creation_entity worldid="w1" entityid="e1" name="甲" />';
    const refs = extractRefs(text, registry);
    assert.deepEqual(
      refs.map((ref) => ref.key),
      ["media:a1", "creation_entity:w1:e1"],
    );
    assert.equal(refs[0]?.attrs.type, "image");
  });

  it("ignores unregistered tags and paired block tags with content", () => {
    const text = '<context-quote>被引用</context-quote> 和 <media type="image" assetid="a2" name="二" />';
    const refs = parseInlineRefs(text, registry);
    assert.equal(refs.length, 1);
    assert.equal(refs[0]?.attrs.assetid, "a2");
  });
});

describe("referenceDisplayText", () => {
  it("substitutes registered tags with @label, never raw XML", () => {
    const text = '小黄牛 <creation_entity worldid="w1" entityid="e1" kind="character" name="小黄牛" /> 在 <media type="image" assetid="a1" name="图片 1" /> 上';
    assert.equal(referenceDisplayText(text, registry), "小黄牛 @小黄牛 在 @图片 1 上");
  });

  it("keeps unknown tags literal and prefers descriptor.label", () => {
    const text = '<future_thing a="1" /> 与 <creation_world worldid="w1" name="雪山世界" />';
    assert.equal(referenceDisplayText(text, registry), '<future_thing a="1" /> 与 @雪山世界');
  });
});

describe("extractRefsFromDoc", () => {
  it("extracts and dedupes refs from a PM doc", () => {
    const doc = stringToDoc(
      '<creation_entity worldid="w1" entityid="e1" name="甲" /> 与 <creation_entity worldid="w1" entityid="e1" name="甲" />',
      registry,
    );
    const refs = extractRefsFromDoc(doc, registry);
    assert.equal(refs.length, 1);
    assert.equal(refs[0]?.key, "creation_entity:w1:e1");
  });
});
