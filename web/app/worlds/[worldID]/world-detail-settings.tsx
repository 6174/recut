/*
 * [INPUT]: 依赖 World Entity 类型、Worlds HTTP client、Input/Button 原子与当前 revision
 * [OUTPUT]: 对外提供创作设定分类、内容字段定义、内容完整度判断和 SettingDialog 类型化编辑器
 * [POS]: worlds/[worldID] 的表单边界；把底层 content 结构转译为创作者填写的领域字段，保存必须携带 expectedRevisionId
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CustomSelect } from "@/components/ui/select-field";
import { ObjectEvidencePanel } from "./world-detail-panels";
import {
  createRecutWorldsClient,
  type EntityKind,
  type WorldEntity,
} from "@/lib/recut-worlds-client";

type SettingField = {
  key: string;
  label: string;
  placeholder: string;
  multiline?: boolean;
  options?: Array<{ label: string; value: string }>;
};
export type SettingSection = {
  kind: EntityKind;
  title: string;
  description: string;
  action: string;
};

export const SETTING_SECTIONS: SettingSection[] = [
  {
    kind: "character",
    title: "角色",
    description: "人物是谁、如何呈现、哪些特征不能改变。",
    action: "添加角色",
  },
  {
    kind: "story",
    title: "故事",
    description: "这次想讲什么，以及它如何发生。",
    action: "添加故事",
  },
  {
    kind: "style",
    title: "风格",
    description: "画面、文字、声音与节奏的共同语言。",
    action: "添加风格",
  },
  {
    kind: "rule",
    title: "创作规则",
    description: "告诉 AI 什么必须坚持、避免或尽量做到。",
    action: "添加规则",
  },
  {
    kind: "location",
    title: "场景",
    description: "故事发生在哪里，有怎样的氛围与细节。",
    action: "添加场景",
  },
];

const fields: Record<EntityKind, SettingField[]> = {
  character: [
    {
      key: "appearance",
      label: "外貌与标志",
      placeholder: "例如：黑色短发，右侧有一枚银色耳钉",
      multiline: true,
    },
    {
      key: "personality",
      label: "性格与行为",
      placeholder: "例如：克制、好奇，说话前总会停顿半秒",
      multiline: true,
    },
    {
      key: "voice",
      label: "声音与说话方式",
      placeholder: "例如：低沉、语速平稳，偶尔带轻微笑意",
      multiline: true,
    },
    {
      key: "invariants",
      label: "不可改变的特征",
      placeholder: "例如：任何画面都保留耳钉；不能显得轻浮",
      multiline: true,
    },
  ],
  story: [
    {
      key: "premise",
      label: "这次想讲什么",
      placeholder: "用一两句话说清故事核心",
      multiline: true,
    },
    {
      key: "moment",
      label: "关键时刻",
      placeholder: "冲突、转折或最希望观众记住的画面",
      multiline: true,
    },
    {
      key: "emotion",
      label: "希望留下的感受",
      placeholder: "例如：温柔、紧张、释然",
    },
  ],
  style: [
    {
      key: "visual",
      label: "画面风格",
      placeholder: "色彩、光线、构图与材质",
      multiline: true,
    },
    {
      key: "guidance",
      label: "表达方式",
      placeholder: "文字、镜头、节奏与声音的偏好",
      multiline: true,
    },
    {
      key: "avoid",
      label: "避免什么",
      placeholder: "例如：避免过度饱和、夸张转场",
      multiline: true,
    },
  ],
  rule: [
    {
      key: "type",
      label: "规则强度",
      placeholder: "",
      options: [
        { value: "always", label: "必须坚持" },
        { value: "never", label: "不要出现" },
        { value: "prefer", label: "尽量做到" },
      ],
    },
    {
      key: "text",
      label: "规则内容",
      placeholder: "例如：主角始终保持克制的表达",
      multiline: true,
    },
  ],
  location: [
    {
      key: "description",
      label: "地点与细节",
      placeholder: "空间、时间、可见元素与氛围",
      multiline: true,
    },
    {
      key: "atmosphere",
      label: "氛围",
      placeholder: "例如：雨后、潮湿、安静但并不冷清",
    },
  ],
  reference: [],
};

const labels = Object.fromEntries(
  Object.values(fields)
    .flat()
    .map((field) => [field.key, field.label]),
);

export function settingSection(kind: EntityKind) {
  return SETTING_SECTIONS.find((item) => item.kind === kind);
}
export function contentEntries(entity: WorldEntity) {
  return Object.entries(entity.content ?? {})
    .filter(
      ([key, value]) =>
        key !== "type" && typeof value === "string" && value.trim(),
    )
    .slice(0, 3) as Array<[string, string]>;
}
export function hasUsefulContent(entity: WorldEntity) {
  return contentEntries(entity).length > 0;
}
export function fieldLabel(key: string) {
  return labels[key] ?? key;
}

export function SettingDialog({
  apiBase,
  entity,
  expectedRevisionID,
  kind,
  worldID,
  onClose,
  onEvidenceChanged,
  onSaved,
}: {
  apiBase: string;
  entity: WorldEntity | null;
  expectedRevisionID: string;
  worldID: string;
  kind: EntityKind;
  onClose: () => void;
  onEvidenceChanged: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(entity?.title ?? "");
  const [summary, setSummary] = useState(entity?.summary ?? "");
  const [content, setContent] = useState<Record<string, unknown>>(() => ({
    ...(kind === "rule" ? { type: "always", text: "" } : {}),
    ...(entity?.content ?? {}),
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const section = settingSection(kind);
  async function submit() {
    if (!title.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      await createRecutWorldsClient(apiBase).entities.upsert({
        worldId: worldID,
        entityId: entity?.id,
        kind,
        title: title.trim(),
        summary: summary.trim(),
        content,
        expectedRevisionId: expectedRevisionID,
      });
      onSaved();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "保存失败；如果设定刚被其他人更新，请刷新后重试。",
      );
      setSaving(false);
    }
  }
  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-6 backdrop-blur-[1px]"
      onMouseDown={onClose}
      role="dialog"
      aria-labelledby="setting-dialog-title"
    >
      <section
        className="flex max-h-[min(760px,calc(100vh-3rem))] w-full max-w-xl flex-col overflow-hidden rounded-md border bg-card shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b px-5 py-4">
          <div>
            <p className="text-xs font-medium text-primary">创作设定</p>
            <h2
              className="mt-1 text-lg font-semibold"
              id="setting-dialog-title"
            >
              {entity ? `编辑${section?.title}` : section?.action}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              写下具体细节，AI 会在之后的创作中稳定地使用它们。
            </p>
          </div>
          <button
            aria-label="关闭设定编辑"
            className="grid size-8 place-items-center rounded-xs text-muted-foreground hover:bg-muted"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </header>
        <div className="grid flex-1 gap-4 overflow-y-auto p-5">
          <label className="text-xs font-medium" htmlFor="setting-title">
            名称
            <Input
              autoFocus
              className="mt-1 h-9 bg-background"
              id="setting-title"
              onChange={(event) => setTitle(event.target.value)}
              placeholder={`例如：${kind === "character" ? "小满" : kind === "story" ? "雨后的见面" : (section?.title ?? "新的设定")}`}
              value={title}
            />
          </label>
          <label className="text-xs font-medium" htmlFor="setting-summary">
            一句话说明
            <Input
              className="mt-1 h-9 bg-background"
              id="setting-summary"
              onChange={(event) => setSummary(event.target.value)}
              placeholder="帮助你和 AI 快速理解这项设定"
              value={summary}
            />
          </label>
          {fields[kind].map((field) => (
            <FieldInput
              field={field}
              key={field.key}
              onChange={(value) =>
                setContent((current) => ({ ...current, [field.key]: value }))
              }
              value={stringContent(content[field.key])}
            />
          ))}
          {entity && (
            <ObjectEvidencePanel
              apiBase={apiBase}
              entity={entity}
              expectedRevisionID={expectedRevisionID}
              onChanged={onEvidenceChanged}
              worldID={worldID}
            />
          )}
          {error && <p className="text-xs text-warning">{error}</p>}
        </div>
        <footer className="flex items-center justify-end gap-2 border-t px-5 py-3">
          <Button onClick={onClose} type="button" variant="ghost">
            取消
          </Button>
          <Button
            disabled={!title.trim() || saving}
            onClick={() => void submit()}
            type="button"
          >
            {saving ? "正在保存…" : "保存设定"}
          </Button>
        </footer>
      </section>
    </div>
  );
}

function FieldInput({
  field,
  onChange,
  value,
}: {
  field: SettingField;
  onChange: (value: string) => void;
  value: string;
}) {
  const id = `setting-${field.key}`;
  if (field.options)
    return (
      <CustomSelect
        id={id}
        label={field.label}
        onChange={onChange}
        options={field.options}
        value={value}
      />
    );
  return (
    <label className="text-xs font-medium" htmlFor={id}>
      {field.label}
      {field.multiline ? (
        <textarea
          className="mt-1 min-h-24 w-full rounded-sm border bg-background px-2.5 py-2 text-xs leading-5 focus-visible:ring-2 focus-visible:ring-ring/30"
          id={id}
          onChange={(event) => onChange(event.target.value)}
          placeholder={field.placeholder}
          value={value}
        />
      ) : (
        <Input
          className="mt-1 h-9 bg-background"
          id={id}
          onChange={(event) => onChange(event.target.value)}
          placeholder={field.placeholder}
          value={value}
        />
      )}
    </label>
  );
}

function stringContent(value: unknown) {
  return typeof value === "string" ? value : "";
}
