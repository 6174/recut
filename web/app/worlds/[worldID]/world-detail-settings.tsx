/*
 * [INPUT]: 依赖统一 Entity 模型（attrs 自带 schema）、Worlds HTTP client、Input/Button/CustomSelect/PlatformMediaPicker 与当前 revision
 * [OUTPUT]: 对外提供基于 attrs 的通用设定编辑器 SettingDialog（name/intro/detail + 属性编辑列表，media 属性走素材选择器）、
 * attrs 驱动的卡片投影助手（非空文本条目 / 完整度 / 媒体值）；保存 = 单次 entities.upsert 携带 expectedRevisionId
 * [POS]: worlds/[worldID] 的表单边界；字段真相 = 实体 attrs（locked 属性锁 label/type、值可改），不再有 kind 硬编码字段定义
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Lock, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CustomSelect } from "@/components/ui/select-field";
import { PlatformMediaPicker } from "@/components/platform-media-picker";
import { useI18n } from "@/lib/i18n/index";
import { interpolate } from "@/lib/i18n/workspace-dict";
import {
  createRecutWorldsClient,
  type EntityAttr,
  type EntityAttrMediaValue,
  type EntityKind,
  type WorldEntity,
} from "@/lib/recut-worlds-client";

export type SettingSection = {
  kind: EntityKind;
  title: string;
  description: string;
  action: string;
};

const attrTypeLabels: Record<EntityAttr["type"], string> = {
  text: "文本",
  textarea: "长文本",
  number: "数字",
  boolean: "开关",
  select: "单选",
  media: "素材",
};

export function isMediaAttrValue(value: unknown): value is EntityAttrMediaValue {
  return typeof value === "object" && value !== null && typeof (value as EntityAttrMediaValue).assetId === "string";
}

// 卡片投影：非 media、值非空的文本属性条目（key → 可读文本）
export function contentEntries(entity: WorldEntity): Array<{ key: string; label: string; value: string }> {
  return (entity.attrs ?? [])
    .filter((attr) => attr.type !== "media" && !isMediaAttrValue(attr.value))
    .map((attr) => ({ key: attr.key, label: attr.label, value: attrValueText(attr.value) }))
    .filter((entry) => entry.value.trim().length > 0);
}

export function attrValueText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

export function mediaAttrs(entity: WorldEntity): Array<EntityAttr & { value: EntityAttrMediaValue }> {
  return (entity.attrs ?? []).filter(
    (attr): attr is EntityAttr & { value: EntityAttrMediaValue } => attr.type === "media" && isMediaAttrValue(attr.value),
  );
}

export function mediaAssetUrl(apiBase: string, assetId: string): string {
  return `${apiBase}/v1/media/assets/${encodeURIComponent(assetId)}/content`;
}

export function hasUsefulContent(entity: WorldEntity) {
  return contentEntries(entity).length > 0 || mediaAttrs(entity).length > 0;
}

// 完整度：非空属性数 / 属性总数（readiness 投影的轻量客户端近似）
export function attrsCompleteness(entity: WorldEntity): { filled: number; total: number } {
  const attrs = entity.attrs ?? [];
  const filled = attrs.filter((attr) => attr.type === "media" ? isMediaAttrValue(attr.value) : attrValueText(attr.value).trim().length > 0).length;
  return { filled, total: attrs.length };
}

export function SettingDialog({
  apiBase,
  entity,
  expectedRevisionID,
  typeId,
  worldID,
  onClose,
  onSaved,
}: {
  apiBase: string;
  entity: WorldEntity | null;
  expectedRevisionID: string;
  worldID: string;
  typeId: EntityKind;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(entity?.name ?? "");
  const [intro, setIntro] = useState(entity?.intro ?? "");
  const [detail, setDetail] = useState(entity?.detail ?? "");
  const [attrs, setAttrs] = useState<EntityAttr[]>(() => (entity?.attrs ?? []).map((attr) => ({ ...attr })));
  const [newAttrType, setNewAttrType] = useState<EntityAttr["type"]>("text");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const nameExample = typeId === "character"
    ? t("worlds.settings.dialog.name.example.character")
    : typeId === "story"
      ? t("worlds.settings.dialog.name.example.story")
      : t("worlds.settings.dialog.newSetting");

  function updateAttr(key: string, patch: Partial<EntityAttr>) {
    setAttrs((current) => current.map((attr) => (attr.key === key ? { ...attr, ...patch } : attr)));
  }
  function addAttr() {
    setAttrs((current) => [
      ...current,
      {
        key: `a_${Date.now()}${Math.floor(Math.random() * 1000)}`,
        label: attrTypeLabels[newAttrType],
        type: newAttrType,
        ...(newAttrType === "boolean" ? { value: false } : {}),
      },
    ]);
  }
  async function submit() {
    if (!name.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      await createRecutWorldsClient(apiBase).entities.upsert({
        worldId: worldID,
        entityId: entity?.id,
        ...(entity ? {} : { typeId }),
        name: name.trim(),
        intro: intro.trim(),
        detail,
        attrs,
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
              {entity ? t("worlds.settings.dialog.title.edit").replace("{title}", "") : t("worlds.create.newEntity")}
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
              onChange={(event) => setName(event.target.value)}
              placeholder={interpolate(t("worlds.settings.dialog.name.placeholder"), { example: nameExample })}
              value={name}
            />
          </label>
          <label className="text-xs font-medium" htmlFor="setting-intro">
            {t("worlds.settings.dialog.summary")}
            <Input
              className="mt-1 h-9 bg-background"
              id="setting-intro"
              onChange={(event) => setIntro(event.target.value)}
              placeholder={t("worlds.settings.dialog.summary.placeholder")}
              value={intro}
            />
          </label>
          <label className="text-xs font-medium" htmlFor="setting-detail">
            {t("worlds.settings.field.body.label")}
            <textarea
              className="mt-1 min-h-24 w-full rounded-sm border bg-background px-2.5 py-2 text-xs leading-5 focus-visible:ring-2 focus-visible:ring-ring/30"
              id="setting-detail"
              onChange={(event) => setDetail(event.target.value)}
              value={detail}
            />
          </label>
          <div className="space-y-3">
            <p className="text-xs font-semibold">属性</p>
            {attrs.map((attr) => (
              <AttrEditor
                apiBase={apiBase}
                attr={attr}
                key={attr.key}
                onChange={(patch) => updateAttr(attr.key, patch)}
                onRemove={() => setAttrs((current) => current.filter((candidate) => candidate.key !== attr.key))}
              />
            ))}
            <div className="flex items-end gap-2">
              <CustomSelect
                id="setting-attr-new-type"
                label="添加属性"
                onChange={(value) => setNewAttrType(value as EntityAttr["type"])}
                options={(Object.keys(attrTypeLabels) as EntityAttr["type"][]).map((type) => ({ label: attrTypeLabels[type], value: type }))}
                value={newAttrType}
              />
              <Button className="shrink-0" onClick={addAttr} type="button" variant="outline">
                <Plus className="size-3.5" />
                {"添加属性"}
              </Button>
            </div>
          </div>
          {error && <p className="text-xs text-warning">{error}</p>}
        </div>
        <footer className="flex items-center justify-end gap-2 border-t px-5 py-3">
          <Button onClick={onClose} type="button" variant="ghost">
            {t("worlds.settings.dialog.cancel")}
          </Button>
          <Button
            disabled={!name.trim() || saving}
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

function AttrEditor({
  apiBase,
  attr,
  onChange,
  onRemove,
}: {
  apiBase: string;
  attr: EntityAttr;
  onChange: (patch: Partial<EntityAttr>) => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const [pickerOpen, setPickerOpen] = useState(false);
  const locked = Boolean(attr.locked);
  const label = (
    <span className="flex items-center gap-1 text-xs font-medium">
      {locked && <Lock aria-label="预设属性：结构与标签由类型锁定，仅可修改值" className="size-3 text-muted-foreground" />}
      <input
        className="w-full rounded-xs bg-transparent px-1 py-0.5 focus-visible:ring-2 focus-visible:ring-ring/30 disabled:text-muted-foreground"
        disabled={locked}
        onChange={(event) => onChange({ label: event.target.value })}
        placeholder="属性标签"
        value={attr.label}
      />
    </span>
  );
  return (
    <div className="rounded-sm border p-3">
      <div className="flex items-center justify-between gap-2">
        {label}
        {!locked && (
          <button
            aria-label="移除属性"
            className="grid size-6 shrink-0 place-items-center rounded-xs text-muted-foreground hover:text-destructive"
            onClick={onRemove}
            type="button"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>
      <div className="mt-2">
        <AttrValueInput apiBase={apiBase} attr={attr} onChange={(value) => onChange({ value })} pickerOpen={pickerOpen} setPickerOpen={setPickerOpen} />
      </div>
    </div>
  );
}

function AttrValueInput({
  apiBase,
  attr,
  onChange,
  pickerOpen,
  setPickerOpen,
}: {
  apiBase: string;
  attr: EntityAttr;
  onChange: (value: unknown) => void;
  pickerOpen: boolean;
  setPickerOpen: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const id = `setting-attr-${attr.key}`;
  if (attr.type === "boolean")
    return (
      <button
        aria-pressed={Boolean(attr.value)}
        className={`rounded-sm border px-2 py-1 text-xs ${attr.value ? "border-primary/40 bg-primary/10 text-primary" : "bg-background text-muted-foreground"}`}
        onClick={() => onChange(!attr.value)}
        type="button"
      >
        {attr.value ? "开" : "关"}
      </button>
    );
  if (attr.type === "select" && attr.options?.length)
    return (
      <CustomSelect
        id={id}
        label="取值"
        onChange={(value) => onChange(value)}
        options={attr.options.map((option) => ({ label: option, value: option }))}
        value={typeof attr.value === "string" ? attr.value : ""}
      />
    );
  if (attr.type === "number")
    return (
      <Input
        className="h-9 bg-background"
        id={id}
        inputMode="decimal"
        onChange={(event) => {
          const parsed = Number(event.target.value);
          onChange(event.target.value === "" || Number.isNaN(parsed) ? event.target.value : parsed);
        }}
        value={attrValueText(attr.value)}
      />
    );
  if (attr.type === "textarea")
    return (
      <textarea
        className="min-h-20 w-full rounded-sm border bg-background px-2.5 py-2 text-xs leading-5 focus-visible:ring-2 focus-visible:ring-ring/30"
        id={id}
        onChange={(event) => onChange(event.target.value)}
        value={attrValueText(attr.value)}
      />
    );
  if (attr.type === "media") {
    const media = isMediaAttrValue(attr.value) ? attr.value : null;
    return (
      <div className="flex items-center gap-2">
        {media && media.kind !== "audio" && media.kind !== "video" ? (
          <img alt={media.name ?? ""} className="size-10 rounded-xs border object-cover" src={mediaAssetUrl(apiBase, media.assetId)} />
        ) : null}
        <Button className="flex-1 justify-start" onClick={() => setPickerOpen(true)} type="button" variant="outline">
          {media ? media.name || media.assetId : t("worlds.entity.manager.choose.placeholder")}
        </Button>
        {media && (
          <button
            aria-label="移除属性"
            className="grid size-8 shrink-0 place-items-center rounded-xs text-muted-foreground hover:text-destructive"
            onClick={() => onChange(null)}
            type="button"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
        <PlatformMediaPicker
          apiBase={apiBase}
          onCancel={() => setPickerOpen(false)}
          onPick={(selection) => {
            const asset = Array.isArray(selection) ? selection[0] : selection;
            if (!asset) return;
            onChange({ assetId: asset.id, name: asset.name, kind: asset.kind });
            setPickerOpen(false);
          }}
          request={pickerOpen ? { kinds: ["image", "video", "audio"] } : null}
        />
      </div>
    );
  }
  return (
    <Input
      className="h-9 bg-background"
      id={id}
      onChange={(event) => onChange(event.target.value)}
      value={attrValueText(attr.value)}
    />
  );
}

