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
import { useI18n } from "@/lib/i18n/index";
import { interpolate } from "@/lib/i18n/workspace-dict";
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
type FieldDefinition = Omit<SettingField, "label" | "placeholder" | "options"> & {
  options?: Array<{ value: string }>;
};
export type SettingSection = {
  kind: EntityKind;
  title: string;
  description: string;
  action: string;
};

const fieldDefinitions: Record<EntityKind, FieldDefinition[]> = {
  character: [
    { key: "appearance", multiline: true },
    { key: "personality", multiline: true },
    { key: "voice", multiline: true },
    { key: "invariants", multiline: true },
  ],
  story: [
    { key: "premise", multiline: true },
    { key: "moment", multiline: true },
    { key: "emotion" },
  ],
  style: [
    { key: "visual", multiline: true },
    { key: "guidance", multiline: true },
    { key: "avoid", multiline: true },
  ],
  rule: [
    { key: "type", options: [{ value: "always" }, { value: "never" }, { value: "prefer" }] },
    { key: "text", multiline: true },
  ],
  location: [
    { key: "description", multiline: true },
    { key: "atmosphere" },
  ],
  reference: [],
};

export function settingSections(t: (key: string) => string): SettingSection[] {
  return [
    {
      kind: "character",
      title: t("worlds.settings.character.title"),
      description: t("worlds.settings.character.desc"),
      action: t("worlds.settings.character.action"),
    },
    {
      kind: "story",
      title: t("worlds.settings.story.title"),
      description: t("worlds.settings.story.desc"),
      action: t("worlds.settings.story.action"),
    },
    {
      kind: "style",
      title: t("worlds.settings.style.title"),
      description: t("worlds.settings.style.desc"),
      action: t("worlds.settings.style.action"),
    },
    {
      kind: "rule",
      title: t("worlds.settings.rule.title"),
      description: t("worlds.settings.rule.desc"),
      action: t("worlds.settings.rule.action"),
    },
    {
      kind: "location",
      title: t("worlds.settings.location.title"),
      description: t("worlds.settings.location.desc"),
      action: t("worlds.settings.location.action"),
    },
  ];
}

export function fieldsFor(kind: EntityKind, t: (key: string) => string): SettingField[] {
  return fieldDefinitions[kind].map((def) => {
    const base = `worlds.settings.field.${def.key}`;
    return {
      ...def,
      label: t(`${base}.label`),
      placeholder: t(`${base}.placeholder`),
      options: def.options?.map((option) => ({ value: option.value, label: t(`${base}.option.${option.value}`) })),
    };
  });
}

export function settingSection(kind: EntityKind, t: (key: string) => string) {
  return settingSections(t).find((item) => item.kind === kind);
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
export function fieldLabel(key: string, t: (k: string) => string) {
  return t(`worlds.settings.field.${key}.label`);
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
  const { t } = useI18n();
  const [title, setTitle] = useState(entity?.title ?? "");
  const [summary, setSummary] = useState(entity?.summary ?? "");
  const [content, setContent] = useState<Record<string, unknown>>(() => ({
    ...(kind === "rule" ? { type: "always", text: "" } : {}),
    ...(entity?.content ?? {}),
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const section = settingSection(kind, t);
  const nameExample =
    kind === "character"
      ? t("worlds.settings.dialog.name.example.character")
      : kind === "story"
        ? t("worlds.settings.dialog.name.example.story")
        : (section?.title ?? t("worlds.settings.dialog.newSetting"));
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
          : t("worlds.settings.dialog.save.failed"),
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
            <p className="text-xs font-medium text-primary">{t("worlds.settings.dialog.eyebrow")}</p>
            <h2
              className="mt-1 text-lg font-semibold"
              id="setting-dialog-title"
            >
              {entity ? interpolate(t("worlds.settings.dialog.title.edit"), { title: section?.title ?? "" }) : section?.action}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("worlds.settings.dialog.desc")}
            </p>
          </div>
          <button
            aria-label={t("worlds.settings.dialog.close.aria")}
            className="grid size-8 place-items-center rounded-xs text-muted-foreground hover:bg-muted"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </header>
        <div className="grid flex-1 gap-4 overflow-y-auto p-5">
          <label className="text-xs font-medium" htmlFor="setting-title">
            {t("worlds.settings.dialog.name")}
            <Input
              autoFocus
              className="mt-1 h-9 bg-background"
              id="setting-title"
              onChange={(event) => setTitle(event.target.value)}
              placeholder={interpolate(t("worlds.settings.dialog.name.placeholder"), { example: nameExample })}
              value={title}
            />
          </label>
          <label className="text-xs font-medium" htmlFor="setting-summary">
            {t("worlds.settings.dialog.summary")}
            <Input
              className="mt-1 h-9 bg-background"
              id="setting-summary"
              onChange={(event) => setSummary(event.target.value)}
              placeholder={t("worlds.settings.dialog.summary.placeholder")}
              value={summary}
            />
          </label>
          {fieldsFor(kind, t).map((field) => (
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
            {t("worlds.settings.dialog.cancel")}
          </Button>
          <Button
            disabled={!title.trim() || saving}
            onClick={() => void submit()}
            type="button"
          >
            {saving ? t("worlds.settings.dialog.saving") : t("worlds.settings.dialog.save")}
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
