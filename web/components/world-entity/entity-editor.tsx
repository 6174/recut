/*
 * [INPUT]: 依赖 react、recut-worlds-client 类型（EntityAttr/WorldEntityTypeField/WorldRelationType）、
 * world-entity/field-row
 * [OUTPUT]: 共享 EntityEditor（RFC 统一 Entity 模型 P1/P2「一套编辑器，两个宿主」）：身份区
 * （名称/简介/正文 FieldRow 即改即存）、字段区（type schema 字段 + schema 外属性直接续排同一渲染路径——媒体
 * 属性与普通属性同一条渲染路径，不再有独立「参考素材」网格 + ＋添加属性（文本/长文本/数字/开关/
 * 素材（图片/视频/音频），通用「素材」选项已移除，媒体拍平经 options 携 kind）+ ＋添加字段（宿主
 * 接类型级对话框））、关系区（双向列表 + 受控词表内联建立）；useEntityEditorSaver（统一保存器：
 * attrs 全量替换语义的局部 patch，revision 冲突 → 刷新 revision → 重试一次）
 * [POS]: web/components/world-entity 的统一编辑容器；不依赖 store，画布与设定视图注入各自的动作
 * （saveField/rename/createRelation 等宿主钩子）；实体媒体唯一表示 = media attrs（卡面图源 =
 * 遍历 media attrs 的投影，无 property 以外的素材结构）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { createRecutWorldsClient, type EntityAttr, type EntityKind, type EntityTypeField, type WorldEntity, type WorldRelationType } from "@/lib/recut-worlds-client";
import { AssetFieldRow, FieldRow, parseAssetValue } from "./field-row";

// 统一保存 patch（与画布 saveEntityField 同语义；attrKey 不存在时宿主负责新建该 attr）
export type EntitySavePatch = {
  name?: string;
  intro?: string;
  detail?: string;
  attrKey?: string;
  attrLabel?: string;
  attrType?: EntityAttr["type"];
  attrOptions?: string[];
  value?: unknown;
};

// 关系列表的统一投影：双向语义，out = 我指向对方
export type RelationItem = { id: string; type: string; otherId: string; out: boolean; scoped: boolean };

export function entityAttrListOf(entity: WorldEntity | null): EntityAttr[] {
  return entity?.attrs ?? [];
}

export function entityAttrValueOf(entity: WorldEntity | null, key: string): unknown {
  return entity?.attrs?.find((attr) => attr.key === key)?.value;
}

export function entityAttrTextOf(entity: WorldEntity | null, key: string): string {
  const value = entityAttrValueOf(entity, key);
  if (value == null) return "";
  if (typeof value === "object") return "";
  return String(value);
}

// 面板通用折叠 section：标题行带 +/− 开关，收起后隐藏内容但保留 action 入口
export function Section({ title, action, children, defaultOpen = true }: { title: ReactNode; action?: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t pt-3">
      <div className="flex items-center justify-between">
        <button className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground" onClick={() => setOpen(!open)} type="button">
          <span aria-hidden className="grid size-4 shrink-0 place-items-center rounded border text-[10px] leading-none">{open ? "−" : "+"}</span>
          {title}
        </button>
        {action}
      </div>
      {open && <div className="mt-2 space-y-3">{children}</div>}
    </div>
  );
}

// 「添加属性」类型选项：通用「素材」移除，媒体拍平为 素材（图片/视频/音频）（与 AddFieldDialog 同约定）
const ADD_ATTR_OPTIONS = [
  { label: "文本", type: "text" as const, kind: "", nameNote: "文本" },
  { label: "长文本", type: "textarea" as const, kind: "", nameNote: "长文本" },
  { label: "数字", type: "number" as const, kind: "", nameNote: "数字" },
  { label: "开关", type: "boolean" as const, kind: "", nameNote: "开关" },
  { label: "素材（图片）", type: "media" as const, kind: "image", nameNote: "素材（图片）" },
  { label: "素材（视频）", type: "media" as const, kind: "video", nameNote: "素材（视频）" },
  { label: "素材（音频）", type: "media" as const, kind: "audio", nameNote: "素材（音频）" },
] as const;

export function EntityEditor({
  apiBase,
  typeLabel,
  entity,
  onRenameField,
  fields = [],
  entityTypes,
  relationTypes = [],
  candidates = [],
  relations = [],
  readOnly = false,
  saveField,
  onAddTypeField,
  onCreateRelation,
  tail,
}: {
  apiBase: string;
  /** 当前实体类型文案（type 目录 name，目录缺失回退 entityKindLabel） */
  typeLabel: string;
  /** 编辑中的实体；null = 新建态（ name 首次提交即创建，宿主 saver 负责落地与回传） */
  entity: WorldEntity | null;
  /** 名称保存钩子：画布走 renameEntity（元素投影同步）；缺省 = saveField({name}) */
  onRenameField?: (value: string) => Promise<void> | void;
  /** 当前类型的 schema 字段（locked 预制字段） */
  fields?: EntityTypeField[];
  entityTypes: { id: string; name: string }[];
  /** 关系受控词表；非空且 onCreateRelation 注入时显示「建立关系」 */
  relationTypes?: WorldRelationType[];
  candidates?: Array<{ id: string; name: string; typeId: string }>;
  /** 已有关系（双向投影：out=false 表示 ← 对方指向我） */
  relations?: Array<RelationItem>;
  readOnly?: boolean;
  /** 统一保存器：局部 patch → 宿主按 attrs 全量替换语义 upsert */
  saveField: (patch: EntitySavePatch) => Promise<void>;
  /** 类型级「添加字段」对话框（宿主实现；设定视图可不接） */
  onAddTypeField?: () => void;
  onCreateRelation?: (toEntityId: string, relationType: string) => Promise<void> | void;
  /** 宿主自定义的尾部区域（草稿徽标/子设定等置于编辑器之后） */
  tail?: ReactNode;
}) {
  const schemaKeys = new Set(fields.map((field) => field.key));
  // schema 外属性：无独立分区、无「其他」容器语义，直接续排在字段列表（动态属性与 schema 字段同一渲染路径）
  const extraAttrs = entityAttrListOf(entity).filter((attr) => !schemaKeys.has(attr.key));
  const [pickRelationTarget, setPickRelationTarget] = useState(false);
  const [pendingTargetId, setPendingTargetId] = useState<string | null>(null);
  const [relationQuery, setRelationQuery] = useState("");

  return (
    <div className="space-y-4 text-sm">
      {/* 名称：与其他字段同一编辑原语（点击进入编辑，blur/⌘↵ 或 Enter 保存） */}
      <FieldRow
        label={typeLabel}
        value={entity?.name ?? ""}
        onSave={(value) => (onRenameField ? onRenameField(String(value)) : saveField({ name: String(value) }))}
        readOnly={readOnly}
      />

      {/* 简介 → 正文（detail）：固定顺序，detail 为一等字段 */}
      <FieldRow label="简介" multiline value={entity?.intro ?? ""} placeholder="一句话简介…" onSave={(value) => saveField({ intro: String(value) })} />
      <FieldRow label="正文" multiline placeholder="详细内容…" value={entity?.detail ?? ""} onSave={(value) => saveField({ detail: String(value) })} />

      {/* 字段（type schema + schema 外动态属性 + ＋添加属性 / ＋添加字段） */}
      <Section
        title={`字段（${fields.length}）`}
        action={!readOnly && onAddTypeField ? (
          <button className="text-[10px] text-primary hover:underline" onClick={onAddTypeField} type="button">
            ＋ 添加字段
          </button>
        ) : undefined}
      >
        {fields.map((field) => {
          if (field.type === "media") {
            const kinds = (field.options ?? []).filter((option): option is "image" | "video" | "audio" => option === "image" || option === "video" || option === "audio");
            return (
              <AssetFieldRow
                apiBase={apiBase}
                key={field.key}
                kinds={kinds.length ? kinds : undefined}
                label={field.label ?? field.key}
                onSave={(value) => saveField({ attrKey: field.key, attrType: "media", value })}
                readOnly={readOnly}
                value={entityAttrValueOf(entity, field.key)}
              />
            );
          }
          if (field.type === "boolean") {
            return (
              <FieldRow
                boolean
                key={field.key}
                label={field.label ?? field.key}
                readOnly={readOnly}
                onSave={(value) => saveField({ attrKey: field.key, value: value === "true" })}
                value={entityAttrValueOf(entity, field.key) === true ? "true" : "false"}
              />
            );
          }
          return (
            <FieldRow
              key={field.key}
              label={field.label ?? field.key}
              multiline={field.type !== "text" && field.type !== "number"}
              placeholder={field.placeholder}
              readOnly={readOnly}
              onSave={(value) => saveField({ attrKey: field.key, value: field.type === "number" && value !== "" && !Number.isNaN(Number(value)) ? Number(value) : value })}
              value={entityAttrTextOf(entity, field.key)}
            />
          );
        })}
        {/* schema 外属性：无独立分区，直接续排在字段列表（属性同一真相，无需「其他」容器语义） */}
        {extraAttrs.map((attr) =>
          attr.type === "media" ? (
            <AssetFieldRow
              apiBase={apiBase}
              key={attr.key}
              label={attr.label ?? attr.key}
              onSave={(value) => saveField({ attrKey: attr.key, attrType: "media", value })}
              readOnly={readOnly}
              value={entityAttrValueOf(entity, attr.key)}
            />
          ) : (
            <FieldRow
              key={attr.key}
              label={attr.label ?? attr.key}
              value={entityAttrTextOf(entity, attr.key)}
              readOnly={readOnly}
              onSave={(value) => saveField({ attrKey: attr.key, value: attr.type === "number" && typeof value === "string" && value !== "" && !Number.isNaN(Number(value)) ? Number(value) : value })}
            />
          ),
        )}
        {!readOnly && <AddAttrRow disabled={!entity} onSave={saveField} />}
      </Section>

      {/* 关系（双向语义） */}
      <div className="border-t pt-3">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-medium text-muted-foreground">关系（{relations.length}）</p>
          {!readOnly && candidates.length > 0 && onCreateRelation && (
            <button className="text-[10px] text-primary hover:underline" onClick={() => setPickRelationTarget((open) => !open)} type="button">
              ＋ 建立关系…
            </button>
          )}
        </div>
        {pickRelationTarget ? (
          <div className="mt-1 max-h-40 space-y-1 overflow-y-auto">
            {candidates
              .filter((item) => item.id !== entity?.id)
              .map((item) => (
                <button
                  className="flex w-full items-center justify-between rounded bg-muted/50 px-2 py-1.5 text-left text-xs hover:bg-muted"
                  key={item.id}
                  onClick={() => {
                    setPendingTargetId(item.id);
                    setRelationQuery("");
                  }}
                  type="button"
                >
                  <span className="truncate">{item.name}</span>
                  <span className="text-muted-foreground">{entityTypes.find((type) => type.id === item.typeId)?.name ?? item.typeId}</span>
                </button>
              ))}
            <button className="w-full rounded px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted" onClick={() => { setPickRelationTarget(false); setPendingTargetId(null); }} type="button">
              取消
            </button>
          </div>
        ) : pendingTargetId && onCreateRelation ? (
          <RelationTypePicker
            onBack={() => setPendingTargetId(null)}
            onConfirm={(relationType) => {
              void (async () => {
                await onCreateRelation(pendingTargetId, relationType);
                setPendingTargetId(null);
              })();
            }}
            relationQuery={relationQuery}
            relationTypes={relationTypes}
            setRelationQuery={setRelationQuery}
            targetName={candidates.find((item) => item.id === pendingTargetId)?.name ?? ""}
          />
        ) : (
          <ul className="mt-1 space-y-1">
            {relations.map((relation) => (
              <li className="truncate rounded bg-muted/50 px-2 py-1.5 text-xs" key={relation.id}>
                {relation.out ? "→" : "←"} {relation.type} · {candidates.find((item) => item.id === relation.otherId)?.name ?? "…"}
                {relation.scoped ? " · 局部" : ""}
              </li>
            ))}
            {!relations.length && <li className="text-xs text-muted-foreground">暂无关系</li>}
          </ul>
        )}
      </div>

      {tail}
    </div>
  );
}

export function isWorldRevisionConflict(cause: unknown): boolean {
  return (cause as { code?: string } | null)?.code === "WORLD_REVISION_CONFLICT";
}

// 统一保存器（设定视图宿主等无 store 场景；画布继续走 canvas-store.saveEntityField）：
// 局部 patch → 取当前实体 full attrs 拷贝原位 patch 后整包 upsert；先按缓存 revision 执行，
// 冲突 → loadRevision 刷新 → 重试一次；任何一次写后 revision 缓存失效（写路径推进 revision）。
// 新建态（entity=null）：首个 patch 即创建实体（name 必填，否则拒绝以便先填名称）。
export function useEntityEditorSaver(input: {
  apiBase: string;
  worldId: string;
  typeId: string;
  getEntity: () => WorldEntity | null;
  loadRevision: () => Promise<string>;
  onSaved: (saved: WorldEntity) => void;
  onError?: (message: string) => void;
}) {
  const hostRef = useRef(input);
  hostRef.current = input;
  const revisionRef = useRef<string | null>(null);
  const saveField = useCallback(async (patch: EntitySavePatch) => {
    const current = hostRef.current;
    const client = createRecutWorldsClient(current.apiBase);
    const buildAttrs = () => {
      const base = current.getEntity();
      const attrs: EntityAttr[] = (base?.attrs ?? []).map((attr) => ({ ...attr }));
      if (patch.attrKey !== undefined) {
        const index = attrs.findIndex((attr) => attr.key === patch.attrKey);
        if (index >= 0) attrs[index] = { ...attrs[index], value: patch.value };
        else
          attrs.push({
            key: patch.attrKey,
            label: patch.attrLabel ?? patch.attrKey,
            type: patch.attrType ?? "text",
            ...(patch.attrOptions?.length ? { options: [...patch.attrOptions] } : {}),
            ...(patch.value !== undefined ? { value: patch.value } : {}),
          });
      }
      return attrs;
    };
    if (!current.getEntity() && !(patch.name ?? "").trim()) {
      const message = "请先填写名称完成创建";
      current.onError?.(message);
      throw new Error(message);
    }
    const run = async () => {
      const base = current.getEntity();
      const name = patch.name !== undefined ? patch.name : (base?.name ?? "");
      if (!revisionRef.current) revisionRef.current = await current.loadRevision();
      return client.entities.upsert({
        worldId: current.worldId,
        entityId: base?.id,
        ...(base ? {} : { typeId: current.typeId as EntityKind }),
        name,
        intro: patch.intro !== undefined ? patch.intro : (base?.intro ?? ""),
        detail: patch.detail !== undefined ? patch.detail : (base?.detail ?? ""),
        attrs: buildAttrs(),
        expectedRevisionId: revisionRef.current!,
      });
    };
    try {
      const saved = await run().catch(async (cause) => {
        if (!isWorldRevisionConflict(cause)) throw cause;
        revisionRef.current = null;
        return run();
      });
      revisionRef.current = null;
      current.onSaved(saved);
    } catch (cause) {
      revisionRef.current = null;
      current.onError?.(cause instanceof Error ? cause.message : "保存失败，请重试");
      throw cause;
    }
  }, []);
  // 其他语义写（关系/删除实体）取共享 revision 缓存；写后必须 invalidateRevision
  const revision = useCallback(async () => {
    if (!revisionRef.current) revisionRef.current = await hostRef.current.loadRevision();
    return revisionRef.current!;
  }, []);
  const invalidateRevision = useCallback(() => {
    revisionRef.current = null;
  }, []);
  return { saveField, revision, invalidateRevision };
}

// 建立关系第二步：受控词表（推荐 TopN + 搜索 + 自定义类型），确认→ onCreateRelation
function RelationTypePicker({
  relationTypes,
  relationQuery,
  setRelationQuery,
  onConfirm,
  onBack,
  targetName,
}: {
  relationTypes: WorldRelationType[];
  relationQuery: string;
  setRelationQuery: (value: string) => void;
  onConfirm: (relationType: string) => void;
  onBack: () => void;
  targetName: string;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  const [customType, setCustomType] = useState("");
  const query = relationQuery.trim();
  const filtered = relationTypes.filter((item) => !query || item.labelZh.includes(query) || item.id.includes(query));
  const groups = new Map<string, WorldRelationType[]>();
  for (const item of filtered) {
    const list = groups.get(item.group) ?? [];
    list.push(item);
    groups.set(item.group, list);
  }
  const groupLabels: Record<string, string> = { people: "人际", world: "世界", story: "故事", video: "视频" };
  return (
    <div className="mt-1 max-h-64 space-y-2 overflow-y-auto rounded-md border bg-background/60 p-2">
      <p className="text-[11px] text-muted-foreground">选择与「{targetName}」的关系类型（双向语义，A 是 B 的 ___）</p>
      <input
        className="w-full rounded-md border bg-background p-1.5 text-xs outline-none focus:border-primary"
        onChange={(event) => setRelationQuery(event.target.value)}
        placeholder="搜索关系类型…"
        value={relationQuery}
      />
      <div className="space-y-2">
        {[...groups.entries()].map(([group, items]) => (
          <div key={group}>
            <p className="text-[10px] text-muted-foreground">{groupLabels[group] ?? group}</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {items.map((item) => (
                <button className="rounded-md border px-2 py-1 text-xs hover:bg-muted" key={item.id} onClick={() => onConfirm(item.id)} type="button">
                  {item.labelZh}
                </button>
              ))}
            </div>
          </div>
        ))}
        {!filtered.length && <p className="text-xs text-muted-foreground">没有匹配的关系类型</p>}
      </div>
      {customOpen ? (
        <div className="flex gap-1.5">
          <input
            autoFocus
            className="min-w-0 flex-1 rounded-md border bg-background p-1.5 text-xs outline-none focus:border-primary"
            onChange={(event) => setCustomType(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && customType.trim()) onConfirm(customType.trim());
            }}
            placeholder="自定义关系类型（如：师徒）"
            value={customType}
          />
          <button className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground" onClick={() => customType.trim() && onConfirm(customType.trim())} type="button">
            建立
          </button>
        </div>
      ) : (
        <button className="text-xs text-primary hover:underline" onClick={() => setCustomOpen(true)} type="button">
          ＋ 新建关系类型
        </button>
      )}
      <button className="w-full rounded px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted" onClick={onBack} type="button">
        返回
      </button>
    </div>
  );
}

// 添加属性（实例级自定义 attr）：类型选择 + 保存一条新 attr（key 生成 a_xxxx；label = 类型文案）
function AddAttrRow({ onSave, disabled }: { onSave: (patch: EntitySavePatch) => Promise<void>; disabled?: boolean }) {
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  if (disabled) return null;
  if (!choosing)
    return (
      <div>
        <button className="grid h-9 w-full place-items-center rounded-md border border-dashed text-[11px] text-muted-foreground hover:border-primary hover:text-foreground" onClick={() => setChoosing(true)} type="button">
          ＋ 添加属性
        </button>
      </div>
    );
  return (
    <div className="flex items-end gap-2 rounded-md border bg-background/60 p-2">
      <select
        className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs"
        onChange={(event) => {
          const value = event.target.value as typeof ADD_ATTR_OPTIONS[number]["label"];
          const option = ADD_ATTR_OPTIONS.find((item) => item.label === value);
          if (!option) return;
          setBusy(true);
          setChoosing(false);
          void onSave({
            attrKey: `a_${Date.now()}${Math.floor(Math.random() * 1000)}`,
            attrLabel: option.nameNote,
            attrType: option.type,
            ...(option.kind ? { attrOptions: [option.kind] } : {}),
            ...(option.type === "boolean" ? { value: false } : {}),
          }).finally(() => setBusy(false));
        }}
        defaultValue=""
        disabled={busy}
      >
        <option disabled value="">选择属性类型…</option>
        {ADD_ATTR_OPTIONS.map((option) => (
          <option key={option.label} value={option.label}>
            {option.label}
          </option>
        ))}
      </select>
      <button className="rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-muted" onClick={() => setChoosing(false)} type="button">
        取消
      </button>
    </div>
  );
}
