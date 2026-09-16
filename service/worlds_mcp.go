/*
 * [INPUT]: 依赖 WorldStore 与标准库 JSON 编码
 * [OUTPUT]: 对外提供全局 recut.worlds.* MCP 工具。读：list/get/brief/resolve/readiness/entities.list/
 * entities.get/entityTypes.list/relations.list/evidence.list/doc/docs 无条件可发现；
 * 写收口在画布接口（方案 A，World 即画布）：entity/relation/entityType（内容）与 create/update/fork/delete/
 * bind_project/evidence.archive（生命周期），加上 doc.update/promote/lock/unlock；
 * 语义 CRUD（entities.upsert/create_child/promote、relations.create/update、entityTypes.upsert）已下线。
 * 返回同构 structuredContent，列表按主机规则包装为 {items:[...]}；doc/doc.update 附带 layout 只读回执。
 * 写工具成功后经 WorldEventPublisher 广播 world.changed（lock/unlock 广播对应锁事件），供已打开画布刷新
 * [POS]: service 的 Creation Worlds MCP 面；工具属于全局平台组，与 recut.project 及 recut.media 系列工具并列，
 * 不进入 per-App 工具组，Chat 与外部 Agent 在选择 App 之前即可发现
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strconv"
)

// worldsMCPToolDefinitions returns the unconditional global Worlds tools. Read
// tools are freely discoverable; mutating tools repeat the explicit-user-action
// requirement in their descriptions and are only invoked on explicit requests.
// The locale parameter matches the platform tool list signature; Worlds tool
// descriptions are localized via worldsToolDescriptionsEN (falling back to zh);
// schema-internal property descriptions stay Chinese for now.
func worldsMCPToolDefinitions(locale Locale) []map[string]any {
	tools := []map[string]any{
		{"name": "recut.worlds.list", "description": "列出全部 Creation World 的摘要（名称、类型、实体计数与最近更新时间）。按 text 过滤或按 type 筛选；结果是分页的，limit 默认 50，最大 50。没有隐式当前 World，读取任何 World 都必须先拿到显式 worldId。", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{"text": map[string]string{"type": "string", "description": "可选：按名称或描述过滤。"}, "type": worldKindSchema(), "cursor": map[string]string{"type": "string", "description": "可选：上一页返回的 nextCursor。"}, "limit": map[string]any{"type": "number", "minimum": 1, "maximum": 50}}}},
		{"name": "recut.worlds.get", "description": "读取一个 World 的身份、统计、当前 revision 摘要与可用实体种类。worldId 必填；该接口不内联实体，需要角色/故事/风格时调用 recut.worlds.entities.list / entities.get。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId"}, "properties": map[string]any{"worldId": map[string]string{"type": "string", "description": "World ID，entityId 只在同一个 worldId 内有效。"}}}},
		{"name": "recut.worlds.entities.list", "description": "列出指定 World 的实体摘要。worldId 必填；可按 typeId、text、parentId 过滤并分页；默认不含草稿，includeProvisional=true 时把探索草稿一并列出。实体从不跨 World 复用，entityId 只在所属 worldId 内有效。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}, "typeId": map[string]string{"type": "string", "description": "可选：按实体 type id 过滤（character/location/... 或自定义）。"}, "parentId": map[string]string{"type": "string", "description": "可选：只列某实体的直接子设定（递归容器）。"}, "text": map[string]string{"type": "string"}, "includeProvisional": map[string]string{"type": "boolean", "description": "可选：true 时把 isProvisional 草稿也列出（默认隐藏）。"}, "cursor": map[string]string{"type": "string"}, "limit": map[string]any{"type": "number", "minimum": 1, "maximum": 50}}}},
		{"name": "recut.worlds.entities.get", "description": "读取一个实体的完整内容：name/intro/detail 基础字段、有序 attrs 属性列表（text/number/boolean/select/media 值）、关系与引用。worldId 与 entityId 必填，两者一起校验。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId", "entityId"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}, "entityId": map[string]string{"type": "string"}}}},
		{"name": "recut.worlds.evidence.list", "description": "兼容读取 World 的历史证据行（图片/视频/声音/文字及其用途、主次、集合、片段与内容哈希）。注意：素材的权威表示是实体的 media 属性（见 brief.references[]），本工具只为兼容旧数据保留读取；归档用 recut.worlds.evidence.archive。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}}}},
		{"name": "recut.worlds.brief", "description": "读取一个 World 的可生产上下文（默认单次读取入口）：一次获得身份、世界技能（skill/world.md 全文）、角色/故事/场景/风格事实（含 body 长文）、规则约束与证据（assetId 或 url），以及 references[]——从实体 media 属性派生的可引用项（{id,label,kind,role,source,assetId/url,entityId}），role 是生成链路建议值（pov/color-card/environment/character/prop/style-ref/motion-ref/voice/sfx/music）。selection 的 entityIds/storyId 必须都属于该 World；revisionId 缺省用当前 revision。非 local 世界只读。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}, "revisionId": map[string]string{"type": "string", "description": "可选：缺省为 World 当前 revision。"}, "selection": map[string]any{"type": "object", "properties": map[string]any{"storyId": map[string]string{"type": "string"}, "entityIds": map[string]any{"type": "array", "items": map[string]string{"type": "string"}}, "assetRoles": map[string]any{"type": "array", "items": map[string]string{"type": "string"}}, "purpose": worldPurposeSchema()}}}}},
		{"name": "recut.worlds.resolve", "description": "按 World、revision 与显式 selection 解析可消费的 CreationContext（身份、实体、约束、references）。selection 的 entityIds/storyId 必须都属于该 World；revisionId 缺省用当前 revision。结果带 revisionId 与 canonicalHash，可追溯。Agent 默认改用 recut.worlds.brief；resolve 保留给 App/运行时。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId", "selection"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}, "revisionId": map[string]string{"type": "string", "description": "可选：缺省为 World 当前 revision。"}, "selection": map[string]any{"type": "object", "required": []string{"purpose"}, "properties": map[string]any{"storyId": map[string]string{"type": "string"}, "entityIds": map[string]any{"type": "array", "items": map[string]string{"type": "string"}}, "assetRoles": map[string]any{"type": "array", "items": map[string]string{"type": "string"}}, "purpose": worldPurposeSchema()}}}}},
		{"name": "recut.worlds.readiness", "description": "读取一个 World 的就绪度投影（纯计算，无副作用）：skeleton/draft/ready 三档、分数与按优先级排序的 missing 清单（每项含缺失原因与建议动作）。scenarioId 缺省按 world type 自动选择场景蓝图；可选 novel-adaptation / ip-account / style-system / brand-guide / blank。用户要求完善或搭建一个 World 时，先调用本工具获取工作清单，再按建议逐项起草提案，确认后写回。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId"}, "properties": map[string]any{"worldId": map[string]string{"type": "string", "description": "World ID，entityId 只在同一个 worldId 内有效。"}, "scenarioId": map[string]any{"type": "string", "enum": []string{"novel-adaptation", "ip-account", "style-system", "brand-guide", "blank"}, "description": "可选：起点场景蓝图；缺省按世界类型推荐。"}}}},
		{"name": "recut.worlds.create", "description": "创建一个 Creation World。新世界从空开始（不再写入模板空壳实体）；创建后引导用户走 Onboarding（上传素材/粘贴链接/口述），并可用 recut.worlds.readiness 获取工作清单。只在用户明确要求创建 World 时调用；这是 Canon 写入，Agent 不得因推测有帮助而自动创建。", "inputSchema": map[string]any{"type": "object", "required": []string{"name", "type"}, "properties": map[string]any{"name": map[string]string{"type": "string"}, "type": worldKindSchema(), "description": map[string]string{"type": "string"}, "identity": map[string]any{"type": "object"}}}},
		{"name": "recut.worlds.update", "description": "修改 World 的身份、元数据或世界技能（skillMd/world.md，仅 local 世界；非 local 只读会返回 WORLD_READ_ONLY）并按需产出新 revision。expectedRevisionId 提供乐观并发门；过期时返回 WORLD_REVISION_CONFLICT，绝不静默覆盖。只在用户明确要求修改时调用。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}, "name": map[string]string{"type": "string"}, "description": map[string]string{"type": "string"}, "identity": map[string]any{"type": "object"}, "skillMd": map[string]string{"type": "string", "description": "可选：世界技能全文（world.md）。仅 local 世界可写。"}, "expectedRevisionId": map[string]string{"type": "string"}}}},
		{"name": "recut.worlds.entityTypes.list", "description": "列出一个 World 的 entity type 目录（预设 + 自定义）：type 是 schema，实体是实例。目录含字段 schema、图标与配色，驱动画布卡片与详情表单。另附内置受控关系词表。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}}}},
		{"name": "recut.worlds.relations.list", "description": "按实体列出关系：全局关系（touch 该实体）+ 该实体为 scope 的局部关系。每条带 direction（out/in/scope）与受控词表的 inverse 投影，产品语义上关系是双向的。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId", "entityId"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}, "entityId": map[string]string{"type": "string"}}}},
		{"name": "recut.worlds.doc", "description": "读取一个画布 Document（''=全局画布根文档，否则为某实体 id 的内层文档）：返回 {elements, version, contextId}。一张画布 = 一个文档，内层画布是独立文档，实体/关系语义数据共享。画布是表达层，不承载语义真相，也不产出 revision。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}, "contextId": map[string]string{"type": "string", "description": "可选：缺省 '' 根画布。"}}}},
		{"name": "recut.worlds.docs", "description": "列出一个 World 的画布文档索引（每个 contextId 一层的 version/elementCount/updatedAt）。用于编辑前发现存在哪些画布层：contextId ''=根画布，非空=该实体 id 的内层画布。只读。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}}}},
		{"name": "recut.worlds.doc.update", "description": "在一个画布 Document 内应用元素级 ops（insert/update/remove）：kind='entity' 的骨干（refId 指向实体，props 只存视图偏好）或自由元素（text/image/shape/arrow/note/link/media，内容在 props；arrow/link 是语义边：fromElementId 必须指向同文档内的 entity 元素，只有 entity 能作为出发点）。放实体卡只需 {op:'insert', element:{kind:'entity', refKind:'entity', refId}}：服务端自动补 id=`shape:<entityId>`、名称与默认几何。画布视频节点必须落成「生成提案」而非直接生成：element.kind='media' 且 props={modality:'video', proposal:{status:'pending', prompt, references:[{id,kind,role,label}], modelId?, params?, aspectRatio?, durationSec?, note?, proposedBy:'agent'}}，由用户在画布上确认后才生成——不得为画布视频直接调用 recut.video.generate。返回更新后的 {elements, version}。画布元素永不产 revision。只在用户明确要求摆放画布元素时调用。改已有元素时先用 canvas.doc 读取真实 id。World 节点 id=`shape:world`。" + canvasElementConventions, "inputSchema": canvasDocUpdateSchema()},
		{"name": "recut.worlds.promote", "description": "把画布草稿提升为正式语义对象并产出 revision：note/text → Entity（可用 typeId 指定 type）；箭头/link 是有语义的边，出发点必须是 entity 元素：entity→entity 变成 world_relations（relationType），entity→自由元素变成属性绑定（field 绑定到实体属性，自由元素标记为引用投影并生成 attr 锚点元素，值与右侧属性面板共享 entity.content 单一数据源）。提升后原画布元素保留为投影。这是 Canon 写入，必须显式用户确认。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId", "elementId"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}, "elementId": map[string]string{"type": "string"}, "typeId": map[string]string{"type": "string", "description": "可选：便签→实体时的 type id。"}, "relationType": map[string]string{"type": "string", "description": "可选：箭头→关系时的 relation_type。"}, "field": map[string]string{"type": "string", "description": "可选：箭头→属性绑定时的实体属性 key。"}, "title": map[string]string{"type": "string", "description": "可选：便签→实体时的实体标题。"}, "expectedRevisionId": map[string]string{"type": "string"}}}},
		{"name": "recut.worlds.entity", "description": "画布上的实体语义操作（方案 A：内容写入统一经画布接口）。op=create 新建实体（需 typeId+name；给 contextId 时自动在该画布层放置投影卡）；op=update 修改一等字段与属性（entityId 必填；attrs 传数组整体替换、缺省保持不变；attrPatch 按 key 合并单条属性，避免为改一个字段回读全量）；op=archive 软删除（归档实体及其子图，可 restore）；op=restore 恢复；op=confirm 把 isProvisional 草稿转正式并产出 revision。archive/restore/confirm 是 Canon 写入，需用户明确要求。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId", "op"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}, "op": map[string]any{"type": "string", "enum": []string{"create", "update", "archive", "restore", "confirm"}}, "entityId": map[string]string{"type": "string", "description": "update/archive/restore/confirm 必填。"}, "typeId": map[string]string{"type": "string", "description": "create 必填：预设或自定义 type id。"}, "name": map[string]string{"type": "string"}, "intro": map[string]string{"type": "string"}, "detail": map[string]string{"type": "string"}, "attrs": map[string]any{"type": "array", "description": "有序属性列表；update 时缺省保持不变、传数组整体替换。", "items": map[string]any{"type": "object"}}, "attrPatch": map[string]any{"type": "array", "description": "update 可选：按 key 合并单条属性（其余保持不变），数组项为 {key,label?,type?,value}；与 attrs 同时给出时 attrPatch 生效。", "items": map[string]any{"type": "object"}}, "parentId": map[string]string{"type": "string", "description": "可选：父实体 id（递归容器子设定）。"}, "containerRole": map[string]string{"type": "string"}, "isProvisional": map[string]string{"type": "boolean", "description": "create/update 可选：true = 探索草稿，不进 Canon、不产 revision。"}, "contextId": map[string]string{"type": "string", "description": "create 可选：给定时在该画布层自动放置实体投影卡（''=根画布）。"}, "geometry": map[string]any{"type": "object", "description": "create 可选：投影卡几何 {x,y,width,height}。"}, "expectedRevisionId": map[string]string{"type": "string"}}}},
		{"name": "recut.worlds.relation", "description": "画布上的语义关系操作。op=create 建边（fromEntityId/toEntityId/relationType；也可用画布箭头 + canvas.promote 达到同样效果）；op=update 原位改类型或方向；op=archive 软删除（入墓碑，可 restore）；op=restore 恢复。scopeEntityId 非空时是实体局部关系。除 create 可草稿外都是 Canon 写入，需用户明确要求。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId", "op"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}, "op": map[string]any{"type": "string", "enum": []string{"create", "update", "archive", "restore"}}, "relationId": map[string]string{"type": "string", "description": "update/archive/restore 必填。"}, "fromEntityId": map[string]string{"type": "string"}, "toEntityId": map[string]string{"type": "string"}, "relationType": map[string]string{"type": "string"}, "scopeEntityId": map[string]string{"type": "string"}, "metadata": map[string]any{"type": "object"}, "expectedRevisionId": map[string]string{"type": "string"}}}},
		{"name": "recut.worlds.entityType", "description": "定义/覆盖一个实体类型（schema），驱动画布创建菜单与字段渲染。预设 id（character 等）更新本世界内置副本；其他 id 创建自定义 type。type 是 schema，不产 revision。只在用户明确要求定义类型时调用。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId", "id", "name"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}, "id": map[string]string{"type": "string"}, "name": map[string]string{"type": "string"}, "icon": map[string]string{"type": "string"}, "color": map[string]string{"type": "string"}, "baseKind": map[string]string{"type": "string"}, "fields": map[string]any{"type": "array", "items": map[string]any{"type": "object"}, "description": "字段 schema 数组：[{key,label,type,required,placeholder,options,invariant}]。"}}}},
		{"name": "recut.worlds.lock", "description": "进入「多步」World 画布 AI 编辑会话时调用一次，给该世界加 advisory AI 锁：前台画布会立即落盘当前改动、暂停本地保存并显示「AI 正在编辑」，避免并发覆盖。返回 {token}；会话结束务必调用 recut.worlds.unlock 释放（空闲 5 分钟也会自动释放）。单次只读或一次写入不要上锁。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}, "owner": map[string]string{"type": "string", "description": "可选：会话标识，缺省 mcp。"}}}},
		{"name": "recut.worlds.unlock", "description": "释放 recut.worlds.lock 建立的 AI 画布锁。传入 lock 返回的 token 避免误释放他人会话。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}, "token": map[string]string{"type": "string"}}}},
		{"name": "recut.worlds.evidence.archive", "description": "把一份证据从当前 Canon 归档，不删除源素材或旧作品使用的历史版本。仅在用户明确要求移除时调用。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId", "evidenceId"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}, "evidenceId": map[string]string{"type": "string"}, "expectedRevisionId": map[string]string{"type": "string"}}}},
		{"name": "recut.worlds.fork", "description": "把任意 World（平台/发布/本地）在其当前 revision 上复制为一个全新的本地可编辑 World（origin=local），返回新 World 详情。非 local 世界是只读的，用户要求修改平台世界时先说明再经用户确认调用本工具，之后在副本上继续。仅在用户明确要求 Fork/副本/基于某世界修改时调用。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}, "name": map[string]string{"type": "string", "description": "可选：新 World 名称；缺省为源名称加“副本”。"}}}},
		{"name": "recut.worlds.delete", "description": "永久删除一个本地 World：实体、关系、类型目录、画布文档与版本全部移除，且不可恢复。name 必须与 world.name 完全一致，作为防误删的二次确认（不是查找键）。素材库中的媒体 Asset 不受影响，只解除与世界的引用；已绑定该世界的 Project/媒体 Job 会变为未绑定而不是悬空，Artifact/Job 上的绑定指针会被清空。非 local 世界（平台/发布）由目录生命周期管理，拒绝删除，需先 Fork 再删副本。仅在用户明确要求删除并确认名称时调用。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId", "name"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}, "name": map[string]string{"type": "string", "description": "防误删二次确认：必须与 World 名称完全一致。"}}}},
		{"name": "recut.worlds.bind_project", "description": "把 World 的固定 revision 绑定到当前 Project。必须是用户动作、当前 Project owner App 或获得用户确认的 Agent 调用；绑定是跨系统可观察的状态变化。Project 已有 primary binding 时默认替换需提供 replace: true，否则返回 PROJECT_WORLD_ALREADY_BOUND。绑定非 local World 不受只读门禁限制。", "inputSchema": map[string]any{"type": "object", "required": []string{"projectId", "worldId", "selection"}, "properties": map[string]any{"projectId": map[string]string{"type": "string"}, "worldId": map[string]string{"type": "string"}, "revisionId": map[string]string{"type": "string"}, "selection": map[string]any{"type": "object", "required": []string{"purpose"}, "properties": map[string]any{"storyId": map[string]string{"type": "string"}, "entityIds": map[string]any{"type": "array", "items": map[string]string{"type": "string"}}, "assetRoles": map[string]any{"type": "array", "items": map[string]string{"type": "string"}}, "purpose": worldPurposeSchema()}}, "replace": map[string]string{"type": "boolean"}}}},
		{"name": "recut.worlds.revisions.list", "description": "列出一个 World 的版本历史（最新在前，最多 50 条）：每条含 id/hash/reason/createdBy/createdAt；配合 recut.worlds.revert 回滚。只读。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}}}},
		{"name": "recut.worlds.revert", "description": "把 World 回滚到某个历史 revision（非破坏：指针移动 + 按该 revision 重建语义，画布投影保留）。这是 Canon 写入，仅在用户明确要求回滚时调用；携带 expectedRevisionId 做乐观并发。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId", "revisionId"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}, "revisionId": map[string]string{"type": "string"}, "expectedRevisionId": map[string]string{"type": "string"}}}},
		{"name": "recut.worlds.export", "description": "导出一个 World 为自包含 bundle（zip，base64 返回，附 name/sizeBytes）：world.json + entities + canvas.json + world.md + 素材。用于备份或跨机迁移；大 bundle 由平台溢出为临时文件路径。只读。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}}}},
		{"name": "recut.worlds.import", "description": "从 recut.worlds.export 产出的 bundle（base64 zip）导入为一个新的本地 World。仅在用户明确要求导入时调用；name 可覆盖新世界名。", "inputSchema": map[string]any{"type": "object", "required": []string{"bundle"}, "properties": map[string]any{"bundle": map[string]string{"type": "string", "description": "recut.worlds.export 返回的 base64。"}, "name": map[string]string{"type": "string"}}}},
		{"name": "recut.worlds.proposals.list", "description": "列出该 World 画布上所有生成提案（kind=media 且带 props.proposal 的元素）：elementId/contextId/name/status/jobId/proposal。用于查看待确认/生成中/已完成/失败的媒体提案；确认权只在用户，Agent 落提案后不得代确认；status=generating 时用 jobId 调 recut.job.status 观察。只读。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}}}},
	}
	if locale == LocaleEn {
		for _, tool := range tools {
			if name, ok := tool["name"].(string); ok {
				if en, ok := worldsToolDescriptionsEN[name]; ok && en != "" {
					tool["description"] = en
				}
			}
		}
	}
	return tools
}

// worldsToolDescriptionsEN holds English tool-level descriptions for the
// recut.worlds.* surface. Schema-internal property descriptions stay Chinese,
// matching the rest of the platform tools. Missing keys fall back to zh.
var worldsToolDescriptionsEN = map[string]string{
	"recut.worlds.list":             "List all Creation Worlds (name, type, entity counts, updatedAt). Filter by text or type; paginated (limit default 50, max 50). There is no implicit current World: always pass an explicit worldId to read a World.",
	"recut.worlds.get":              "Read a World's identity, stats, current revision summary, and available entity types. It does not inline entities; use entities.list / entities.get for characters, stories, and styles.",
	"recut.worlds.entities.list":    "List entity summaries in a World. Filter by typeId, text, parentId and paginate; drafts are hidden unless includeProvisional=true. Entities never cross Worlds; entityId is only valid within its worldId.",
	"recut.worlds.entities.get":     "Read one entity: name/intro/detail, ordered attrs (text/number/boolean/select/media), relations, and references. worldId and entityId are both required and validated together.",
	"recut.worlds.evidence.list":    "Compat read of a World's legacy evidence rows (image/video/audio/text with purpose, status, collection, segment, content hash). The authoritative representation of media is the entity media attr (see brief.references[]); this tool exists only for legacy data. Archive with recut.worlds.evidence.archive.",
	"recut.worlds.brief":            "Read a World's production-ready context (default single-call entry): identity, world skill (skill/world.md in full), character/story/location/style facts (with body text), constraints, evidence (assetId or url), and references[] - anchorable items derived from entity media attrs ({id,label,kind,role,source,assetId/url,entityId}), where role is a suggested generation role (pov/color-card/environment/character/prop/style-ref/motion-ref/voice/sfx/music). selection entityIds/storyId must belong to the World; revisionId defaults to the current revision. Non-local Worlds are read-only.",
	"recut.worlds.resolve":          "Resolve a consumable CreationContext (identity, entities, constraints, references) for an explicit World/revision/selection. selection entityIds/storyId must belong to the World. Returns revisionId and canonicalHash for traceability. Agents should prefer recut.worlds.brief; resolve is for Apps/runtime.",
	"recut.worlds.readiness":        "Read a World's readiness projection (pure, side-effect free): skeleton/draft/ready level, score, and a priority-ordered missing list (reason + suggested action). scenarioId defaults by world type; choose novel-adaptation / ip-account / style-system / brand-guide / blank. When asked to complete or build a World, call this first for the work list, then draft proposals and write back after confirmation.",
	"recut.worlds.create":           "Create a Creation World. New Worlds start empty (no placeholder entities); after creation, guide the user through onboarding (upload material / paste links / dictate) and use recut.worlds.readiness for the work list. Call only when the user explicitly asks to create a World; this is a Canon write, never create proactively.",
	"recut.worlds.update":           "Modify a World's identity, metadata, or world skill (skillMd/world.md; local Worlds only - non-local returns WORLD_READ_ONLY) and produce a new revision as needed. expectedRevisionId is the optimistic-concurrency gate; a stale value returns WORLD_REVISION_CONFLICT and never silently overwrites. Call only when the user explicitly asks to modify.",
	"recut.worlds.entity":           "Entity semantics on the canvas (Plan A: all content writes go through the canvas interface). op=create makes an entity (typeId+name; with contextId it also places a projection card on that canvas layer); op=update edits first-class fields and attrs (entityId required; attrs replaces the whole array, attrPatch merges by key, omitted fields keep their value); op=archive soft-deletes the entity and its subgraph (restorable); op=restore restores; op=confirm turns an isProvisional draft into a formal entity and produces a revision. archive/restore/confirm are Canon writes and need an explicit user request.",
	"recut.worlds.entityType":       "Define/override an entity type (schema) that drives the canvas create menu and field rendering. A preset id (character, ...) updates this World's builtin copy; any other id creates a custom type. Type is schema and never produces a revision. Call only when the user explicitly asks to define a type.",
	"recut.worlds.entityTypes.list": "List a World's entity type directory (preset + custom): a type is a schema, an entity is an instance. Includes field schema, icon, and color that drive canvas cards and detail forms, plus the built-in controlled relation vocabulary.",
	"recut.worlds.relation":         "Semantic relation ops on the canvas. op=create makes an edge (fromEntityId/toEntityId/relationType; a canvas arrow + recut.worlds.promote achieves the same); op=update changes type or direction in place; op=archive soft-deletes (tombstoned, restorable); op=restore restores. A non-empty scopeEntityId makes it a local relation. All but create are Canon writes and need an explicit user request.",
	"recut.worlds.relations.list":   "List relations by entity: global relations touching the entity plus local relations scoped to it. Each carries direction (out/in/scope) and the controlled vocabulary's inverse projection; product semantics are bidirectional.",
	"recut.worlds.doc":              "Read one canvas Document (''=global canvas root, otherwise an entity's inner document): returns {elements, version, contextId}. One canvas equals one document; inner canvases are separate documents while entity/relation semantics are shared. The canvas is an expression layer: no semantic truth, no revision.",
	"recut.worlds.docs":             "List a World's canvas document index (one layer per contextId with version/elementCount/updatedAt). Use it to discover which canvas layers exist before editing: contextId ''=root, non-empty=that entity's inner canvas. Read-only.",
	"recut.worlds.doc.update":       "Apply element-level ops (insert/update/remove) inside one canvas Document: kind='entity' skeletons (refId points to an entity; props hold view prefs only) or free elements (text/image/shape/arrow/note/link/media; content in props; arrow/link are semantic edges whose fromElementId must point to an entity element in the same document - only an entity can be the start point). Placing an entity card only needs {op:'insert', element:{kind:'entity', refKind:'entity', refId}}; the server fills id=shape:<entityId>, name, and default geometry. A canvas video node must be a generation proposal, never a direct generation: element.kind='media' with props={modality:'video', proposal:{status:'pending', prompt, references:[{id,kind,role,label}], modelId?, params?, aspectRatio?, durationSec?, note?, proposedBy:'agent'}}; it generates only after the user confirms on the canvas - never call recut.video.generate for a canvas video. Returns the updated {elements, version}. Canvas elements never produce a revision. Call only when the user explicitly asks to place canvas elements; read real ids with doc first when editing existing elements. The World node id is shape:world. Geometry convention (geometry uses {x,y,width,height,zIndex}): entity projection card 264x328 (the server fills default size and grid slot), note 150x100, World node 200x200 (the latter two need explicit sizes); auto-layout may start at x step 260, y step 180. Relation arrows are projected from world_relations (id=arrow:<relationId>), do not hand-write them; free arrows / property edges use props.fromElementId (shape:<entityId> or an element id) to express the start within the same document, and props.toElementId for the end.",
	"recut.worlds.promote":          "Lift a canvas draft into a formal semantic object and produce a revision: note/text -> Entity (typeId selects the type); arrows/links are semantic edges whose start must be an entity element: entity->entity becomes a world_relations edge (relationType), entity->free element becomes a property binding (field binds to an entity property; the free element becomes a reference projection and an attr anchor element is generated, sharing one data source with the right property panel). The original canvas element stays as a projection. This is a Canon write and needs explicit user confirmation.",
	"recut.worlds.lock":             "Call once when entering a multi-step World canvas AI editing session to take an advisory AI lock: the foreground canvas flushes current changes immediately, pauses local saves, and shows 'AI is editing'. Returns {token}; always call recut.worlds.unlock at the end (it also auto-releases after 5 idle minutes). Do not lock for a single read or single write.",
	"recut.worlds.unlock":           "Release the AI canvas lock created by recut.worlds.lock. Pass the token returned by lock to avoid releasing another session's lock.",
	"recut.worlds.evidence.archive": "Archive one evidence row from the current Canon without deleting source media or versions used by old work. Call only when the user explicitly asks to remove it.",
	"recut.worlds.fork":             "Copy any World (platform/published/local) at its current revision into a new local editable World (origin=local) and return the new World. Non-local Worlds are read-only; when the user asks to modify a platform World, explain first and call this after confirmation, then continue on the copy. Call only when the user explicitly asks to fork/copy/base on a World.",
	"recut.worlds.delete":           "Permanently delete a local World: entities, relations, type directory, canvas documents, and revisions are all removed and unrecoverable. name must exactly match world.name as a second confirmation (not a lookup key). Media Assets in the library are unaffected (references are just unlinked); Projects/media Jobs bound to the World become unbound rather than dangling, and Artifact/Job binding pointers are cleared. Non-local Worlds (platform/published) are managed by the catalog lifecycle and refused; fork and delete the copy. Call only when the user explicitly asks to delete and confirms the name.",
	"recut.worlds.bind_project":     "Bind a fixed World revision to the current Project. Must be a user action, the current Project owner App, or a user-confirmed Agent call; binding is an observable cross-system state change. When the Project already has a primary binding, replacing requires replace: true, otherwise PROJECT_WORLD_ALREADY_BOUND. Binding a non-local World is not subject to the read-only gate.",
	"recut.worlds.revisions.list":   "List a World's revision history (newest first, up to 50): each with id/hash/reason/createdBy/createdAt; use recut.worlds.revert to roll back. Read-only.",
	"recut.worlds.revert":           "Roll a World back to a historical revision (non-destructive: moves the pointer and rebuilds semantics from that revision; canvas projections are kept). This is a Canon write; call only when the user explicitly asks to roll back; expectedRevisionId provides optimistic concurrency.",
	"recut.worlds.export":           "Export a World as a self-contained bundle (zip, returned as base64 with name/sizeBytes): world.json + entities + canvas.json + world.md + assets. For backup or cross-machine migration; large bundles spill to a temp file path. Read-only.",
	"recut.worlds.import":           "Import a bundle produced by recut.worlds.export (base64 zip) as a new local World. Call only when the user explicitly asks to import; name overrides the new World's name.",
	"recut.worlds.proposals.list":   "List all generation proposals on a World's canvas (kind=media elements with props.proposal): elementId/contextId/name/status/jobId/proposal. Use it to inspect pending/generating/done/failed media proposals; confirmation belongs to the user alone (never confirm on the user's behalf after placing a proposal); when status=generating, poll with jobId via recut.job.status. Read-only.",
}

func worldKindSchema() map[string]any {
	return map[string]any{"type": "string", "enum": []string{"character_ip", "creator_brand", "brand", "fiction_world", "custom"}}
}

// canvasElementConventions documents the frontend-mirrored id/geometry
// conventions the UI uses, so an AI placing elements by MCP produces cards that
// render and select exactly like the ones created interactively.
const canvasElementConventions = "几何约定（geometry 用 {x,y,width,height,zIndex}）：实体投影卡 264x328（服务端缺省自动补尺寸与网格位）、便签 150x100、World 节点 200x200（后两者需自行给尺寸）；自动排布可沿 x 每 260、y 每 180 起步。关系箭头由 world_relations 投影（id=`arrow:<relationId>`），不要手写；自由箭头/属性边用 props.fromElementId（`shape:<entityId>` 或元素 id）指向同文档的 entity 元素表达起点，props.toElementId 表达终点。"

// canvasDocUpdateSchema is the input schema of recut.worlds.doc.update:
// element-level ops applied inside one canvas document.
func canvasDocUpdateSchema() map[string]any {
	elementSchema := func(required []string) map[string]any {
		// "required" 为空时必须省略而不是 null：OpenAI 系 provider 的 function
		// schema 校验要求 required 要么缺省、要么是字符串数组，null 会被拒绝。
		schema := map[string]any{
			"type": "object",
			"properties": map[string]any{
				"id":       map[string]string{"type": "string", "description": "元素 id（= 前端 shape id 的镜像）。"},
				"kind":     map[string]string{"type": "string"},
				"refKind":  map[string]string{"type": "string"},
				"refId":    map[string]string{"type": "string"},
				"name":     map[string]string{"type": "string"},
				"props":    map[string]any{"type": "object"},
				"geometry": map[string]any{"type": "object"},
				"style":    map[string]any{"type": "object"},
				"layer":    map[string]string{"type": "string"},
			},
		}
		if len(required) > 0 {
			schema["required"] = required
		}
		return schema
	}
	return map[string]any{
		"type":     "object",
		"required": []string{"worldId", "contextId", "ops"},
		"properties": map[string]any{
			"worldId":   map[string]string{"type": "string"},
			"contextId": map[string]string{"type": "string", "description": "''=根画布，否则为某实体 id 的内层文档。"},
			"ops": map[string]any{
				"type":        "array",
				"description": "insert/update/remove 元素操作；remove 只需 element.id",
				"items": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"op":      map[string]string{"type": "string", "description": "insert | update | remove"},
						"element": elementSchema(nil),
					},
				},
			},
		},
	}
}

func worldPurposeSchema() map[string]any {
	return map[string]any{"type": "string", "enum": []string{"chat", "video", "voice", "image", "cover", "agent"}}
}

// worldsMCPTool dispatches one recut.worlds.* tool call against the platform
// WorldStore. Mutating tools are always callable through the host, but the tool
// descriptions (and the Agent guide) require explicit user intent.
func worldsMCPTool(worlds *WorldStore, name string, input map[string]any) (any, error) {
	var result any
	var err error
	switch name {
	case "recut.worlds.list":
		var items []WorldSummary
		var nextCursor string
		items, nextCursor, err = worlds.ListWorlds(ListWorldsInput{
			Text: stringValue(input["text"]), Type: WorldKind(stringValue(input["type"])),
			Cursor: stringValue(input["cursor"]), Limit: int(numericValue(input["limit"])),
		})
		result = map[string]any{"items": items, "nextCursor": nextCursor}
	case "recut.worlds.get":
		result, err = worlds.GetWorld(stringValue(input["worldId"]))
	case "recut.worlds.entities.list":
		var items []WorldEntitySummary
		var nextCursor string
		items, nextCursor, err = worlds.ListEntities(ListEntitiesInput{
			WorldID: stringValue(input["worldId"]), TypeID: stringValue(input["typeId"]),
			ParentID: stringValue(input["parentId"]), IncludeProvisional: boolValue(input["includeProvisional"]),
			Text: stringValue(input["text"]), Cursor: stringValue(input["cursor"]), Limit: int(numericValue(input["limit"])),
		})
		result = map[string]any{"items": items, "nextCursor": nextCursor}
	case "recut.worlds.entities.get":
		result, err = worlds.GetEntity(stringValue(input["worldId"]), stringValue(input["entityId"]))
	case "recut.worlds.evidence.list":
		result, err = worlds.ListEvidence(stringValue(input["worldId"]))
	case "recut.worlds.brief":
		selection := WorldSelection{}
		if err = decodeJSONMap(inputMap(input["selection"]), &selection); err != nil {
			return nil, err
		}
		result, err = worlds.Brief(BriefInput{WorldID: stringValue(input["worldId"]), RevisionID: stringValue(input["revisionId"]), Selection: selection})
	case "recut.worlds.resolve":
		selection := WorldSelection{}
		if err = decodeJSONMap(inputMap(input["selection"]), &selection); err != nil {
			return nil, err
		}
		result, err = worlds.Resolve(ResolveInput{WorldID: stringValue(input["worldId"]), RevisionID: stringValue(input["revisionId"]), Selection: selection})
	case "recut.worlds.readiness":
		result, err = worlds.Readiness(stringValue(input["worldId"]), stringValue(input["scenarioId"]))
	case "recut.worlds.create":
		identity := map[string]any{}
		_ = decodeJSONMap(inputMap(input["identity"]), &identity)
		result, err = worlds.CreateWorld(CreateWorldInput{
			Name: stringValue(input["name"]), Type: WorldKind(stringValue(input["type"])),
			Description: stringValue(input["description"]), Identity: identity,
		})
	case "recut.worlds.update":
		var parsed struct {
			Name        *string        `json:"name"`
			Description *string        `json:"description"`
			Identity    map[string]any `json:"identity"`
			SkillMd     *string        `json:"skillMd"`
		}
		if err = decodeJSONMap(input, &parsed); err != nil {
			return nil, err
		}
		result, err = worlds.UpdateWorld(UpdateWorldInput{
			WorldID: stringValue(input["worldId"]), Name: parsed.Name, Description: parsed.Description,
			Identity: parsed.Identity, SkillMd: parsed.SkillMd, ExpectedRevisionID: stringValue(input["expectedRevisionId"]), CreatedBy: "mcp",
		})
	case "recut.worlds.entity":
		worldID := stringValue(input["worldId"])
		switch stringValue(input["op"]) {
		case "create":
			createInput := UpsertEntityInput{WorldID: worldID, CreatedBy: "mcp"}
			if err = decodeJSONMap(input, &createInput); err != nil {
				return nil, err
			}
			createInput.WorldID = worldID
			created, createErr := worlds.UpsertEntity(createInput)
			if createErr != nil {
				err = createErr
				break
			}
			if raw, ok := input["contextId"]; ok {
				if _, placeErr := worlds.UpsertCanvasElement(UpsertCanvasElementInput{
					WorldID: worldID, ContextID: stringValue(raw), Kind: "entity",
					RefKind: "entity", RefID: created.ID, Name: created.Name,
					Geometry: inputMap(input["geometry"]), CreatedBy: "mcp",
				}); placeErr != nil {
					err = placeErr
					break
				}
			}
			result = created
		case "update":
			entityID := stringValue(input["entityId"])
			current, getErr := worlds.GetEntity(worldID, entityID)
			if getErr != nil {
				err = getErr
				break
			}
			// 只覆盖显式给出的字段：未给出的保持原值（避免把 name/intro/attrs 清空）。
			upd := UpsertEntityInput{
				WorldID: worldID, EntityID: entityID, TypeID: current.TypeID,
				Name: current.Name, Intro: current.Intro, Detail: current.Detail,
				ParentID: current.ParentID, ContainerRole: current.ContainerRole,
				ExpectedRevisionID: stringValue(input["expectedRevisionId"]), CreatedBy: "mcp",
			}
			if _, ok := input["name"]; ok {
				upd.Name = stringValue(input["name"])
			}
			if _, ok := input["intro"]; ok {
				upd.Intro = stringValue(input["intro"])
			}
			if _, ok := input["detail"]; ok {
				upd.Detail = stringValue(input["detail"])
			}
			if _, ok := input["parentId"]; ok {
				upd.ParentID = stringValue(input["parentId"])
			}
			if _, ok := input["containerRole"]; ok {
				upd.ContainerRole = stringValue(input["containerRole"])
			}
			baseAttrs := current.Attrs
			if raw, ok := input["attrs"]; ok {
				encoded, marshalErr := json.Marshal(raw)
				if marshalErr != nil {
					return nil, marshalErr
				}
				if unmarshalErr := json.Unmarshal(encoded, &upd.Attrs); unmarshalErr != nil {
					return nil, unmarshalErr
				}
				baseAttrs = upd.Attrs
			}
			// attrPatch：按 key 合并单条属性，避免为改一个字段回读全量 attrs（并发覆盖）。
			if raw, ok := input["attrPatch"]; ok {
				encoded, marshalErr := json.Marshal(raw)
				if marshalErr != nil {
					return nil, marshalErr
				}
				var patches []EntityAttr
				if unmarshalErr := json.Unmarshal(encoded, &patches); unmarshalErr != nil {
					return nil, unmarshalErr
				}
				upd.Attrs = mergeEntityAttrs(baseAttrs, patches)
			}
			result, err = worlds.UpsertEntity(upd)
		case "archive":
			result, err = worlds.DeleteEntity(DeleteEntityInput{WorldID: worldID, EntityID: stringValue(input["entityId"]), ExpectedRevisionID: stringValue(input["expectedRevisionId"]), CreatedBy: "mcp"})
		case "restore":
			result, err = worlds.RestoreEntity(RestoreEntityInput{WorldID: worldID, EntityID: stringValue(input["entityId"]), ExpectedRevisionID: stringValue(input["expectedRevisionId"]), CreatedBy: "mcp"})
		case "confirm":
			result, err = worlds.PromoteEntity(worldID, stringValue(input["entityId"]), stringValue(input["expectedRevisionId"]), "mcp")
		default:
			err = fmt.Errorf("unknown entity op %q (want create/update/archive/restore/confirm)", stringValue(input["op"]))
		}
	case "recut.worlds.entityType":
		fields := []EntityTypeField{}
		if raw := input["fields"]; raw != nil {
			encoded, marshalErr := json.Marshal(raw)
			if marshalErr != nil {
				return nil, marshalErr
			}
			if unmarshalErr := json.Unmarshal(encoded, &fields); unmarshalErr != nil {
				return nil, unmarshalErr
			}
		}
		result, err = worlds.UpsertEntityType(UpsertEntityTypeInput{
			WorldID: stringValue(input["worldId"]), TypeID: stringValue(input["id"]),
			Name: stringValue(input["name"]), Icon: stringValue(input["icon"]), Color: stringValue(input["color"]),
			BaseKind: stringValue(input["baseKind"]), Fields: fields, CreatedBy: "mcp",
		})
	case "recut.worlds.entityTypes.list":
		items, listErr := worlds.ListEntityTypes(stringValue(input["worldId"]))
		if listErr != nil {
			err = listErr
			break
		}
		result = map[string]any{"items": items, "relations": ListWorldRelationTypes()}
	case "recut.worlds.relation":
		op := stringValue(input["op"])
		switch op {
		case "create":
			metadata := map[string]any{}
			_ = decodeJSONMap(inputMap(input["metadata"]), &metadata)
			result, err = worlds.CreateRelation(CreateRelationInput{
				WorldID: stringValue(input["worldId"]), FromEntityID: stringValue(input["fromEntityId"]),
				ToEntityID: stringValue(input["toEntityId"]), RelationType: stringValue(input["relationType"]),
				ScopeEntityID: stringValue(input["scopeEntityId"]), Metadata: metadata,
				ExpectedRevisionID: stringValue(input["expectedRevisionId"]), CreatedBy: "mcp",
			})
		case "update":
			result, err = worlds.UpdateRelation(UpdateRelationInput{
				WorldID: stringValue(input["worldId"]), RelationID: stringValue(input["relationId"]),
				FromEntityID: stringValue(input["fromEntityId"]), ToEntityID: stringValue(input["toEntityId"]),
				RelationType:       stringValue(input["relationType"]),
				ExpectedRevisionID: stringValue(input["expectedRevisionId"]), CreatedBy: "mcp",
			})
		case "archive":
			err = worlds.DeleteRelation(stringValue(input["worldId"]), stringValue(input["relationId"]), stringValue(input["expectedRevisionId"]), "mcp")
			result = map[string]bool{"archived": err == nil}
		case "restore":
			err = worlds.RestoreRelation(stringValue(input["worldId"]), stringValue(input["relationId"]), stringValue(input["expectedRevisionId"]), "mcp")
			result = map[string]bool{"restored": err == nil}
		default:
			err = fmt.Errorf("unknown relation op %q (want create/update/archive/restore)", op)
		}

	case "recut.worlds.relations.list":
		var items []WorldEntityRelation
		items, err = worlds.ListRelations(stringValue(input["worldId"]), stringValue(input["entityId"]))
		result = map[string]any{"items": items}
	case "recut.worlds.docs":
		var items []map[string]any
		items, err = worlds.ListCanvasDocuments(stringValue(input["worldId"]))
		result = map[string]any{"items": items}
	case "recut.worlds.lock":
		owner := stringValue(input["owner"])
		if owner == "" {
			owner = "mcp"
		}
		token, acquired := worlds.canvasLock(stringValue(input["worldId"]), owner)
		result = map[string]any{"locked": true, "token": token, "owner": owner, "acquired": acquired}
		worlds.publishCanvasLock(stringValue(input["worldId"]), true, owner)
	case "recut.worlds.unlock":
		unlocked := worlds.releaseCanvasLock(stringValue(input["worldId"]), stringValue(input["token"]))
		result = map[string]any{"unlocked": unlocked}
		// 只有确实释放成功才广播：token 不匹配时锁仍在，误发 unlock 会让前台提前恢复保存。
		if unlocked {
			worlds.publishCanvasLock(stringValue(input["worldId"]), false, "")
		}
	case "recut.worlds.doc":
		doc, docErr := worlds.GetCanvasDocument(stringValue(input["worldId"]), stringValue(input["contextId"]))
		if docErr != nil {
			err = docErr
		} else {
			result = map[string]any{
				"elements": doc.Elements, "version": doc.Version, "contextId": doc.ContextID,
				// 无渲染回执：headless Agent 据此自检刚写入的布局（元素数/类型分布/包围盒/缺几何）。
				"layout": canvasLayoutSummary(doc.Elements),
			}
			if owner, _, locked := worlds.canvasLockStatus(stringValue(input["worldId"])); locked {
				result.(map[string]any)["lock"] = map[string]any{"locked": true, "owner": owner}
			}
		}
	case "recut.worlds.doc.update":
		ops := []CanvasDocOp{}
		if rawOps, ok := input["ops"].([]any); ok {
			for _, rawOp := range rawOps {
				opMap, _ := rawOp.(map[string]any)
				if opMap == nil {
					continue
				}
				op := CanvasDocOp{Op: stringValue(opMap["op"])}
				if elementMap := inputMap(opMap["element"]); len(elementMap) > 0 {
					props := map[string]any{}
					geometry := map[string]any{}
					style := map[string]any{}
					_ = decodeJSONMap(inputMap(elementMap["props"]), &props)
					_ = decodeJSONMap(inputMap(elementMap["geometry"]), &geometry)
					_ = decodeJSONMap(inputMap(elementMap["style"]), &style)
					op.Element = &UpsertCanvasElementInput{
						WorldID: stringValue(input["worldId"]), ElementID: stringValue(elementMap["id"]),
						ContextID: stringValue(input["contextId"]), Kind: stringValue(elementMap["kind"]),
						RefKind: stringValue(elementMap["refKind"]), RefID: stringValue(elementMap["refId"]), Name: stringValue(elementMap["name"]),
						Props: props, Geometry: geometry, Style: style, Layer: stringValue(elementMap["layer"]), CreatedBy: "mcp",
					}
				}
				ops = append(ops, op)
			}
		}
		var doc WorldCanvasDocument
		doc, err = worlds.UpdateCanvasDocumentOps(stringValue(input["worldId"]), stringValue(input["contextId"]), ops)
		if err == nil {
			result = map[string]any{
				"elements": doc.Elements, "version": doc.Version, "contextId": doc.ContextID,
				"layout": canvasLayoutSummary(doc.Elements),
			}
		}
	case "recut.worlds.promote":
		result, err = worlds.PromoteCanvasElement(PromoteCanvasElementInput{
			WorldID: stringValue(input["worldId"]), ElementID: stringValue(input["elementId"]),
			TypeID: stringValue(input["typeId"]), RelationType: stringValue(input["relationType"]),
			Title:              stringValue(input["title"]),
			ExpectedRevisionID: stringValue(input["expectedRevisionId"]), CreatedBy: "mcp",
		})
	case "recut.worlds.evidence.archive":
		err = worlds.ArchiveEvidence(ArchiveEvidenceInput{WorldID: stringValue(input["worldId"]), EvidenceID: stringValue(input["evidenceId"]), ExpectedRevisionID: stringValue(input["expectedRevisionId"]), CreatedBy: "mcp"})
		result = map[string]bool{"archived": err == nil}
	case "recut.worlds.fork":
		result, err = worlds.ForkWorld(ForkWorldInput{WorldID: stringValue(input["worldId"]), Name: stringValue(input["name"])})
	case "recut.worlds.delete":
		var deleted WorldDeleteResult
		deleted, err = worlds.DeleteWorld(DeleteWorldInput{
			WorldID: stringValue(input["worldId"]), ConfirmName: stringValue(input["name"]), CreatedBy: "mcp",
		})
		result = map[string]any{"deleted": true, "world": deleted}
	case "recut.worlds.revisions.list":
		var items []WorldRevisionSummary
		items, err = worlds.ListRevisions(stringValue(input["worldId"]))
		result = map[string]any{"items": items}
	case "recut.worlds.revert":
		result, err = worlds.RevertToRevision(stringValue(input["worldId"]), stringValue(input["revisionId"]), stringValue(input["expectedRevisionId"]), "mcp")
	case "recut.worlds.export":
		data, name, exportErr := worlds.ExportWorldBundle(stringValue(input["worldId"]))
		if exportErr != nil {
			err = exportErr
			break
		}
		result = map[string]any{"name": name, "sizeBytes": len(data), "base64": base64.StdEncoding.EncodeToString(data)}
	case "recut.worlds.import":
		data, decodeErr := base64.StdEncoding.DecodeString(stringValue(input["bundle"]))
		if decodeErr != nil {
			err = fmt.Errorf("bundle must be base64: %w", decodeErr)
			break
		}
		result, err = worlds.ImportWorldBundle(data, stringValue(input["name"]), "mcp")
	case "recut.worlds.proposals.list":
		worldID := stringValue(input["worldId"])
		docs, listErr := worlds.ListCanvasDocuments(worldID)
		if listErr != nil {
			err = listErr
			break
		}
		items := []map[string]any{}
		for _, doc := range docs {
			contextID, _ := doc["contextId"].(string)
			document, docErr := worlds.GetCanvasDocument(worldID, contextID)
			if docErr != nil {
				err = docErr
				break
			}
			for _, element := range document.Elements {
				if element.Kind != "media" {
					continue
				}
				proposal, _ := element.Props["proposal"].(map[string]any)
				if proposal == nil {
					continue
				}
				items = append(items, map[string]any{
					"elementId": element.ID, "contextId": contextID, "name": element.Name,
					"status": proposal["status"], "jobId": proposal["jobId"], "proposal": proposal,
				})
			}
		}
		result = map[string]any{"items": items}
	case "recut.worlds.bind_project":
		selection := WorldSelection{}
		if err = decodeJSONMap(inputMap(input["selection"]), &selection); err != nil {
			return nil, err
		}
		result, err = worlds.BindProject(BindProjectInput{
			ProjectID: stringValue(input["projectId"]), WorldID: stringValue(input["worldId"]),
			RevisionID: stringValue(input["revisionId"]), Selection: selection,
			Replace: boolValue(input["replace"]), CreatedBy: "mcp",
		})
	default:
		return nil, fmt.Errorf("unknown worlds tool %q", name)
	}
	if err != nil {
		return nil, err
	}
	// AI/Agent 写入成功后广播一条粗粒度变更通知：已打开的画布据此重新拉取，
	// 消除「headless MCP 写完 UI 不刷新」。只对写工具发，读工具无副作用。
	if worldMutatingTools[name] {
		// 会话内的每次写都续期 AI 锁（未持锁时为 no-op）。
		worlds.touchCanvasLock(stringValue(input["worldId"]))
		worlds.publishWorldChanged(name, input)
	}
	data, _ := json.Marshal(result)
	return map[string]any{"content": []map[string]string{{"type": "text", "text": string(data)}}, "structuredContent": structuredMCPContent(result)}, nil
}

// mergeEntityAttrs applies keyed attr patches onto an existing attr list. A
// patch only overrides the fields it actually carries (non-empty label/type,
// non-nil value, non-empty options), so an Agent can edit one attr without
// resending (and racing) the whole list.
func mergeEntityAttrs(existing, patches []EntityAttr) []EntityAttr {
	out := append([]EntityAttr{}, existing...)
	for _, patch := range patches {
		if patch.Key == "" {
			continue
		}
		at := -1
		for i := range out {
			if out[i].Key == patch.Key {
				at = i
				break
			}
		}
		if at < 0 {
			attr := patch
			if attr.Type == "" {
				attr.Type = "text"
			}
			if attr.Label == "" {
				attr.Label = attr.Key
			}
			out = append(out, attr)
			continue
		}
		if patch.Label != "" {
			out[at].Label = patch.Label
		}
		if patch.Type != "" {
			out[at].Type = patch.Type
		}
		if patch.Value != nil {
			out[at].Value = patch.Value
		}
		if len(patch.Options) > 0 {
			out[at].Options = patch.Options
		}
	}
	return out
}

func inputMap(value any) map[string]any {
	if mapped, ok := value.(map[string]any); ok {
		return mapped
	}
	return map[string]any{}
}

func boolValue(value any) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		parsed, _ := strconv.ParseBool(typed)
		return parsed
	default:
		return false
	}
}
