/*
 * [INPUT]: 依赖 pomelo-core（PomeloEditor / PomeloEditorState.fromJSON）、pomelo-vello（VelloRendererAdapter）、
 * world-canvas 的 vello blocks / ViewportPlugin、canvas-store 与 lucide-react
 * [OUTPUT]: 对外提供 CanvasPomeloHost：真实世界画布的 pomelo 底座——
 * canvas-store（world_entities/world_relations/world_canvas 唯一语义真相）→ pomelo 文档按 block id diff
 * 增量同步（T1-c：新增 addRecord / 删除 removeRecord / 属性变化 updateRecord，不再全量重建）；
 * ViewportPlugin（平移/缩放）+ CanvasBindsPlugin（选中解析/拖拽位移与 resize 持久化/进入容器/删除）
 * + AlignmentGuidePlugin（拖拽对齐吸附与提示线）；
 * 画布工具（模式/连线/插入/undo/缩放菜单）由 CanvasToolbarItems 承载并合并进全局 Header（canvas-top-bar.tsx），
 * 世界工具栏与「设定视图」切换仍上提到全局 Header（canvas-top-bar.tsx）；
 * 自由元素映射：note→NoteBlockV、text/shape→FreeElementBlockV、绑定两实体的自由箭头→复用
 * RelationArrowBlockV 投影（未绑定箭头暂不渲染）；画面 delta 同步经 moveElement + persistGeometry
 * 另含 RealMediaBlockV（T8 媒体元素）/ 空世界与空容器引导（T9）/ CanvasOutline / toast / 文件拖放（B.12）；
 * 生成提案态（proposal）：媒体元素与 attr 媒体卡从全局 asset 读 proposal，映射为 proposalStatus/
 * proposalPrompt/proposalRefs 等 attrs，供 block 渲染「待确认」态；proposed 但无配方按「计划」映射为
 * planStatus/planPrompt，block 渲染「计划中」；
 * 素材生成等待态（canvas-asset-status）：AI 先落 assetId 时映射为 assetStatus，未就绪不请求 URL，
 * 渲染「生成中/失败」态并在素材就绪后经状态订阅增量重建文档；
 * 「+」引导面板支持把实体简介/正文作为关联拖出；文本属性卡高度服从几何 box（渲染侧裁剪溢出，
 * 不随内容自增长），双击就地编辑内滚动并支持全屏放大；
 * 视口按「世界+上下文」分键持久化（viewportKey/restoreViewport：root `wc:vp:<worldId>`、容器
 * `wc:vp:<worldId>:<contextId>`，进出容器先存回来源再恢复目标，无快照才 fit）；
 * 撤销/重做 = 语义撤销/重做（canvas-store changeLog/redoLog 双栈，经 Cmd/Ctrl+Z、Cmd/Ctrl+Shift+Z 与工具栏），不走 yjs UndoManager
 * [POS]: worlds/[worldID]/canvas 的画布底座层（本组件经 index.tsx dynamic(ssr:false) 挂载）；
 * 语义真相只在 world_entities + world_relations，pomelo 文档是内存投影（canvas 变更永不产 revision）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import { PomeloEditorState } from "@/lib/pomelo/pomelo-core/pomelo-state";
import { PomeloEditor } from "@/lib/pomelo/pomelo-core/pomelo-editor";
import { VelloRendererAdapter, RendererUnsupportedError, RendererInitError } from "@/lib/pomelo/pomelo-vello/pomelo-vello-adapter";
import { WORLD_VELLO_BLOCKS } from "@/lib/pomelo/world-canvas/blocks/vello-world-blocks";
import { ViewportPlugin, centerContent, panBy } from "@/lib/pomelo/world-canvas/plugins/viewport-plugin";
import { GridPlugin } from "@/lib/pomelo/world-canvas/plugins/grid-plugin";
import { AlignmentGuidePlugin } from "@/lib/pomelo/world-canvas/plugins/alignment-guide-plugin";
import { attrMediaLabel } from "@/lib/pomelo/world-canvas/entity-color";
import { fitElementToAsset, mediaSource, modalityOfAssetKind, modalityOfKind, type MediaModality } from "./canvas-media";
import { CanvasBindsPlugin } from "./canvas-pomelo-plugin";
import { relationCandidatesOf } from "./canvas-relation-candidates";
import { CanvasInlineEditor } from "./canvas-inline-editor";
import { CanvasToasts } from "./canvas-toast";
import { CanvasOutline } from "./canvas-outline";
import { entityCoverMedia, entityPhotoUrls } from "./canvas-image";
import { attrMediaValueOf, attrValueOf, ENTITY_FIELD_ASSOCIATIONS, entityMediaAttrs } from "./entity-attrs";
import { isPlanAsset, readProposal, proposalFromAsset } from "./canvas-proposal";
import { canvasAssetOf, canvasAssetStateOf, ensureCanvasAssetStatus, stopCanvasAssetStatus, useCanvasAssetStatusStore } from "./canvas-asset-status";
import { type AttrCreator, type AttrMedia, type CanvasContext, DEFAULT_ENTITY_SIZE, NOTE_SIZE, readLastKind, WORLD_ELEMENT_ID, elementPosition, useWorldCanvasStore, type Point } from "./canvas-store";
import { useWorldDemoStore as useWorldCanvasDemoStore } from "@/lib/pomelo/world-canvas/demo-store";
import type { WorldCanvasElement, WorldEntity } from "@/lib/recut-worlds-client";
import { entityAttrMediaRef } from "@/lib/recut-worlds-client";

// ---------- canvas-store → pomelo document 映射（block id 约定） ----------

type PomeloRecord = { id: string; type: string; attrs: Record<string, unknown> };

// 拖拽/缩放会话中的实时几何（由 CanvasBindsPlugin.liveGeometry 提供）：
// 全量重建时优先采用，避免中途 dataVersion++ 的重建把正在拖拽的元素弹回 store 旧位置
function livePosOf(live: Map<string, { x: number; y: number }> | undefined, canvasId: string): Point | null {
  const value = live?.get(canvasId);
  return value ? { x: value.x, y: value.y } : null;
}

// 实体位置：优先按 `shape:<entityId>` 元素（本文档自己的记录，跨层互不影响）；
// promote 后元素 id 保留原名但已改绑该实体（refKind=entity + refId），按 refId 兜底找回，
// 保证提升卡片「原位成卡」而非跳到网格位
function entityElementPosition(state: ReturnType<typeof useWorldCanvasStore.getState>, entity: WorldEntity, canvasId: string, fallbackIndex: number): Point {
  const element = state.elements.find((item) => item.refKind === "entity" && item.refId === entity.id);
  const x = Number(element?.geometry?.x);
  const y = Number(element?.geometry?.y);
  if (element && Number.isFinite(x) && Number.isFinite(y)) return { x, y };
  return elementPosition(state.elements, canvasId, fallbackIndex);
}

function buildPomeloRecords(
  state: ReturnType<typeof useWorldCanvasStore.getState>,
  liveGeometry?: Map<string, { x: number; y: number; width?: number; height?: number }>,
) {
  const records: PomeloRecord[] = [];
  // canvasId → 实时尺寸（拖拽/缩放中的 width/height 覆盖）
  const liveSizes = new Map<string, { width: number; height: number }>();
  if (liveGeometry) {
    for (const [canvasId, geo] of liveGeometry) {
      if (Number.isFinite(geo.width) && Number.isFinite(geo.height)) liveSizes.set(canvasId, { width: geo.width!, height: geo.height! });
    }
  }

  const hiddenEntityIds = new Set(
    state.elements.filter((element) => element.refKind === "entity" && element.props?.hidden).map((element) => String(element.refId)),
  );
  state.entities.forEach((entity: WorldEntity, index: number) => {
    // 画面删除（T16）：props.hidden 的实体投影不渲染（设定保留，大纲面板可放回）
    if (hiddenEntityIds.has(entity.id)) return;
    const canvasId = `shape:${entity.id}`;
    const pos = livePosOf(liveGeometry, canvasId) ?? entityElementPosition(state, entity, canvasId, index);
    const element = state.elements.find((item) => item.id === canvasId);
    const liveSize = liveSizes.get(canvasId);
    const cover = entityCoverMedia(state.apiBase, entity);
    const photoUrls = entityPhotoUrls(state.apiBase, entity);
    // 实体媒体属性里的素材仍在生成：头图/资料格不请求未就绪 URL（避免 404 重试），
    // 改为渲染等待态；素材就绪后经状态订阅重建切到真实图。
    const coverState = cover?.assetId ? canvasAssetStateOf(cover.assetId, undefined) : "ready";
    const pendingUrls = new Set<string>();
    for (const attr of entityMediaAttrs(entity)) {
      const value = attrMediaValueOf(entity, attr.key);
      if (!value?.assetId) continue;
      if (canvasAssetStateOf(value.assetId, undefined) !== "ready") pendingUrls.add(mediaSource(state.apiBase, { assetId: value.assetId }));
    }
    records.push({
      id: `entity:${entity.id}`,
      type: "entity-card",
      attrs: {
        x: pos.x,
        y: pos.y,
        width: liveSize?.width ?? (Number(element?.geometry?.width) || DEFAULT_ENTITY_SIZE.width),
        height: liveSize?.height ?? (Number(element?.geometry?.height) || DEFAULT_ENTITY_SIZE.height),
        title: entity.name,
        subtitle: "",
        tags: [],
        desc: entity.intro || "",
        kind: entity.typeId,
        cover: "",
        coverUrl: coverState === "ready" ? cover?.url ?? "" : "",
        coverKind: coverState === "ready" ? cover?.kind ?? undefined : undefined,
        ...(coverState !== "ready" ? { coverStatus: coverState } : {}),
        // photoUrls = 参考素材图片（头图取自参考素材时已剔除那张；未就绪素材另行等待态）
        photoUrls: photoUrls.filter((url) => !pendingUrls.has(url)),
        photos: [],
        isProvisional: entity.isProvisional ? true : undefined,
      },
    });
  });

  // 世界根节点不再画在画布上（T17 重构）：全局上下文入口收进 Header icon + 右侧属性面板

  state.elements.forEach((element: WorldCanvasElement, index: number) => {
    if (element.kind === "entity" || element.id === WORLD_ELEMENT_ID) return;
    const pos = livePosOf(liveGeometry, element.id) ?? elementPosition(state.elements, element.id, index);
    const liveSize = liveSizes.get(element.id);
    const width = liveSize?.width ?? (Number(element.geometry?.width) || NOTE_SIZE.width);
    const height = liveSize?.height ?? (Number(element.geometry?.height) || NOTE_SIZE.height);
    if (element.kind === "media") {
      // 媒体元素（T8/B.12）：图片 cover-fit 缩略 / 视频音频占位卡；挂接后带「参考素材」角标。
      // 生成提案（视频等高价媒体）：带 proposal 属性 → 卡片渲染为「待确认」态。
      const assetId = String(element.props?.assetId ?? "");
      const url = String(element.props?.url ?? "");
      // 提案真源是全局资产：优先从已回查的 asset 读 proposal（旧画布元素回退 props.proposal）。
      const asset = assetId ? canvasAssetOf(assetId) : null;
      // 素材真源 kind 优先于 props.modality：音频/视频不被当图片交给渲染器（解码失败 → 请求风暴）。
      const modality = modalityOfAssetKind(asset?.kind ?? "") ?? String(element.props?.modality ?? "image");
      const proposal = (asset ? proposalFromAsset(asset) : null) ?? readProposal(element.props);
      // 计划态（proposed 但无配方）：画布上显式渲染「计划中」，不能只剩一个空占位卡。
      const plan = asset ? isPlanAsset(asset) : false;
      // AI 先落 assetId（素材仍在生成）时：不把未就绪的素材 URL 交给渲染器（避免 404 重试），
      // 走蓝/红等待态；素材就绪后由状态订阅重建文档切到真实图。proposed 由提案/计划徽标表达。
      const assetState = canvasAssetStateOf(assetId, element.props?.assetStatus);
      records.push({
        id: element.id,
        type: "media",
        attrs: {
          x: pos.x,
          y: pos.y,
          width: liveSize?.width ?? (Number(element.geometry?.width) || 220),
          height: liveSize?.height ?? (Number(element.geometry?.height) || 150),
          modality,
          src: assetState === "ready" ? mediaSource(state.apiBase, { ...(assetId ? { assetId } : {}), ...(url ? { url } : {}) }) : "",
          ...(assetState !== "ready" && assetState !== "proposed" ? { assetStatus: assetState } : {}),
          attached: element.props?.evidenceId ? true : undefined,
          label: String(element.name ?? ""),
          ...(proposal ? {
            proposalStatus: proposal.status,
            proposalPrompt: proposal.prompt.replace(/<[^>]*>/g, " "),
            proposalRefs: proposal.references.length,
            proposalModel: proposal.modelId ?? "",
          } : {}),
          ...(plan ? { planStatus: true, planPrompt: String(asset?.metadata?.content ?? "") } : {}),
        },
      });
      return;
    }
    if (element.kind === "attr") {
      // 属性节点：文本/图片/音频/视频预览卡（AI 生成/上传内容承载物）；媒体卡带 assetId|url → 渲染真实图。
      // 文本高度服从几何 box（渲染侧裁剪溢出，见 free-element-block-v），不随内容自增长。
      const media = String(element.props?.media ?? "text");
      const attrAssetId = element.props?.assetId ? String(element.props.assetId) : "";
      const attrAsset = attrAssetId ? canvasAssetOf(attrAssetId) : null;
      // 素材真源 kind 优先：属性卡也避免把音频/视频当图片加载
      const resolvedAttrMedia = modalityOfAssetKind(attrAsset?.kind ?? "") ?? media;
      // 媒体属性卡同媒体元素：素材未就绪 → 不请求 URL，渲染等待态
      const assetState = resolvedAttrMedia !== "text" ? canvasAssetStateOf(attrAssetId, element.props?.assetStatus) : "ready";
      const mediaSrc = resolvedAttrMedia !== "text" && assetState === "ready" ? mediaSource(state.apiBase, {
        ...(attrAssetId ? { assetId: attrAssetId } : {}),
        ...(element.props?.url ? { url: String(element.props.url) } : {}),
      }) : "";
      const proposal = (attrAsset ? proposalFromAsset(attrAsset) : null) ?? readProposal(element.props);
      const plan = attrAsset ? isPlanAsset(attrAsset) : false;
      records.push({
        id: element.id,
        type: "free-element",
        attrs: {
          x: pos.x,
          y: pos.y,
          width: Number(element.geometry?.width) || (resolvedAttrMedia === "text" ? 160 : 200),
          height: Number(element.geometry?.height) || (resolvedAttrMedia === "text" ? 90 : 140),
          elementKind: "attr",
          attrMedia: resolvedAttrMedia,
          // 属性名（props.label，如「环境卡」）优先作为卡片徽标；缺省回退媒体类型标签
          label: String(element.props?.label ?? ""),
          text: String(element.props?.text ?? ""),
          mediaSrc,
          ...(assetState !== "ready" && assetState !== "proposed" ? { assetStatus: assetState } : {}),
          ...(proposal ? {
            proposalStatus: proposal.status,
            proposalPrompt: proposal.prompt.replace(/<[^>]*>/g, " "),
            proposalRefs: proposal.references.length,
          } : {}),
          ...(plan ? { planStatus: true, planPrompt: String(attrAsset?.metadata?.content ?? "") } : {}),
        },
      });
      return;
    }
    if (element.kind === "note") {
      records.push({
        id: element.id,
        type: "note",
        attrs: { x: pos.x, y: pos.y, width, height, text: String(element.props?.text ?? "") },
      });
      return;
    }
    if (element.kind === "text") {
      records.push({
        id: element.id,
        type: "free-element",
        attrs: { x: pos.x, y: pos.y, width: Number(element.geometry?.width) || 120, height: Number(element.geometry?.height) || 24, elementKind: "text", text: String(element.props?.text ?? "") },
      });
      return;
    }
    if (element.kind === "shape") {
      records.push({
        id: element.id,
        type: "free-element",
        attrs: {
          x: pos.x,
          y: pos.y,
          width,
          height,
          elementKind: "shape",
          shapeType: element.props?.shapeType ?? "rectangle",
          text: String(element.props?.text ?? ""),
        },
      });
      return;
    }
    if (element.kind === "arrow") {
      // 草稿箭头投影：属性边（attrMedia 区分文本/图片/音频/视频）与实体间连线 bean 复用关系线渲染
      const fromElementId = String(element.props?.fromElementId ?? "");
      const toElementId = String(element.props?.toElementId ?? "");
      if (!fromElementId || !toElementId) return;
      const attrMedia = String(element.props?.attrMedia ?? "");
      const edgeType = String(element.props?.edgeType ?? "");
      // 属性边标签 = 属性：具体属性名（attr 元素 props.label 优先，回退元素名/媒体类型）
      const attrTarget = state.elements.find((item) => item.id === toElementId && (item.kind === "attr" || item.kind === "media" || item.kind === "text"));
      const attrLabel =
        String(attrTarget?.props?.label ?? "") ||
        String(attrTarget?.name ?? "").replace(/^属性 · /, "") ||
        (attrMedia ? attrMediaLabel(attrMedia) : "");
      // 挂接线（T8）：from 端是非实体元素（媒体卡等），其 block id 就是元素 id 本身；
      // 实体端仍走 shape:<id> → entity:<id> 映射
      const node = (ref: string) => {
        if (ref === WORLD_ELEMENT_ID) return ref;
        const element = state.elements.find((item) => item.id === ref);
        if (element && element.kind !== "entity") return ref;
        return ref.replace(/^shape:/, "entity:");
      };
      const draftAnchor = {
        fromAnchor: element.props?.fromAnchor as { x: number; y: number } | undefined,
        toAnchor: element.props?.toAnchor as { x: number; y: number } | undefined,
        bend: element.props?.bend as { dx: number; dy: number } | undefined,
      };
      const draftTypeLabel = state.relationTypes.find((item) => item.id === edgeType)?.labelZh ?? edgeType;
      records.push({
        id: element.id,
        type: "relation-arrow",
        attrs: {
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          fromId: node(fromElementId),
          toId: node(toElementId),
          label: attrMedia ? `属性 · ${attrLabel || attrMediaLabel(attrMedia)}` : edgeType === "attach" ? "" : draftTypeLabel,
          relationType: attrMedia ? `attr_${attrMedia}` : edgeType,
          ...(draftAnchor.fromAnchor ? { fromAnchor: draftAnchor.fromAnchor } : {}),
          ...(draftAnchor.toAnchor ? { toAnchor: draftAnchor.toAnchor } : {}),
          ...(draftAnchor.bend ? { bend: draftAnchor.bend } : {}),
        },
      });
    }
  });

  const entityById = new Map(state.entities.map((entity) => [entity.id, entity]));
  const seenRelations = new Set<string>();
  // 标签重叠（T5/B.10）：同一对节点的多条边标签沿法向 ±10px 错开（pairKey → 已出现序号）
  const pairLabelIndex = new Map<string, number>();
  // 关系锚点覆盖：shape:rel-<relationId> anchor 元素（kind=arrow + props.relationId）
  const anchorOverrides = new Map<string, Record<string, unknown>>();
  for (const element of state.elements) {
    if (element.kind !== "arrow" || !element.props?.relationId) continue;
    anchorOverrides.set(String(element.props.relationId), element.props as Record<string, unknown>);
  }
  for (const relation of state.relations) {
    if (!entityById.has(relation.fromEntityId) || !entityById.has(relation.toEntityId)) continue;
    // 同一双端 + 同起点语义的重复关系只画第一条（历史数据可能存在重复边）
    const key = `${relation.fromEntityId}→${relation.toEntityId}·${relation.fromRole}`;
    if (seenRelations.has(key)) continue;
    seenRelations.add(key);
    const typeInfo = state.relationTypes.find((item) => item.id === relation.fromRole);
    const toRole = relation.toRole ?? "";
    const pairKey = [relation.fromEntityId, relation.toEntityId].sort().join("~");
    const labelIndex = pairLabelIndex.get(pairKey) ?? 0;
    pairLabelIndex.set(pairKey, labelIndex + 1);
    const anchorProp = anchorOverrides.get(relation.id) ?? {};
    const fromAnchor = anchorProp?.fromAnchor as { x: number; y: number } | undefined;
    const toAnchor = anchorProp?.toAnchor as { x: number; y: number } | undefined;
    const bend = anchorProp?.bend as { dx: number; dy: number } | undefined;
    records.push({
      id: `arrow:${relation.id}`,
      type: "relation-arrow",
      attrs: {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        fromId: `entity:${relation.fromEntityId}`,
        toId: `entity:${relation.toEntityId}`,
        label: typeInfo?.labelZh ?? relation.fromRole,
        fromRole: relation.fromRole,
        toRole,
        hasReverse: toRole !== "",
        reverseLabel: toRole ? (state.relationTypes.find((item) => item.id === toRole)?.labelZh ?? toRole) : "",
        relationType: relation.fromRole,
        group: typeInfo?.group ?? "",
        ...(labelIndex > 0 ? { labelOffsetIndex: labelIndex } : {}),
        ...(fromAnchor ? { fromAnchor } : {}),
        ...(toAnchor ? { toAnchor } : {}),
        ...(bend ? { bend } : {}),
      },
    });
  }
  return records;
}

function syncDocFromCanvasStore(editor: PomeloEditor) {
  const records = buildPomeloRecords(useWorldCanvasStore.getState(), (editor.pluginRegistry.get("CanvasBindsPlugin") as CanvasBindsPlugin | undefined)?.liveGeometry);
  // 增量文档 diff（T1-c）：按 block id 对账——消失的 removeBlock、新增的 addBlock、
  // attrs 变化的 updateBlock；不再全量 remove+add，避免整画布重渲染与封面纹理重复加载
  const desired = new Map(records.map((record) => [record.id, record]));
  editor.state.transact((hook) => {
    for (const existing of editor.state.getAllBlocks((record) => !record.isRoot)) {
      const target = desired.get(existing.id);
      desired.delete(existing.id);
      if (!target) {
        // 幂等容错：单个脏块 remove/update 抛错不得中止整个 diff 事务（否则只能整页刷新恢复）
        try {
          hook.removeBlock(existing.id);
        } catch {
          // ignore
        }
        continue;
      }
      // updateBlock 是合并语义：旧 attrs 中目标已不存在的 key 显式置 undefined 清除
      const updates: Record<string, unknown> = { ...target.attrs };
      for (const key of Object.keys(existing.attrs)) {
        if (!(key in updates)) updates[key] = undefined;
      }
      if (JSON.stringify(existing.attrs) !== JSON.stringify(stripUndefined(updates))) {
        try {
          hook.updateBlock(existing.id, updates as never);
        } catch {
          // ignore
        }
      }
    }
    for (const record of desired.values()) {
      hook.addBlock({ id: record.id, type: record.type, attrs: record.attrs } as never);
    }
  });
}

// JSON 对比辅助：undefined 值视为缺省（updateAttributes 会把 undefined 写进 Y.Map，
// 与「key 缺失」在渲染上等价，但 JSON.stringify 视角不同）
function stripUndefined(attrs: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

// ---------- 世界工具栏已全部上提到全局 Header（canvas-top-bar.tsx），画布内不再保留顶部覆盖层 ----------

// ---------- 视口持久化（T12，按世界+上下文分键）：root 沿用旧键 `wc:vp:<worldId>`，
// 容器上下文 `wc:vp:<worldId>:<contextId>`——进出容器各自恢复，不互相覆盖 ----------

function viewportKey(context: ReturnType<typeof useWorldCanvasStore.getState>["context"]): string {
  const worldId = useWorldCanvasStore.getState().worldId;
  return context ? `wc:vp:${worldId}:${context.entityId}` : `wc:vp:${worldId}`;
}

function restoreViewport(editor: PomeloEditor, key: string): boolean {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? "null") as { x: number; y: number; scale: number } | null;
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) && saved.scale > 0) {
      (editor.renderAdapter as VelloRendererAdapter).setTransform(saved.x, saved.y, saved.scale);
      return true;
    }
  } catch {
    // 无视口快照时保持原状
  }
  return false;
}


// ---------- 「+」生成引导面板（两区：属性 / 实体）----------
// 属性区：来源实体 type schema 建议字段 + 一等实体字段「简介/正文」（预填 entity.intro/detail，
// 编辑即回写字段）+ 空白属性（四种媒体）；实体区：直接列预设/自定义实体类型，点即建草稿卡
// （「空白」用最近使用类型），并自动补一条默认关系（候选 Top1；边类型不在面板选：创建后点击边，
// 右侧边属性面板直接调整）。

function AttrCreatorPanel() {
  const creator = useWorldCanvasStore((state) => state.attrCreator);
  const readOnly = useWorldCanvasStore((state) => state.readOnly);
  const setAttrCreator = useWorldCanvasStore((state) => state.setAttrCreator);
  const createAttribute = useWorldCanvasStore((state) => state.createAttribute);
  const createEntity = useWorldCanvasStore((state) => state.createEntity);
  const createRelation = useWorldCanvasStore((state) => state.createRelation);
  const startInlineEdit = useWorldCanvasStore((state) => state.startInlineEdit);
  const entityTypes = useWorldCanvasStore((state) => state.entityTypes);
  const relationTypes = useWorldCanvasStore((state) => state.relationTypes);
  const entities = useWorldCanvasStore((state) => state.entities);
  if (!creator || readOnly) return null;
  // creator.fromEntityId 是元素 id（shape:<entityId>），按两种形态解析实体
  const sourceEntityId = creator.fromEntityId.replace(/^shape:/, "");
  const fromEntity = entities.find((entity) => entity.id === sourceEntityId);
  const sourceType = fromEntity ? entityTypes.find((item) => item.id === fromEntity.typeId) : undefined;
  // 建议属性 = 来源实体 type schema 的字段 + 实体自身已有但不在 schema 的属性（如拖入图片生成的
  // media-01…/自定义属性）。已填值的直接带值显示；media 字段带 assetId 建媒体卡，
  // 不落对象字符串——文本化 media 值只会得到 "[object Object]"
  const schemaSuggestions = (sourceType?.fields ?? []).map((field) => {
    const value = fromEntity ? attrValueOf(fromEntity, field.key) : undefined;
    const mediaValue = field.type === "media" ? entityAttrMediaRef(value) : null;
    return { ...field, rawValue: value, mediaValue, value: mediaValue ? "" : value == null ? "" : String(value) };
  });
  const schemaKeys = new Set(schemaSuggestions.map((field) => field.key));
  const entityAttrSuggestions = (fromEntity?.attrs ?? [])
    .filter((attr) => !schemaKeys.has(attr.key))
    .map((attr) => {
      const mediaValue = attr.type === "media" ? entityAttrMediaRef(attr.value) : null;
      return {
        key: attr.key,
        label: attr.label ?? attr.key,
        type: attr.type,
        options: attr.options,
        rawValue: attr.value,
        mediaValue,
        value: mediaValue ? "" : attr.value == null ? "" : String(attr.value),
      };
    });
  const suggestedFields = [...schemaSuggestions, ...entityAttrSuggestions];
  // 一等实体字段（简介/正文）也能作为画布关联放到这里：预填实体当前值，点即建属性卡并挂边；
  // 编辑卡片正文经 syncAttrValue 回写 entity.intro/detail（保留标签映射见 entity-attrs）。
  const entityFieldSuggestions = ENTITY_FIELD_ASSOCIATIONS.map((field) => {
    const value = fromEntity ? fromEntity[field.key] ?? "" : "";
    return { key: field.key, label: field.label, type: "text" as const, options: undefined as string[] | undefined, rawValue: value, mediaValue: null, value: value };
  });
  const attributeSuggestions = [...entityFieldSuggestions, ...suggestedFields];
  const filledFields = attributeSuggestions.filter((field) => field.value.trim() || (field.type === "media" && field.mediaValue && field.mediaValue.assetId));
  const pos = {
    x: Number.isFinite(creator.worldX) ? creator.worldX! : 420,
    y: Number.isFinite(creator.worldY) ? creator.worldY! : 300,
  };  const blankMediaOptions: Array<{ media: AttrMedia; label: string; icon: string }> = [
    { media: "text", label: "文本", icon: "≡" },
    { media: "image", label: "图片", icon: "🖼" },
    { media: "audio", label: "音频", icon: "♪" },
    { media: "video", label: "视频", icon: "▶" },
  ];
  const entityPos = pos;
  const createEntityAt = (kind: string) => {
    void (async () => {
      const newId = await createEntity(kind, { pos: entityPos });
      setAttrCreator(null);
      // 「+」引导建出的新实体：补一条默认关系（边类型不在面板选，落卡后点边在右侧面板调整）。
      // World 节点（无对应实体）不是语义端点，不连线。
      if (!newId || !fromEntity || fromEntity.id === newId) return;
      const fromBase = sourceType?.baseKind || fromEntity.typeId || "";
      const toBase = entityTypes.find((item) => item.id === kind)?.baseKind || kind || "";
      const fromRole =
        relationCandidatesOf(fromBase, toBase).find((id) => relationTypes.some((item) => item.id === id)) ??
        relationTypes[0]?.id ??
        "references";
      await createRelation(fromEntity.id, newId, fromRole);
    })();
  };
  return (
    <div className="fixed z-40 w-72 rounded-xl border border-border bg-card p-3 text-sm shadow-2xl" style={{ left: Math.min(Math.max(16, creator.screenX), (typeof window !== "undefined" ? window.innerWidth - 300 : 800)), top: Math.min(Math.max(16, creator.screenY), (typeof window !== "undefined" ? window.innerHeight - 280 : 600)) }} onMouseDown={(event) => event.stopPropagation()}>
      <p className="mb-2 truncate text-xs text-muted-foreground">从 {creator.fromEntityTitle} 生成</p>
      <p className="mb-1 text-[10px] text-muted-foreground">属性{sourceType ? ` · ${sourceType.name}已填的带值可选` : ""}</p>
      {filledFields.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {filledFields.map((field) => {
            const mediaPreview = field.mediaValue && field.mediaValue.assetId ? field.mediaValue : null;
            const mediaKind: MediaModality = ((field.options?.[0] as MediaModality) ?? (mediaPreview?.kind as MediaModality) ?? "image");
            const summary = mediaPreview
              ? mediaPreview.name || (mediaKind === "image" ? "图片" : mediaKind === "video" ? "视频" : mediaKind === "audio" ? "音频" : "媒体")
              : String(field.value);
            return (
              <button
                key={field.key}
                className="max-w-full rounded-md border border-primary/50 bg-primary/5 px-2 py-1 text-left text-xs hover:border-primary hover:bg-primary/10"
                onClick={() => {
                  if (mediaPreview && mediaPreview.assetId) {
                    const assetId = mediaPreview.assetId;
                    void (async () => {
                      const attrId = await createAttribute(creator.fromEntityId, mediaKind, pos, { label: field.label ?? field.key, assetId, assetName: mediaPreview.name }, "attr");
                      // 建卡后按素材 naturalWidth/Height 适配纵横比（与面板采纳同一规则）
                      if (attrId) fitElementToAsset(attrId, useWorldCanvasStore.getState().apiBase, assetId, mediaKind);
                    })();
                  } else {
                    void createAttribute(creator.fromEntityId, "text", pos, { label: field.label ?? field.key, text: String(field.rawValue ?? field.value) }, "attr");
                  }
                  setAttrCreator(null);
                }}
                title={`${field.label ?? field.key}：${summary} · 点击生成属性并挂边（边即属性关联）`}
                type="button"
              >
                <span className="font-medium">{field.label ?? field.key}</span>
                <span className="ml-1 text-[10px] text-muted-foreground">{summary.length > 12 ? `${summary.slice(0, 12)}…` : summary}</span>
              </button>
            );
          })}
        </div>
      )}
      <div className="mb-2 flex flex-wrap gap-1.5">
        {attributeSuggestions.filter((field) => !field.value.trim() && !(field.mediaValue?.assetId)).map((field) => (
          <button
            key={field.key}
            className="rounded-md border border-border px-2 py-1 text-xs hover:border-primary/60 hover:bg-primary/5"
            onClick={() => {
              const media = field.type === "media" ? ((field.options?.[0] as AttrMedia) ?? "image") : "text";
              void createAttribute(creator.fromEntityId, media, pos, { label: field.label ?? field.key, text: "" }, "attr");
              setAttrCreator(null);
            }}
            title="创建该属性"
            type="button"
          >
            {field.label ?? field.key}
          </button>
        ))}
        {!attributeSuggestions.length && <p className="text-[10px] text-muted-foreground">暂无建议字段，可用下方空白属性。</p>}
      </div>
      <p className="mb-1 text-[10px] text-muted-foreground">空白属性 · 点击即创建</p>
      <div className="mb-2 grid grid-cols-4 gap-1.5">
        {blankMediaOptions.map((option) => (
          <button
            key={option.media}
            className="flex items-center justify-center gap-1 rounded-md border border-border px-1.5 py-2 text-xs hover:border-primary/60 hover:bg-primary/5"
            onClick={() => {
              void (async () => {
                // 空白属性：创建后进入命名态（填写属性名称），值提交时同步到实体 content 字段
                const attrId = await createAttribute(creator.fromEntityId, option.media, pos, undefined, "attr");
                if (attrId) {
                  startInlineEdit({
                    kind: "attr-title",
                    elementId: attrId,
                    rect: { x: pos.x, y: pos.y, width: 260, height: 28 },
                    value: "",
                  });
                }
              })();
              setAttrCreator(null);
            }}
            type="button"
          >
            <span aria-hidden>{option.icon}</span>
            {option.label}
          </button>
        ))}
      </div>
      <p className="mb-1 text-[10px] text-muted-foreground">实体 · 点击即创建</p>
      <div className="flex flex-wrap gap-1.5">
        {entityTypes.map((item) => (
          <button
            key={item.id}
            className="rounded-md border border-border px-2 py-1 text-xs hover:border-primary/60 hover:bg-primary/5"
            onClick={() => createEntityAt(item.id)}
            type="button"
          >
            {item.name}
          </button>
        ))}
        <button
          className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:border-primary/60 hover:bg-primary/5 hover:text-foreground"
          onClick={() => createEntityAt(readLastKind())}
          type="button"
        >
          空白
        </button>
      </div>
      <button className="mt-2 w-full rounded-md px-2 py-1 text-center text-xs text-muted-foreground hover:bg-muted" onClick={() => setAttrCreator(null)} type="button">
        取消
      </button>
    </div>
  );
}

// ---------- 空世界引导（T9/B.5）：三步说明 + 一键出第一张人物卡；首 3 次进入显示 ----------

const ONBOARDING_KEY = "wc:onboardingVisits";

function EmptyWorldGuide() {
  const context = useWorldCanvasStore((state) => state.context);
  const entityCount = useWorldCanvasStore((state) => state.entities.length);
  const elementCount = useWorldCanvasStore((state) => state.elements.length);
  const readOnly = useWorldCanvasStore((state) => state.readOnly);
  const setCreating = useWorldCanvasStore((state) => state.setCreating);
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => {
    // 首访引导：进画布累计 <3 次时显示（localStorage 计数，可跳过；帮助面板可找回）
    try {
      const visits = Number(localStorage.getItem(ONBOARDING_KEY) ?? "0") + 1;
      localStorage.setItem(ONBOARDING_KEY, String(visits));
      setDismissed(visits > 3);
    } catch {
      setDismissed(true);
    }
  }, []);
  if (context || entityCount > 0 || elementCount > 1 || readOnly || dismissed) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
      <div className="pointer-events-auto flex w-80 flex-col items-center gap-3 rounded-xl border bg-card/90 p-6 text-center shadow-xl">
        <p className="text-base font-semibold">开始搭建这个世界</p>
        <ul className="space-y-1.5 text-left text-xs text-muted-foreground">
          <li>① ＋ 或双击空白 → 放下人物 / 地点 / 物件</li>
          <li>② 悬停卡片拖「＋」手柄 → 连出关系</li>
          <li>③ 拖入图片 → 添加为「媒体属性」（卡面图源随之更新）</li>
        </ul>
        <button
          className="rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          onClick={() => setCreating(true)}
          type="button"
        >
          创建第一个设定
        </button>
        <button className="text-[10px] text-muted-foreground hover:underline" onClick={() => setDismissed(true)} type="button">
          跳过
        </button>
      </div>
    </div>
  );
}

// ---------- 空容器引导（T6/B.11）：进入无子设定的实体时，画布中央 CTA ----------

function EmptyContainerGuide() {
  const context = useWorldCanvasStore((state) => state.context);
  const entityCount = useWorldCanvasStore((state) => state.entities.length);
  const elementCount = useWorldCanvasStore((state) => state.elements.length);
  const readOnly = useWorldCanvasStore((state) => state.readOnly);
  const setCreating = useWorldCanvasStore((state) => state.setCreating);
  if (!context || entityCount > 0 || elementCount > 0 || readOnly) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
      <div className="pointer-events-auto flex w-72 flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card/80 p-5 text-center">
        <p className="text-sm font-medium">「{context.title}」下还没有子设定</p>
        <p className="text-xs text-muted-foreground">子设定只在这个实体内部可见（如道具、细节、章节）。</p>
        <button
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          onClick={() => setCreating(true)}
          type="button"
        >
          ＋ 添加子设定
        </button>
      </div>
    </div>
  );
}

// ---------- 抓手模式：panMode 时覆盖画布，截获指针拖拽平移视口（工具组在全局 Header） ----------

function PanOverlay({ editorRef }: { editorRef: RefObject<PomeloEditor | null> }) {
  const panMode = useWorldCanvasStore((state) => state.panMode);
  const panDrag = useRef<{ pointerId: number; lastX: number; lastY: number } | null>(null);
  if (!panMode) return null;
  const applyPan = (dx: number, dy: number) => {
    const editor = editorRef.current;
    if (!editor || (dx === 0 && dy === 0)) return;
    const adapter = editor.renderAdapter as VelloRendererAdapter;
    const next = panBy({ ...adapter.transform }, dx, dy);
    adapter.setTransform(next.x, next.y, next.scale);
    useWorldCanvasDemoStore.getState().setTransform(next);
  };
  return (
    <div
      className="absolute inset-0 z-10 cursor-grab active:cursor-grabbing"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        panDrag.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY };
      }}
      onPointerMove={(event) => {
        const drag = panDrag.current;
        if (!drag || event.pointerId !== drag.pointerId) return;
        applyPan(event.clientX - drag.lastX, event.clientY - drag.lastY);
        drag.lastX = event.clientX;
        drag.lastY = event.clientY;
      }}
      onPointerUp={() => {
        panDrag.current = null;
      }}
      onPointerCancel={() => {
        panDrag.current = null;
      }}
    />
  );
}

// ---------- 渲染器失败 → 对症指引 ----------

type RendererIssue = { title: string; message: string; steps: string[]; retryable: boolean };

const WEBGPU_REASON_TEXT: Record<string, string> = {
  "insecure-context": "页面不是安全上下文：WebGPU 仅在 localhost 或 HTTPS 下可用。",
  "no-webgpu": "当前浏览器未提供 WebGPU（navigator.gpu 不存在）。",
  "no-adapter": "浏览器未返回可用的 WebGPU 适配器（GPU 被禁用或列入黑名单）。",
  "adapter-error": "请求 WebGPU 适配器时出错（可能被跨域 iframe 的权限策略拦截）。",
};

function rendererIssueFrom(error: unknown): RendererIssue {
  if (error instanceof RendererInitError && error.reason === "resource") {
    return {
      title: "世界画布渲染器资源未就绪",
      message: "未能加载 vello 的 WebGPU 产物（/vello-wasm/*）。",
      steps: [
        "开发环境：在 web/ 目录运行 pnpm vello:setup（或 pnpm wasm:build:vello）重新构建。",
        "pnpm dev / pnpm build 已内置自动检查，正常情况下会自动补建；构建后刷新页面重试。",
        "生产环境：检查 /vello-wasm/* 静态资源是否正确部署。",
      ],
      retryable: true,
    };
  }
  if (error instanceof RendererUnsupportedError) {
    return {
      title: "无法渲染世界画布",
      message: WEBGPU_REASON_TEXT[error.reason] ?? "当前环境未启用可用的 WebGPU（vello/wasm 无法启动）。",
      steps: [
        "使用最新版 Chrome / Edge（桌面版 113+）或 Safari 18+。",
        "地址栏打开 chrome://gpu，确认 WebGPU 为 Hardware accelerated。",
        "若显示 Disabled / Software only：在 chrome://settings/system 打开「使用硬件加速」，或以 --ignore-gpu-blocklist 启动浏览器后重启。",
        "确认通过 localhost 或 HTTPS 访问；跨域 iframe 需父页授予 allow=\"webgpu\"。",
      ],
      retryable: true,
    };
  }
  return {
    title: "世界画布渲染器初始化失败",
    message: error instanceof Error ? error.message : String(error),
    steps: ["打开浏览器控制台查看详细错误后重试。"],
    retryable: true,
  };
}

// ---------- 宿主组件 ----------

export function CanvasPomeloHost() {
  const dataVersion = useWorldCanvasStore((state) => state.dataVersion);
  const context = useWorldCanvasStore((state) => state.context);
  const worldName = useWorldCanvasStore((state) => state.worldName);
  const worldId = useWorldCanvasStore((state) => state.worldId);
  const selection = useWorldCanvasStore((state) => state.selection);
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<PomeloEditor | null>(null);
  const pluginRef = useRef<CanvasBindsPlugin | null>(null);
  // 进入容器时自动换视口（B.11/T12）：context 变化置位，文档同步后执行一次
  const fitOnNextSync = useRef(false);
  // 视口持久化订阅（T12）：卸载时释放；lastViewportKeyRef 记录「来源上下文键」供切换时存回
  const viewportUnsubRef = useRef<{ dispose: () => void } | null>(null);
  const lastViewportKeyRef = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const [rendererIssue, setRendererIssue] = useState<RendererIssue | null>(null);
  // 渲染器失败后「重试」：递增触发 effect 重建编辑器（cleanup 会先销毁旧实例）
  const [initAttempt, setInitAttempt] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || editorRef.current) return;
    setRendererIssue(null);
    const bindsPlugin = new CanvasBindsPlugin();
    const editor = new PomeloEditor({
      state: PomeloEditorState.fromJSON({ id: "world-canvas", children: [] }),
      container,
      plugins: [new GridPlugin(), new ViewportPlugin(), bindsPlugin, new AlignmentGuidePlugin()],
      blockTypes: WORLD_VELLO_BLOCKS,
      renderAdapter: new VelloRendererAdapter(),
    });
    editorRef.current = editor;
    pluginRef.current = bindsPlugin;
    let cancelled = false;
    void editor.onInit().then(() => {
      if (cancelled || editorRef.current !== editor) return;
      // 背景由容器 CSS var(--background) 提供（adapter 以 backgroundAlpha:0 初始化）；
      // 点状网格由 GridPlugin 绘制
      syncDocFromCanvasStore(editor);
      centerContent(editor);
      // 视口状态持久化（T12）：按「世界+上下文」分键存取（见模块级 viewportKey/restoreViewport）
      let viewportTimer: ReturnType<typeof setTimeout> | null = null;
      const unsubViewport = (editor.renderAdapter as VelloRendererAdapter).onTransformEvent.on(() => {
        if (viewportTimer) clearTimeout(viewportTimer);
        viewportTimer = setTimeout(() => {
          try {
            // 写入时以「当前」上下文为准（400ms 去抖期间恰好切容器，快照应落新上下文）
            const t = (editor.renderAdapter as VelloRendererAdapter).transform;
            localStorage.setItem(viewportKey(useWorldCanvasStore.getState().context), JSON.stringify(t));
          } catch {
            // localStorage 不可用时静默
          }
        }, 400);
      });
      viewportUnsubRef.current = unsubViewport;
      lastViewportKeyRef.current = viewportKey(null);
      if (!restoreViewport(editor, lastViewportKeyRef.current)) {
        centerContent(editor);
      }
      useWorldCanvasStore.getState().setEditor(editor);
      setReady(true);
      // e2e/调试句柄（仅 dev 构建暴露）
      if (process.env.NODE_ENV !== "production") {
        (window as unknown as Record<string, unknown>).__worldCanvasDebug = {
          editor,
          store: useWorldCanvasStore,
          renderer: "vello",
          fit: () => centerContent(editor),
          rebuild: () => syncDocFromCanvasStore(editor),
        };
      }
    }).catch((error) => {
      if (cancelled || editorRef.current !== editor) return;
      setRendererIssue(rendererIssueFrom(error));
    });
    return () => {
      cancelled = true;
      if (process.env.NODE_ENV !== "production") {
        delete (window as unknown as Record<string, unknown>).__worldCanvasDebug;
      }
      viewportUnsubRef.current?.dispose();
      viewportUnsubRef.current = null;
      stopCanvasAssetStatus();
      editor.destroy();
      editorRef.current = null;
      pluginRef.current = null;
      useWorldCanvasStore.getState().setEditor(null);
      setReady(false);
    };
  }, [initAttempt]);

  // store → 文档重建（仅 dataVersion / 上下文 / worldName 变化时；拖拽走插件 transact，不重建）
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !ready) return;
    syncDocFromCanvasStore(editor);
    if (fitOnNextSync.current) {
      fitOnNextSync.current = false;
      viewportSwitch(editor, context);
    }
  }, [dataVersion, context, worldName, ready]);

  // 进入容器自动换视口（B.11 + T12）：先把手头 transform 存回来源键，再恢复目标键
  // （无目标快照 = fit 子内容一次）；exit 也要做（回到 root 的上次视口）
  const viewportSwitch = (editor: PomeloEditor, context: CanvasContext | null) => {
    const adapter = editor.renderAdapter as VelloRendererAdapter;
    const fromKey = lastViewportKeyRef.current;
    const toKey = viewportKey(context);
    if (fromKey && fromKey !== toKey) {
      try {
        localStorage.setItem(fromKey, JSON.stringify(adapter.transform));
      } catch {
        // 静默
      }
    }
    if (!restoreViewport(editor, toKey)) {
      centerContent(editor);
    }
    lastViewportKeyRef.current = toKey;
  };

  // context 变化 → 下一次同步后换视口（进入/退出容器，B.11 + T12）
  useEffect(() => {
    if (context !== undefined) fitOnNextSync.current = true;
  }, [context]);

  // 选中变化 → 重绘选区 overlay
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !ready) return;
    pluginRef.current?.drawOverlay(editor);
  }, [selection, dataVersion, ready]);

  // 素材生成等待态（AI 先落 assetId）：把画布上引用中的 assetId 纳入状态跟踪
  // （media 元素 / 媒体属性卡 / 实体 media 属性头图）；未完成则轮询，就绪/失败后停止。
  useEffect(() => {
    if (!ready) return;
    const state = useWorldCanvasStore.getState();
    for (const element of state.elements) {
      if (element.kind !== "media" && element.kind !== "attr") continue;
      const assetId = element.props?.assetId ? String(element.props.assetId) : "";
      if (assetId) ensureCanvasAssetStatus(state.apiBase, assetId);
    }
    for (const entity of state.entities) {
      for (const attr of entityMediaAttrs(entity)) {
        const value = attrMediaValueOf(entity, attr.key);
        if (value?.assetId) ensureCanvasAssetStatus(state.apiBase, value.assetId);
      }
    }
  }, [dataVersion, ready]);

  // 素材状态变化 → 增量重建文档（等待态 ↔ 真实图/失败态）并重绘 overlay
  useEffect(() => {
    if (!ready) return;
    const unsubscribe = useCanvasAssetStatusStore.subscribe(() => {
      const editor = editorRef.current;
      if (!editor) return;
      syncDocFromCanvasStore(editor);
      pluginRef.current?.drawOverlay(editor);
    });
    return unsubscribe;
  }, [ready]);

  // T8 文件拖放（B.12 矩阵）：文件 → 实体卡 = 直接写为 media 属性（attachMediaAttr，不建画布元素）；
  // 文件 → 空白 = 独立 media 元素（落点处）
  const onDragOver = (event: React.DragEvent) => {
    if (event.dataTransfer.types.includes("Files")) event.preventDefault();
  };
  const onDrop = (event: React.DragEvent) => {
    if (!event.dataTransfer.files.length) return;
    event.preventDefault();
    const plugin = pluginRef.current;
    const editor = editorRef.current;
    if (!plugin || !editor) return;
    const container = containerRef.current;
    const rect = container?.getBoundingClientRect();
    if (!rect) return;
    const adapter = editor.renderAdapter as VelloRendererAdapter;
    const t = adapter.transform;
    const world = { x: (event.clientX - rect.left - t.x) / t.scale, y: (event.clientY - rect.top - t.y) / t.scale };
    const store = useWorldCanvasStore.getState();
    if (store.readOnly) return;
    const targetEntityId = plugin.hitEntityAt(world);
    void (async () => {
      for (const file of Array.from(event.dataTransfer.files)) {
        const modality = modalityOfKind(file.type);
        if (!modality) continue;
        try {
          const form = new FormData();
          form.append("file", file);
          const response = await fetch(`${store.apiBase}/v1/media/assets`, { method: "POST", body: form });
          if (!response.ok) throw new Error("素材导入失败");
          const asset = (await response.json()) as { id: string };
          if (targetEntityId) {
            await useWorldCanvasStore.getState().attachMediaAttr(targetEntityId, { assetId: asset.id, name: file.name, kind: modality });
            const target = useWorldCanvasStore.getState().entities.find((item) => item.id === targetEntityId);
            useWorldCanvasStore.getState().toast(`已将「${file.name}」添加为「${target?.name ?? "设定"}」的媒体属性`, "success");
          } else {
            await useWorldCanvasStore.getState().addMediaElement({ modality, assetId: asset.id, name: file.name }, world);
          }
        } catch (cause) {
          useWorldCanvasStore.getState().toast(cause instanceof Error ? cause.message : "素材导入失败", "error");
        }
      }
    })();
  };

  return (
    <div className="relative h-full min-h-0 w-full bg-background">
      <div ref={containerRef} className="absolute inset-0 [&_canvas]:block" onDragOver={onDragOver} onDrop={onDrop} />
      {rendererIssue && (
        <div className="absolute inset-0 z-40 grid place-items-center bg-background/95 p-6">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-left shadow-xl">
            <p className="text-sm font-semibold">{rendererIssue.title}</p>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">{rendererIssue.message}</p>
            {rendererIssue.steps.length > 0 && (
              <ol className="mt-3 list-decimal space-y-1 pl-4 text-[11px] leading-5 text-muted-foreground">
                {rendererIssue.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            )}
            {rendererIssue.retryable && (
              <button
                type="button"
                onClick={() => setInitAttempt((value) => value + 1)}
                className="mt-4 inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted"
              >
                重试
              </button>
            )}
          </div>
        </div>
      )}
      <CanvasInlineEditor />
      <EmptyWorldGuide />
      <EmptyContainerGuide />
      <CanvasOutline />
      <CanvasToasts />
      <PanOverlay editorRef={editorRef} />
      <AttrCreatorPanel />
    </div>
  );
}
