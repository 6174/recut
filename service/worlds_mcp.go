/*
 * [INPUT]: 依赖 WorldStore 与标准库 JSON 编码
 * [OUTPUT]: 对外提供全局 recut.worlds.* MCP 工具。读：list/get（单一世界读取入口：概览 + world.md（skillMd）
 * + 实体图（meta + 紧凑关系）+ 画布树 canvases + entityTypes/relationTypes + paths）/entities.list/
 * entities.get/doc/docs/revisions.list/export 无条件可发现（resolve/readiness/evidence/relations.list/
 * entityTypes.list/proposals.list 不进 AI 工具面）；
 * 写收口在画布接口（方案 A，World 即画布）：entity/relation/entityType（内容）与 create/update/fork/
 * revert/import（生命周期），加上 doc.update；
 * 语义 CRUD（entities.upsert/create_child/promote、relations.create/update、entityTypes.upsert）已下线。
 * 返回同构 structuredContent，列表按主机规则包装为 {items:[...]}；doc/doc.update 附带 layout 只读回执。
 * 写工具成功后经 WorldEventPublisher 广播 world.changed，供已打开画布刷新
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
		{"name": "recut.worlds.get", "description": "读取一个 World 的**单一入口**（轻量读取索引，恒定落在工具输出预算内），一次返回：①概览（身份、统计、当前 revision、world.md `skillMd`、可用实体种类、**类型目录 `entityTypes`** 与受控关系词表 `relationTypes`）②**实体图**（`entities` 只给身份 meta：id/typeId/name/intro；`relations` 是紧凑边列表 {from,to,role,toRole?}——结构链 has_* 与语义边都在这里）③`canvases`（**世界画布树**：每层一个节点 `{contextId, parentContextId, elementCount}`，`contextId=\"\"` 为根层；元素坐标/尺寸在 `recut.worlds.doc`）④`paths`（local 世界的稳定工作目录 `dir`/`filesRoot`；PLAN.md 等工作文档写这里，不要写通用 `files/plans/`）⑤`memory`（该世界的 **AI 记忆**，自由 markdown：用户习惯 / 偏好 / 反馈，随每次 get 返回无需单独读；`memoryBytes` 为其字节数，超过 ~6000 字节就先用 `recut.worlds.memory.update` 压缩再继续）。**正文、属性与媒体不在本调用里**：需要某个实体的 detail/attrs/media 参考时单独调 `entities.get`（单个实体全文）。worldId 必填。大世界 `graphTruncated=true` 时用 `entities.list`（typeId/parentId/text 分页）补实体。非 local 世界只读。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId"}, "properties": map[string]any{"worldId": map[string]string{"type": "string", "description": "World ID，entityId 只在同一个 worldId 内有效。"}}}},
		{"name": "recut.worlds.entities.list", "description": "列出指定 World 的实体摘要。worldId 必填；可按 typeId、text、parentId 过滤并分页。实体从不跨 World 复用，entityId 只在所属 worldId 内有效。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}, "typeId": map[string]string{"type": "string", "description": "可选：按实体 type id 过滤（character/location/... 或自定义）。"}, "parentId": map[string]string{"type": "string", "description": "可选：只列某实体的直接子设定（递归容器）。"}, "text": map[string]string{"type": "string"}, "cursor": map[string]string{"type": "string"}, "limit": map[string]any{"type": "number", "minimum": 1, "maximum": 50}}}},
		{"name": "recut.worlds.entities.get", "description": "读取一个实体的完整内容：name/intro/detail 基础字段、有序 attrs 属性列表（text/number/boolean/select/media 值）、关系与引用。worldId 与 entityId 必填，两者一起校验。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId", "entityId"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}, "entityId": map[string]string{"type": "string"}}}},
		{"name": "recut.worlds.create", "description": "创建一个 Creation World。新世界从空开始（不再写入模板空壳实体）；创建后引导用户走 Onboarding（上传素材/粘贴链接/口述）。只在用户明确要求创建 World 时调用；这是 Canon 写入，Agent 不得因推测有帮助而自动创建。", "inputSchema": map[string]any{"type": "object", "required": []string{"name", "type"}, "properties": map[string]any{"name": map[string]string{"type": "string"}, "type": worldKindSchema(), "description": map[string]string{"type": "string"}, "identity": map[string]any{"type": "object"}}}},
		{"name": "recut.worlds.update", "description": "修改 World 的身份、元数据或世界技能（skillMd/world.md，仅 local 世界；非 local 只读会返回 WORLD_READ_ONLY）并按需产出新 revision。expectedRevisionId 提供乐观并发门；过期时返回 WORLD_REVISION_CONFLICT，绝不静默覆盖。只在用户明确要求修改时调用。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}, "name": map[string]string{"type": "string"}, "description": map[string]string{"type": "string"}, "identity": map[string]any{"type": "object"}, "skillMd": map[string]string{"type": "string", "description": "可选：世界技能全文（world.md）。仅 local 世界可写。"}, "expectedRevisionId": map[string]string{"type": "string"}}}},
		{"name": "recut.worlds.memory.update", "description": "写入一个 World 的 **AI 记忆**（`memory`，自由 markdown）：记住用户的操作习惯、偏好与反馈，让以后的会话不必重复交代。**当用户给出反馈 / 纠正 / 偏好时，主动调用本工具记住**。op 三选一：`append` 末尾追加一段；`replace` 整体重写（**压缩时用**）；`replaceLine` 替换第 `line` 行（1 起；`content` 为空即删除该行，可多行）。memory 只服务 AI、不是 Canon：**不产 revision**、不参与 `expectedRevisionId`。尺寸有预算（`world.get` 返回 `memoryBytes`）：超过软上限（约 6000 字节）应尽快 `replace` 压成更短的等价文本；超过硬上限（约 16000 字节）的写入会被拒绝——先压缩再追加。非 local 世界只读。返回更新后的 {memory, lines, bytes}。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId", "op", "content"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}, "op": map[string]any{"type": "string", "enum": []string{"append", "replace", "replaceLine"}, "description": "append=末尾追加；replace=整体重写（压缩用）；replaceLine=替换第 line 行（content 为空删除该行）。"}, "content": map[string]string{"type": "string", "description": "要写入的 markdown 文本块；replaceLine 时可为空以删除该行。"}, "line": map[string]any{"type": "number", "minimum": 1, "description": "replaceLine 必填：1 起的行号。"}}}},
		{"name": "recut.worlds.doc", "description": "读取一个画布 Document（''=全局画布根文档，否则为某实体 id 的内层文档）：返回 {elements, version, contextId}。一张画布 = 一个文档，内层画布是独立文档，实体/关系语义数据共享。画布是表达层，不承载语义真相，也不产出 revision。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}, "contextId": map[string]string{"type": "string", "description": "可选：缺省 '' 根画布。"}}}},
		{"name": "recut.worlds.docs", "description": "列出一个 World 的画布文档索引（每层：`contextId`、`parentContextId`、`version`、`elementCount`、`updatedAt`）。`parentContextId` 是容纳该层实体卡 `shape:<contextId>` 的父层（`\"\"` 为根），据此可还原世界画布树。用于编辑前发现存在哪些画布层：contextId ''=根画布，非空=该实体 id 的内层画布。只读。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}}}},
		{"name": "recut.worlds.doc.update", "description": "在一个画布 Document 内应用元素级 ops（insert/update/remove）：kind='entity' 的骨干（refId 指向实体，props 只存视图偏好）或自由元素（text/image/shape/arrow/note/link/media，内容在 props；arrow/link 是语义边：fromElementId 必须指向同文档内的 entity 元素，只有 entity 能作为出发点）。放实体卡只需 {op:'insert', element:{kind:'entity', refKind:'entity', refId}}：服务端自动补 id=`shape:<entityId>`、名称与默认几何。画布视频：调用 recut.video.generate 落一个待确认的资产，再把该 assetId 写进 element.kind='media' 的 props.assetId（可带 assetStatus:'generating'）——状态与内容都读该资产，确认权只在用户，不得为画布视频直生。返回更新后的 {elements, version}。画布元素本身不产 revision，但 attr/media 元素绑定实体（refId+field+value，或 edgeType=attr 属性边）时会同步写回该实体属性，产出一次实体 revision。只在用户明确要求摆放画布元素时调用。改已有元素时先用 canvas.doc 读取真实 id。World 节点 id=`shape:world`。" + canvasElementConventions, "inputSchema": canvasDocUpdateSchema()},
		{"name": "recut.worlds.entity", "description": "画布上的实体语义操作（方案 A：内容写入统一经画布接口）。op=create 新建实体（需 typeId+name；给 contextId 时自动在该画布层放置投影卡，默认贴到已有内容右侧——要放在某个对象旁边就显式给 geometry）；op=update 修改一等字段与属性（entityId 必填；attrs 传数组整体替换、缺省保持不变；attrPatch 按 key 合并单条属性，避免为改一个字段回读全量）；op=archive 软删除（归档实体及其子图，可 restore）；op=restore 恢复。archive/restore 是 Canon 写入，需用户明确要求。写法（**正文 vs 属性，硬纪律**）：`name`/`intro`/`detail` 是一等字段，**所有长文细节写 `detail`（正文）**；`attrs` **只放真 meta**（时长/类型/画幅比例等短字段）——**把 attr 当正文用、正文空着是错的**。**各类型的 detail 语义**：`work` 的 detail = **作品基础/顶层设想**；`script` 的 detail = **完整脚本内容细节**（故事脚本/旁白台词/场景初步规划，一次写全，不是 meta）。一次视频生成的单位是画布上的视频节点（媒体元素）。预设类型（work/character/location/prop/script）的 locked 字段（含 select 的 options）由类型 schema 自动补齐：按字段 key 传值即可，不必手写 label/type/options，也不要另造同名 attr。容器（作品/项目）：任何实体都能当容器——把子实体建成 parentId=<容器 id>（语义归属，进 Canon、entities.list(parentId) 可列）并在同一次 create 里给 contextId=<容器 id>，卡片即落到容器的内层画布（可双击进入）；只给 parentId 不会在容器画布上出现卡。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId", "op"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}, "op": map[string]any{"type": "string", "enum": []string{"create", "update", "archive", "restore"}}, "entityId": map[string]string{"type": "string", "description": "update/archive/restore 必填。"}, "typeId": map[string]string{"type": "string", "description": "create 必填：预设 id（work/character/location/prop/script）或自定义 type id；预设类型的 locked 字段会自动补齐。"}, "name": map[string]string{"type": "string", "description": "实体名称。"}, "intro": map[string]string{"type": "string", "description": "一句话简介（卡片副标题）。"}, "detail": map[string]string{"type": "string", "description": "正文（一等字段，markdown）：**内容本体，长文一律写这里**（attr 只放真 meta）。作品=顶层设想；脚本=完整脚本细节（逐字旁白/台词 + 场景初步规划）。一次视频生成的单位是画布上的视频节点（媒体元素）。"}, "cover": map[string]any{"type": "object", "description": "可选：实体封面（一等基础字段，不是 attr；不可改名/删除，只能换值）。显式设置后卡片封面锁定为它；缺省时动态回落到第一条 image（其次 video）media 属性。形状与 media attr 一致：{assetId, kind?, name?} 或 {url, kind?, name?}；assetId 允许未就绪（proposed/queued/running）。清除传 null。", "properties": map[string]any{"assetId": map[string]string{"type": "string"}, "url": map[string]string{"type": "string"}, "name": map[string]string{"type": "string"}, "kind": map[string]any{"type": "string", "enum": []string{"image", "video"}}}}, "attrs": map[string]any{"type": "array", "description": "有序属性列表（数组顺序=UI 顺序）；update 时缺省保持不变、传数组整体替换。预设类型的 locked 字段按 key 命中即自动补 label/type/options。", "items": entityAttrSchema()}, "attrPatch": map[string]any{"type": "array", "description": "update 可选：按 key 合并单条属性（其余保持不变）；与 attrs 同时给出时 attrPatch 生效。", "items": entityAttrSchema()}, "parentId": map[string]string{"type": "string", "description": "可选：父实体 id——语义归属（进 Canon）。把实体放进某个容器（作品/项目）时给该容器 id；create 生效，update 时显式给出即重挂（reparent，空串=移到根；自动拒绝自环/后代环）。"}, "containerRole": map[string]string{"type": "string", "description": "可选：子实体在父容器里的角色标签（自由文本，仅展示）。"}, "contextId": map[string]string{"type": "string", "description": "create 可选：给定时在该画布层落实体投影卡（''=根画布，非空=该实体 id 的内层画布）。与 parentId 同给 = 既归属该容器、又落在它的内层画布（建容器子实体用这个）。"}, "geometry": map[string]any{"type": "object", "description": "create 可选：投影卡几何 {x,y,width,height}（世界坐标）。放卡前先用 recut.worlds.doc 读该层已有元素坐标，把卡放在它要连的对象旁边（如右侧 320px）；省略 x/y 时服务端只会贴到已有内容右侧兜底。"}, "expectedRevisionId": map[string]string{"type": "string", "description": "update/archive/restore 的乐观并发门；过期返回 WORLD_REVISION_CONFLICT。create 不需要（新增不覆盖，传了也忽略）。"}}}},
		{"name": "recut.worlds.relation", "description": "画布上的语义关系操作。op=create 建边（fromEntityId/toEntityId/fromRole，可选 toRole）；op=update 原位改语义或方向；op=archive 软删除（入墓碑，可 restore）；op=restore 恢复。scopeEntityId 非空时是实体局部关系。都是 Canon 写入，需用户明确要求。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId", "op"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}, "op": map[string]any{"type": "string", "enum": []string{"create", "update", "archive", "restore"}}, "relationId": map[string]string{"type": "string", "description": "update/archive/restore 必填。"}, "fromEntityId": map[string]string{"type": "string"}, "toEntityId": map[string]string{"type": "string"}, "fromRole": map[string]string{"type": "string", "description": "起点语义 token（缺省 references）。"}, "toRole": map[string]string{"type": "string", "description": "终点语义 token；空字符串清除（单箭头），非空即标记（双箭头）。"}, "relationType": map[string]string{"type": "string", "description": "已弃用：fromRole 的别名。"}, "scopeEntityId": map[string]string{"type": "string"}, "metadata": map[string]any{"type": "object"}, "expectedRevisionId": map[string]string{"type": "string"}}}},
		{"name": "recut.worlds.entityType", "description": "定义/覆盖一个实体类型（schema），驱动画布创建菜单与字段渲染。预设 id（character 等）更新本世界内置副本；其他 id 创建自定义 type。type 是 schema，不产 revision。只在用户明确要求定义类型时调用。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId", "id", "name"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}, "id": map[string]string{"type": "string"}, "name": map[string]string{"type": "string"}, "icon": map[string]string{"type": "string"}, "color": map[string]string{"type": "string"}, "baseKind": map[string]string{"type": "string"}, "fields": map[string]any{"type": "array", "items": map[string]any{"type": "object"}, "description": "字段 schema 数组：[{key,label,type,required,placeholder,options,invariant}]。"}}}},
		{"name": "recut.worlds.fork", "description": "把任意 World（平台/发布/本地）在其当前 revision 上复制为一个全新的本地可编辑 World（origin=local），返回新 World 详情。非 local 世界是只读的，用户要求修改平台世界时先说明再经用户确认调用本工具，之后在副本上继续。仅在用户明确要求 Fork/副本/基于某世界修改时调用。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}, "name": map[string]string{"type": "string", "description": "可选：新 World 名称；缺省为源名称加“副本”。"}}}},
		{"name": "recut.worlds.revisions.list", "description": "列出一个 World 的版本历史（最新在前，最多 50 条）：每条含 id/hash/reason/createdBy/createdAt；配合 recut.worlds.revert 回滚。只读。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}}}},
		{"name": "recut.worlds.revert", "description": "把 World 回滚到某个历史 revision（非破坏：指针移动 + 按该 revision 重建语义，画布投影保留）。这是 Canon 写入，仅在用户明确要求回滚时调用；携带 expectedRevisionId 做乐观并发。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId", "revisionId"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}, "revisionId": map[string]string{"type": "string"}, "expectedRevisionId": map[string]string{"type": "string"}}}},
		{"name": "recut.worlds.export", "description": "导出一个 World 为自包含 bundle（zip，base64 返回，附 name/sizeBytes）：world.json + entities + canvas.json + world.md + 素材。用于备份或跨机迁移；大 bundle 由平台溢出为临时文件路径。只读。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}}}},
		{"name": "recut.worlds.import", "description": "从 recut.worlds.export 产出的 bundle（base64 zip）导入为一个新的本地 World。仅在用户明确要求导入时调用；name 可覆盖新世界名。", "inputSchema": map[string]any{"type": "object", "required": []string{"bundle"}, "properties": map[string]any{"bundle": map[string]string{"type": "string", "description": "recut.worlds.export 返回的 base64。"}, "name": map[string]string{"type": "string"}}}},
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
	"recut.worlds.list":           "List all Creation Worlds (name, type, entity counts, updatedAt). Filter by text or type; paginated (limit default 50, max 50). There is no implicit current World: always pass an explicit worldId to read a World.",
	"recut.worlds.get":            "Read a World's SINGLE entry point: a small read index that stays within the tool output budget. Returns (1) overview: identity, stats, current revision, world.md (skillMd), available entity kinds, the type directory (entityTypes) and relation vocabulary (relationTypes); (2) the entity graph: entities (identity meta only: id/typeId/name/intro) and relations (compact edges {from,to,role,toRole?}, structural has_* and semantic alike); (3) canvases: the world's canvas tree, one node per layer {contextId,parentContextId,elementCount} (contextId \"\" = root; positions live in recut.worlds.doc); (4) paths: the stable working directory (dir/filesRoot) for local Worlds — write PLAN.md and working docs there, not in the shared files/plans/; (5) memory: the World's AI memory (free-form markdown of user habits/preferences/feedback), always inlined so no separate read is needed, with memoryBytes its byte length (once over ~6000 bytes, compact it with recut.worlds.memory.update first). Bodies, attrs and media are NOT here: call entities.get for one entity's full detail/attrs/media. worldId required. When graphTruncated=true page with entities.list (typeId/parentId/text). Non-local Worlds are read-only.",
	"recut.worlds.entities.list":  "List entity summaries in a World. Filter by typeId, text, parentId and paginate. Entities never cross Worlds; entityId is only valid within its worldId.",
	"recut.worlds.entities.get":   "Read one entity: name/intro/detail, ordered attrs (text/number/boolean/select/media), relations, and references. worldId and entityId are both required and validated together.",
	"recut.worlds.create":         "Create a Creation World. New Worlds start empty (no placeholder entities); after creation, guide the user through onboarding (upload material / paste links / dictate). Call only when the user explicitly asks to create a World; this is a Canon write, never create proactively.",
	"recut.worlds.update":         "Modify a World's identity, metadata, or world skill (skillMd/world.md; local Worlds only - non-local returns WORLD_READ_ONLY) and produce a new revision as needed. expectedRevisionId is the optimistic-concurrency gate; a stale value returns WORLD_REVISION_CONFLICT and never silently overwrites. Call only when the user explicitly asks to modify.",
	"recut.worlds.memory.update":  "Write a World's AI memory (memory; free-form markdown): remember the user's working habits, preferences and feedback so later sessions do not have to be told again. Call it proactively whenever the user gives feedback, a correction, or a preference. op is one of: append (add a block at the end); replace (rewrite the whole memory - the compression op); replaceLine (swap line N, 1-based; empty content deletes that line, content may span several lines). Memory serves the Agent only and is NOT Canon: it produces no revision and ignores expectedRevisionId. It is budgeted (world.get returns memoryBytes): once over the soft limit (~6000 bytes) compact it to shorter equivalent text with replace; a write over the hard limit (~16000 bytes) is rejected, so compact before adding more. Non-local Worlds are read-only. Returns the updated {memory, lines, bytes}.",
	"recut.worlds.entity":         "Entity semantics on the canvas (Plan A: all content writes go through the canvas interface). op=create makes an entity (typeId+name; with contextId it also places a projection card on that canvas layer); op=update edits first-class fields and attrs (entityId required; attrs replaces the whole array, attrPatch merges by key, omitted fields keep their value); op=archive soft-deletes the entity and its subgraph (restorable); op=restore restores. archive/restore are Canon writes and need an explicit user request. Authoring (body vs attrs, HARD RULE): name/intro/detail are first-class - put ALL long-form detail in detail and keep attrs for TRUE META only (time/type/aspect); using an attr as the body while detail sits empty is wrong. Per-type detail: work.detail = the work's foundational/top-level concept; script.detail = the COMPLETE script content details (screenplay/narration/dialogue + initial scene plan, write it all - it is not meta). A video generation unit is a canvas video node (media element), not an entity type. Preset types (work/character/location/prop/script) auto-fill their locked fields (including select options) from the type schema: pass the field key and value, never hand-write label/type/options or add a duplicate attr. Container (work/project): any entity can hold children - build inside a container by creating each child with parentId=<container id> (semantic containment, enters Canon, listable via entities.list(parentId)) plus contextId=<container id> in the same create call so its card lands on the container's inner canvas; parentId alone places no card. On update, supplying parentId reparents the entity (empty string moves it to root; self/descendant cycles are rejected). expectedRevisionId only gates update/archive/restore; create ignores it.",
	"recut.worlds.entityType":     "Define/override an entity type (schema) that drives the canvas create menu and field rendering. A preset id (character, ...) updates this World's builtin copy; any other id creates a custom type. Type is schema and never produces a revision. Call only when the user explicitly asks to define a type.",
	"recut.worlds.relation":       "Semantic relation ops on the canvas. op=create makes an edge (fromEntityId/toEntityId/fromRole, optional toRole); op=update changes the endpoint semantics or direction in place (toRole accepts an empty string to clear it); op=archive soft-deletes (tombstoned, restorable); op=restore restores. A non-empty scopeEntityId makes it a local relation. All but create are Canon writes and need an explicit user request.",
	"recut.worlds.doc":            "Read one canvas Document (''=global canvas root, otherwise an entity's inner document): returns {elements, version, contextId}. One canvas equals one document; inner canvases are separate documents while entity/relation semantics are shared. The canvas is an expression layer: no semantic truth, no revision.",
	"recut.worlds.docs":           "List a World's canvas document index (one layer per contextId with parentContextId/version/elementCount/updatedAt; parentContextId is the layer holding this layer's entity card shape:<contextId>, \"\" for the root), so the canvas tree is explicit. Use it to discover which canvas layers exist before editing: contextId ''=root, non-empty=that entity's inner canvas. Read-only.",
	"recut.worlds.doc.update":     "Apply element-level ops (insert/update/remove) inside one canvas Document: kind='entity' skeletons (refId points to an entity; props hold view prefs only) or free elements (text/image/shape/arrow/note/link/media; content in props; arrow/link are semantic edges whose fromElementId must point to an entity element in the same document - only an entity can be the start point). Placing an entity card only needs {op:'insert', element:{kind:'entity', refKind:'entity', refId}}; the server fills id=shape:<entityId>, name, and default geometry. A canvas video: call recut.video.generate to land a pending asset, then write that assetId into element.kind='media' props.assetId (optionally with assetStatus:'generating') - the canvas reads the asset's status and content, and confirmation belongs to the user alone; never generate a canvas video directly. Returns the updated {elements, version}. Canvas elements themselves produce no revision, but an attr/media element bound to an entity (refId+field+value, or an edgeType=attr edge) syncs back into that entity's attrs, producing one entity revision. Call only when the user explicitly asks to place canvas elements; read real ids with doc first when editing existing elements. The World node id is shape:world. Geometry convention (geometry uses {x,y,width,height,zIndex}): entity projection card 264x328 (the server fills default size and grid slot), note 150x100, World node 200x200 (the latter two need explicit sizes); auto-layout may start at x step 260, y step 180. Lay out the production shape (work→script) as a mind-map: same depth in the same column, children one column to the right of the parent and vertically centred (column pitch ~360px, row pitch ~380px, parent y ~ median of its children's y); never pile the cards; draw tree lines from the has_script relation, do not hand-write arrows. A video generation unit is a canvas video node (media element), not an entity. Relation arrows are projected from world_relations (id=arrow:<relationId>), do not hand-write them; free arrows / property edges use props.fromElementId (shape:<entityId> or an element id) to express the start within the same document, and props.toElementId for the end.",
	"recut.worlds.fork":           "Copy any World (platform/published/local) at its current revision into a new local editable World (origin=local) and return the new World. Non-local Worlds are read-only; when the user asks to modify a platform World, explain first and call this after confirmation, then continue on the copy. Call only when the user explicitly asks to fork/copy/base on a World.",
	"recut.worlds.revisions.list": "List a World's revision history (newest first, up to 50): each with id/hash/reason/createdBy/createdAt; use recut.worlds.revert to roll back. Read-only.",
	"recut.worlds.revert":         "Roll a World back to a historical revision (non-destructive: moves the pointer and rebuilds semantics from that revision; canvas projections are kept). This is a Canon write; call only when the user explicitly asks to roll back; expectedRevisionId provides optimistic concurrency.",
	"recut.worlds.export":         "Export a World as a self-contained bundle (zip, returned as base64 with name/sizeBytes): world.json + entities + canvas.json + world.md + assets. For backup or cross-machine migration; large bundles spill to a temp file path. Read-only.",
	"recut.worlds.import":         "Import a bundle produced by recut.worlds.export (base64 zip) as a new local World. Call only when the user explicitly asks to import; name overrides the new World's name.",
}

func worldKindSchema() map[string]any {
	return map[string]any{"type": "string", "enum": []string{"character_ip", "creator_brand", "brand", "fiction_world", "custom"}}
}

// entityAttrSchema is the canonical shape of one entity attribute, shared by
// recut.worlds.entity's attrs (full replace) and attrPatch (by-key merge) so an
// Agent can shape a row correctly on the first call instead of probing errors.
func entityAttrSchema() map[string]any {
	return map[string]any{"type": "object", "properties": map[string]any{
		"key":     map[string]string{"type": "string", "description": "属性 key。用预设类型的字段 key（如 script 的 logline/durationSec/aspectRatio/platform）即命中该 locked 字段，label/type/options 由 schema 固定；留空时服务端生成稳定 key（a_...）。**attr 只放真 meta（时间/类型/比例/景别/镜号），长文细节写实体 detail 正文**。"},
		"label":   map[string]string{"type": "string", "description": "显示名；缺省=key。命中预设字段时以 schema 为准。"},
		"type":    map[string]any{"type": "string", "enum": []string{"text", "textarea", "number", "boolean", "select", "media"}, "description": "值类型；缺省 text。命中预设字段时以 schema 为准。"},
		"value":   map[string]any{"description": "text/textarea=字符串，number=数字，boolean=布尔，select=选项字符串（须在 options 内），media={assetId,kind?,name?}。"},
		"options": map[string]any{"type": "array", "items": map[string]string{"type": "string"}, "description": "仅 select 需要。命中预设 locked 字段时由 schema 自动补齐，无需手写；只有自定义 select 必须自带。"},
	}}
}

// canvasElementConventions documents the frontend-mirrored id/geometry
// conventions the UI uses, so an AI placing elements by MCP produces cards that
// render and select exactly like the ones created interactively.
const canvasElementConventions = "几何约定（geometry 用 {x,y,width,height,zIndex}，世界坐标）：实体投影卡 264x328（服务端缺省自动补尺寸）、便签 150x100、World 节点 200x200（后两者需自行给尺寸）。**摆位先看画布**：放新元素前先用 recut.worlds.doc 读该层已有元素的 geometry，把新卡显式放在**它要连的那个元素旁边**（例如其右侧 320px、纵向对齐），不要留空让服务端兜底——不传 x/y 时服务端只会把元素贴到已有内容的右侧，仍可能离你要连的对象很远。关系箭头由 world_relations 投影（id=`arrow:<relationId>`），不要手写；自由箭头/属性边用 props.fromElementId（`shape:<entityId>` 或元素 id）指向同文档的 entity 元素表达起点，props.toElementId 表达终点。**生产结构（`work→script`）按思维导图分层排版**：同层同列、子节点在父节点右侧一列并纵向居中（列距 ≈360px、行距 ≈380px、父节点 y ≈ 子级 y 的中位数），别堆成一坨；树线用 has_script 的关系投影，不手写箭头。一次视频生成的单位是画布上的视频节点（媒体元素），不是实体。"

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
				"geometry": map[string]any{"type": "object", "description": "世界坐标 {x,y,width,height,zIndex}。放元素前先用 recut.worlds.doc 读已有元素坐标，把新元素放在它要连的对象旁边（如右侧 320px）；省略 x/y 时服务端只会贴到已有内容右侧兜底。"},
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
		// 单一世界读取入口：概览 + 实体图（meta/紧凑关系）+ paths。
		result, err = worlds.GetWorldContext(BriefInput{WorldID: stringValue(input["worldId"])})
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
	case "recut.worlds.memory.update":
		// Memory is not Canon: no revision, no broadcast — just worlds.memory_md.
		result, err = worlds.UpdateWorldMemory(UpdateWorldMemoryInput{
			WorldID: stringValue(input["worldId"]), Op: stringValue(input["op"]),
			Content: stringValue(input["content"]), Line: int(numericValue(input["line"])), CreatedBy: "mcp",
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
			// contextId 落投影卡：走画布文档 ops，与 UI / doc.update 的卡完全同构
			// （服务端补 id=`shape:<entityId>`、名称与默认几何），重复插入同一
			// 实体只替换同一张卡，不会给同一实体留下第二张卡。
			if raw, ok := input["contextId"]; ok {
				contextID := stringValue(raw)
				ops := []CanvasDocOp{{Op: "insert", Element: &UpsertCanvasElementInput{
					WorldID: worldID, ContextID: contextID, Kind: "entity",
					RefKind: "entity", RefID: created.ID, Name: created.Name,
					Geometry: inputMap(input["geometry"]), CreatedBy: "mcp",
				}}}
				if _, placeErr := worlds.UpdateCanvasDocumentOps(worldID, contextID, ops); placeErr != nil {
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
				Cover:    current.Cover,
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
			if raw, ok := input["cover"]; ok {
				if raw == nil {
					// Explicit null clears the cover (falls back to attr inference).
					upd.Cover = &WorldEntityCover{}
				} else {
					encoded, marshalErr := json.Marshal(raw)
					if marshalErr != nil {
						return nil, marshalErr
					}
					var cover WorldEntityCover
					if unmarshalErr := json.Unmarshal(encoded, &cover); unmarshalErr != nil {
						return nil, unmarshalErr
					}
					upd.Cover = &cover
				}
			}
			if _, ok := input["parentId"]; ok {
				upd.ParentID = stringValue(input["parentId"])
				upd.ParentIDSet = true
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
		default:
			err = fmt.Errorf("unknown entity op %q (want create/update/archive/restore)", stringValue(input["op"]))
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
	case "recut.worlds.relation":
		op := stringValue(input["op"])
		switch op {
		case "create":
			metadata := map[string]any{}
			_ = decodeJSONMap(inputMap(input["metadata"]), &metadata)
			result, err = worlds.CreateRelation(CreateRelationInput{
				WorldID: stringValue(input["worldId"]), FromEntityID: stringValue(input["fromEntityId"]),
				ToEntityID: stringValue(input["toEntityId"]), FromRole: relationFromRoleInput(input), ToRole: stringValue(input["toRole"]),
				ScopeEntityID: stringValue(input["scopeEntityId"]), Metadata: metadata,
				ExpectedRevisionID: stringValue(input["expectedRevisionId"]), CreatedBy: "mcp",
			})
		case "update":
			var toRole *string
			if _, ok := input["toRole"]; ok {
				value := stringValue(input["toRole"])
				toRole = &value
			}
			result, err = worlds.UpdateRelation(UpdateRelationInput{
				WorldID: stringValue(input["worldId"]), RelationID: stringValue(input["relationId"]),
				FromEntityID: stringValue(input["fromEntityId"]), ToEntityID: stringValue(input["toEntityId"]),
				FromRole:           relationFromRoleInput(input),
				ToRole:             toRole,
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

	case "recut.worlds.docs":
		var items []map[string]any
		items, err = worlds.ListCanvasDocuments(stringValue(input["worldId"]))
		result = map[string]any{"items": items}
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
	case "recut.worlds.fork":
		result, err = worlds.ForkWorld(ForkWorldInput{WorldID: stringValue(input["worldId"]), Name: stringValue(input["name"])})
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

// relationFromRoleInput resolves the source-end role across the new fromRole
// field and the legacy relationType alias (new field wins).
func relationFromRoleInput(input map[string]any) string {
	if value := stringValue(input["fromRole"]); value != "" {
		return value
	}
	return stringValue(input["relationType"])
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
