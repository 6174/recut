/*
 * [INPUT]: 依赖 node:test / node:assert 与 context-catalog/search 的纯函数
 * [OUTPUT]: 对外提供目录内核回归测试：匹配权重、排序（pinned/recent/group）、去重、行分组、fan-out 失败降级
 * [POS]: web/lib/context-catalog 的目录测试；纯函数用例保证合并/排序稳定
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildContextRows,
  dedupeOptions,
  fanOutSearch,
  groupCounts,
  matchScore,
  rankOptions,
} from "./search";
import type { ContextOption, ContextSearchContext, ContextSource } from "./types";

function option(partial: Partial<ContextOption> & { key: string; sourceType: string }): ContextOption {
  return {
    group: "media",
    title: partial.key,
    data: null,
    score: 0,
    ...partial,
  } as ContextOption;
}

const ctx = (runtime: ContextSearchContext["runtime"]): ContextSearchContext => ({
  apiBase: "http://local",
  query: "",
  group: "all",
  runtime,
  signal: new AbortController().signal,
  limit: 8,
});

describe("matchScore", () => {
  it("grades exact, prefix, word-boundary, substring, subsequence", () => {
    assert.equal(matchScore("小黄牛", "小黄牛"), 200);
    assert.equal(matchScore("小黄牛的故事", "小黄牛"), 120);
    assert.equal(matchScore("关于 小黄牛", "小黄牛"), 80);
    assert.equal(matchScore("一只小黄牛", "小黄牛"), 60);
    assert.equal(matchScore("小x黄x牛", "小黄牛"), 40);
    assert.equal(matchScore("完全无关", "小黄牛"), -1);
  });
});

describe("rankOptions", () => {
  it("puts pinned first, then recent, then group weight, with stable title tie-break", () => {
    const ranked = rankOptions(
      [
        option({ key: "media:a", sourceType: "media", title: "Alpha" }),
        option({ key: "media:b", sourceType: "media", title: "Beta" }),
        option({ key: "media:c", sourceType: "media", title: "Gamma", pinned: true }),
      ],
      "",
      ["media:b"],
    );
    assert.deepEqual(ranked.map((item) => item.key), ["media:c", "media:b", "media:a"]);
  });
});

describe("dedupeOptions / groupCounts / buildContextRows", () => {
  it("dedupes by key and groups in canonical order with counts", () => {
    const options = dedupeOptions([
      option({ key: "creation_world:w1", sourceType: "creation_world", group: "world", title: "世界" }),
      option({ key: "creation_world:w1", sourceType: "creation_world", group: "world", title: "世界" }),
      option({ key: "media:a", sourceType: "media", group: "media", title: "素材" }),
    ]);
    assert.equal(options.length, 2);
    assert.deepEqual(groupCounts(options), { current: 0, world: 1, workspace: 0, media: 1, skill: 0, tool: 0 });
    const rows = buildContextRows(options);
    assert.deepEqual(
      rows.map((row) => row.kind),
      ["header", "option", "header", "option"],
    );
  });
});

describe("fanOutSearch", () => {
  const runtime = {} as ContextSearchContext["runtime"];

  it("merges sources and degrades a failed source without blocking others", async () => {
    const good: ContextSource = {
      type: "media",
      attrs: [],
      identity: () => null,
      group: "media",
      titleKey: "x",
      insertMode: "inline",
      inlineInsertable: true,
      icon: () => null,
      label: () => "",
      preview: () => ({ title: "a", facts: [] }),
      search: async () => [option({ key: "media:a", sourceType: "media" })],
    };
    const bad: ContextSource = { ...good, type: "creation_world", group: "world", search: async () => { throw new Error("offline"); } };
    const result = await fanOutSearch([good, bad], ctx(runtime));
    assert.equal(result.options.length, 1);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0]?.sourceType, "creation_world");
    assert.equal(result.errors[0]?.timedOut, false);
  });

  it("honors allowedRefTypes trimming", async () => {
    const calls: string[] = [];
    const make = (type: string): ContextSource => ({
      type,
      attrs: [],
      identity: () => null,
      group: "media",
      titleKey: "x",
      insertMode: "inline",
      inlineInsertable: true,
      icon: () => null,
      label: () => "",
      preview: () => ({ title: type, facts: [] }),
      search: async () => {
        calls.push(type);
        return [];
      },
    });
    await fanOutSearch([make("media"), make("creation_world")], { ...ctx(runtime), allowedRefTypes: ["media"] });
    assert.deepEqual(calls, ["media"]);
  });
});
