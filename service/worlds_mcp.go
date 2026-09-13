/*
 * [INPUT]: 依赖 WorldStore 与标准库 JSON 编码
 * [OUTPUT]: 对外提供全局 recut.worlds.* MCP 工具：只读 list/get/brief/readiness/entities.list/entities.get/
 * entityTypes.list/relations.list/canvas.doc/canvas.docs 无条件可发现，写 create/update/entities.upsert/
 * entities.create_child/entities.promote/entityTypes.upsert/relations.create/relations.update/canvas.doc.update/
 * canvas.promote 与 canvas.lock/unlock 常注册但仅在用户明确要求时调用；evidence/references 写入已冻结（媒体统一为实体 media attr）。
 * 返回同构 structuredContent，列表按主机规则包装为 {items:[...]}；canvas.doc/canvas.doc.update 附带 layout 只读回执。
 * 写工具成功后经 WorldEventPublisher 广播 world.changed（canvas.lock/unlock 广播对应锁事件），供已打开画布刷新
 * [POS]: service 的 Creation Worlds MCP 面；工具属于全局平台组，与 recut.project 及 recut.media 系列工具并列，
 * 不进入 per-App 工具组，Chat 与外部 Agent 在选择 App 之前即可发现
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"encoding/json"
	"fmt"
	"strconv"
)

// worldsMCPToolDefinitions returns the unconditional global Worlds tools. Read
// tools are freely discoverable; mutating tools repeat the explicit-user-action
// requirement in their descriptions and are only invoked on explicit requests.
// The locale parameter matches the platform tool list signature; Worlds tool
// descriptions are not localized yet (D12, TODO: add en branches for the
// recut.worlds.* descriptions).
func worldsMCPToolDefinitions(_ Locale) []map[string]any {
	return []map[string]any{
		{"name": "recut.worlds.list", "description": "列出全部 Creation World 的摘要（名称、类型、实体计数与最近更新时间）。按 text 过滤或按 type 筛选；结果是分页的，limit 默认 50，最大 50。没有隐式当前 World，读取任何 World 都必须先拿到显式 worldId。", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{"text": map[string]string{"type": "string", "description": "可选：按名称或描述过滤。"}, "type": worldKindSchema(), "cursor": map[string]string{"type": "string", "description": "可选：上一页返回的 nextCursor。"}, "limit": map[string]any{"type": "number", "minimum": 1, "maximum": 50}}}},
		{"name": "recut.worlds.get", "description": "读取一个 World 的身份、统计、当前 revision 摘要与可用实体种类。worldId 必填；该接口不内联实体，需要角色/故事/风格时调用 recut.worlds.entities.list / entities.get。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId"}, "properties": map[string]any{"worldId": map[string]string{"type": "string", "description": "World ID，entityId 只在同一个 worldId 内有效。"}}}},
		{"name": "recut.worlds.entities.list", "description": "列出指定 World 的实体摘要。worldId 必填；可按 kind、text 过滤并分页。实体从不跨 World 复用，entityId 只在所属 worldId 内有效。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}, "typeId": map[string]string{"type": "string", "description": "可选：按实体 type id 过滤（character/location/... 或自定义）。"}, "text": map[string]string{"type": "string"}, "cursor": map[string]string{"type": "string"}, "limit": map[string]any{"type": "number", "minimum": 1, "maximum": 50}}}},
		{"name": "recut.worlds.entities.get", "description": "读取一个实体的完整内容：name/intro/detail 基础字段、有序 attrs 属性列表（text/number/boolean/select/media 值）、关系与参考素材。worldId 与 entityId 必填，两者一起校验。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId", "entityId"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}, "entityId": map[string]string{"type": "string"}}}},
		{"name": "recut.worlds.evidence.list", "description": "读取 World 当前的多模态证据：图片、视频、声音和文字资料均包含用途、主次、集合、片段与内容哈希。它是创作前应读取的完整 Canon，不是附件名称列表。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}}}},
		{"name": "recut.worlds.brief", "description": "读取一个 World 的可生产上下文（默认单次读取入口）：一次获得身份、世界技能（skill/world.md 全文）、角色/故事/场景/风格事实（含 body 长文）、规则约束与证据（assetId 或 url）。selection 的 entityIds/storyId 必须都属于该 World；revisionId 缺省用当前 revision。非 local 世界只读。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}, "revisionId": map[string]string{"type": "string", "description": "可选：缺省为 World 当前 revision。"}, "selection": map[string]any{"type": "object", "properties": map[string]any{"storyId": map[string]string{"type": "string"}, "entityIds": map[string]any{"type": "array", "items": map[string]string{"type": "string"}}, "assetRoles": map[string]any{"type": "array", "items": map[string]string{"type": "string"}}, "purpose": worldPurposeSchema()}}}}},
		{"name": "recut.worlds.resolve", "description": "按 World、revision 与显式 selection 解析可消费的 CreationContext（身份、实体、约束、references）。selection 的 entityIds/storyId 必须都属于该 World；revisionId 缺省用当前 revision。结果带 revisionId 与 canonicalHash，可追溯。Agent 默认改用 recut.worlds.brief；resolve 保留给 App/运行时。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId", "selection"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}, "revisionId": map[string]string{"type": "string", "description": "可选：缺省为 World 当前 revision。"}, "selection": map[string]any{"type": "object", "required": []string{"purpose"}, "properties": map[string]any{"storyId": map[string]string{"type": "string"}, "entityIds": map[string]any{"type": "array", "items": map[string]string{"type": "string"}}, "assetRoles": map[string]any{"type": "array", "items": map[string]string{"type": "string"}}, "purpose": worldPurposeSchema()}}}}},
		{"name": "recut.worlds.readiness", "description": "读取一个 World 的就绪度投影（纯计算，无副作用）：skeleton/draft/ready 三档、分数与按优先级排序的 missing 清单（每项含缺失原因与建议动作）。scenarioId 缺省按 world type 自动选择场景蓝图；可选 novel-adaptation / ip-account / style-system / brand-guide / blank。用户要求完善或搭建一个 World 时，先调用本工具获取工作清单，再按建议逐项起草提案，确认后写回。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId"}, "properties": map[string]any{"worldId": map[string]string{"type": "string", "description": "World ID，entityId 只在同一个 worldId 内有效。"}, "scenarioId": map[string]any{"type": "string", "enum": []string{"novel-adaptation", "ip-account", "style-system", "brand-guide", "blank"}, "description": "可选：起点场景蓝图；缺省按世界类型推荐。"}}}},
		{"name": "recut.worlds.create", "description": "创建一个 Creation World。新世界从空开始（不再写入模板空壳实体）；创建后引导用户走 Onboarding（上传素材/粘贴链接/口述），并可用 recut.worlds.readiness 获取工作清单。只在用户明确要求创建 World 时调用；这是 Canon 写入，Agent 不得因推测有帮助而自动创建。", "inputSchema": map[string]any{"type": "object", "required": []string{"name", "type"}, "properties": map[string]any{"name": map[string]string{"type": "string"}, "type": worldKindSchema(), "description": map[string]string{"type": "string"}, "identity": map[string]any{"type": "object"}}}},
		{"name": "recut.worlds.update", "description": "修改 World 的身份、元数据或世界技能（skillMd/world.md，仅 local 世界；非 local 只读会返回 WORLD_READ_ONLY）并按需产出新 revision。expectedRevisionId 提供乐观并发门；过期时返回 WORLD_REVISION_CONFLICT，绝不静默覆盖。只在用户明确要求修改时调用。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}, "name": map[string]string{"type": "string"}, "description": map[string]string{"type": "string"}, "identity": map[string]any{"type": "object"}, "skillMd": map[string]string{"type": "string", "description": "可选：世界技能全文（world.md）。仅 local 世界可写。"}, "expectedRevisionId": map[string]string{"type": "string"}}}},
		{"name": "recut.worlds.entities.upsert", "description": "新增或修改 World 内的实体。Entity = name（名称）+ intro（介绍）+ detail（详细正文）+ attrs（有序属性列表）+ typeId（类型）。entityId 缺省为新建；提供后更新，attrs 缺省（null）保持不变、传数组则整体替换。类型预设的 locked 字段由服务端固定结构（label/type），用户值可编辑；自定义 attr 可自由增删改。每次语义写入都会产出新的不可变 revision。只在用户明确要求记录或修改设定时调用。typeId 是可扩展 type 目录：预设之外的 id 会被自动以极简字段创建。isProvisional=true 创建探索草稿（不产 revision）；parentId/containerRole 把实体放进某实体的递归容器。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId", "typeId", "name"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}, "entityId": map[string]string{"type": "string", "description": "缺省为新建实体；提供后更新该实体。"}, "typeId": map[string]any{"type": "string", "description": "实体 type id：character/location/object/story/style/rule 预设，或任意自定义 type（自动创建极简 schema）。"}, "name": map[string]string{"type": "string"}, "intro": map[string]string{"type": "string"}, "detail": map[string]string{"type": "string", "description": "详细正文（长文本）。"}, "attrs": map[string]any{"type": "array", "description": "有序属性列表；null=不修改，数组=整体替换。", "items": map[string]any{"type": "object", "properties": map[string]any{"key": map[string]string{"type": "string", "description": "稳定 id；缺省自动生成。"}, "label": map[string]string{"type": "string"}, "type": map[string]any{"type": "string", "enum": []string{"text", "textarea", "number", "boolean", "select", "media"}}, "value": map[string]any{"description": "与 type 匹配；media 为 {assetId}。"}, "options": map[string]any{"type": "array", "items": map[string]string{"type": "string"}}}}}, "parentId": map[string]string{"type": "string", "description": "可选：父实体 id，把该实体放进父实体的局部容器。"}, "containerRole": map[string]string{"type": "string", "description": "可选：容器角色，如 family/life/thought/creative_notes。"}, "isProvisional": map[string]string{"type": "boolean", "description": "可选：true 创建探索草稿，不进入 Canon 也不产 revision；用 entities.promote 转正式。"}, "expectedRevisionId": map[string]string{"type": "string"}}}},
		{"name": "recut.worlds.entities.create_child", "description": "在指定实体下创建局部子实体（递归容器）。子实体只出现在父实体的 Entity View / Subgraph，不进入 Global Graph。isProvisional=true 时创建探索草稿不产 revision。只在用户明确要求记录子实体时调用。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId", "parentId", "typeId", "name"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}, "parentId": map[string]string{"type": "string"}, "containerRole": map[string]string{"type": "string"}, "typeId": map[string]any{"type": "string", "description": "实体 type id：预设或任意自定义 type。"}, "name": map[string]string{"type": "string"}, "intro": map[string]string{"type": "string"}, "detail": map[string]string{"type": "string"}, "attrs": map[string]any{"type": "array", "items": map[string]any{"type": "object"}}, "isProvisional": map[string]string{"type": "boolean"}, "expectedRevisionId": map[string]string{"type": "string"}}}},
		{"name": "recut.worlds.entities.promote", "description": "把探索草稿实体（isProvisional=true）转为正式实体并产出 revision。这是 Canon 写入，草稿转正式是显式用户确认动作。只在用户明确要求提升草稿时调用。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId", "entityId"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}, "entityId": map[string]string{"type": "string"}, "expectedRevisionId": map[string]string{"type": "string"}}}},
		{"name": "recut.worlds.entityTypes.list", "description": "列出一个 World 的 entity type 目录（预设 + 自定义）：type 是 schema，实体是实例。目录含字段 schema、图标与配色，驱动画布卡片与详情表单。另附内置受控关系词表。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}}}},
		{"name": "recut.worlds.entityTypes.upsert", "description": "定义或覆盖一个 entity type（含 fields_json 字段 schema）。预设 id（character 等）更新本世界的内置副本；其他 id 创建世界级自定义 type。type 是 schema，不产出 revision。只在用户明确要求定义类型时调用。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId", "id", "name"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}, "id": map[string]string{"type": "string", "description": "type 标识，如 'mecha' 或预设 'character'。"}, "name": map[string]string{"type": "string"}, "icon": map[string]string{"type": "string"}, "color": map[string]string{"type": "string"}, "baseKind": map[string]string{"type": "string", "description": "可选：归属的语义大类（character/location/...），用于 readiness 归类。"}, "fields": map[string]any{"type": "array", "items": map[string]any{"type": "object"}, "description": "字段 schema 数组：[{key,label,type,required,placeholder,options,invariant}]。"}}}},
		{"name": "recut.worlds.relations.create", "description": "创建一条受控语义关系（有向边）。relationType 优先用内置词表（people/world/video/story 四组）；scopeEntityId 可选，设置后该关系只在该实体局部上下文内有效，不进全局 Canon。每次创建产出 revision。只在用户明确要求建立关系时调用。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId", "fromEntityId", "toEntityId", "relationType"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}, "fromEntityId": map[string]string{"type": "string"}, "toEntityId": map[string]string{"type": "string"}, "relationType": map[string]string{"type": "string", "description": "受控词表：father/mother/child/spouse/partner/friend/teacher/student/colleague/enemy/belongs_to/located_in/owns/contains/created_by/appears_in/followed_by/precedes/adapted_from/causes/references/depends_on/part_of；也可用自定义字符串。"}, "scopeEntityId": map[string]string{"type": "string", "description": "可选：局部关系归属的实体 id。"}, "metadata": map[string]any{"type": "object"}, "expectedRevisionId": map[string]string{"type": "string"}}}},
		{"name": "recut.worlds.relations.update", "description": "原位修改一条已存在的语义关系：relationType 与 fromEntityId/toEntityId 均为可选 patch（缺省保持原值），可换类型或换方向。关系 id 与 scope 保留，画布锚点不丢；每次实际变化产出 revision。只在用户明确要求修改关系时调用。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId", "relationId"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}, "relationId": map[string]string{"type": "string"}, "fromEntityId": map[string]string{"type": "string", "description": "可选：新的起点实体 id（换方向时与 toEntityId 交换）。"}, "toEntityId": map[string]string{"type": "string", "description": "可选：新的终点实体 id。"}, "relationType": map[string]string{"type": "string", "description": "可选：新的关系类型（受控词表 id 或自定义字符串）。"}, "expectedRevisionId": map[string]string{"type": "string"}}}},
		{"name": "recut.worlds.relations.list", "description": "按实体列出关系：全局关系（touch 该实体）+ 该实体为 scope 的局部关系。每条带 direction（out/in/scope）与受控词表的 inverse 投影，产品语义上关系是双向的。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId", "entityId"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}, "entityId": map[string]string{"type": "string"}}}},
		{"name": "recut.worlds.canvas.doc", "description": "读取一个画布 Document（''=全局画布根文档，否则为某实体 id 的内层文档）：返回 {elements, version, contextId}。一张画布 = 一个文档，内层画布是独立文档，实体/关系语义数据共享。画布是表达层，不承载语义真相，也不产出 revision。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}, "contextId": map[string]string{"type": "string", "description": "可选：缺省 '' 根画布。"}}}},
		{"name": "recut.worlds.canvas.docs", "description": "列出一个 World 的画布文档索引（每个 contextId 一层的 version/elementCount/updatedAt）。用于编辑前发现存在哪些画布层：contextId ''=根画布，非空=该实体 id 的内层画布。只读。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}}}},
		{"name": "recut.worlds.canvas.doc.update", "description": "在一个画布 Document 内应用元素级 ops（insert/update/remove）：kind='entity' 的骨干（refId 指向实体，props 只存视图偏好）或自由元素（text/image/shape/arrow/note/link，内容在 props；arrow/link 是语义边：fromElementId 必须指向同文档内的 entity 元素，只有 entity 能作为出发点）。放实体卡只需 {op:'insert', element:{kind:'entity', refKind:'entity', refId}}：服务端自动补 id=`shape:<entityId>`、名称与默认几何。返回更新后的 {elements, version}。画布元素永不产 revision。只在用户明确要求摆放画布元素时调用。改已有元素时先用 canvas.doc 读取真实 id。World 节点 id=`shape:world`。" + canvasElementConventions, "inputSchema": canvasDocUpdateSchema()},
		{"name": "recut.worlds.canvas.promote", "description": "把画布草稿提升为正式语义对象并产出 revision：note/text → Entity（可用 typeId 指定 type）；箭头/link 是有语义的边，出发点必须是 entity 元素：entity→entity 变成 world_relations（relationType），entity→自由元素变成属性绑定（field 绑定到实体属性，自由元素标记为引用投影并生成 attr 锚点元素，值与右侧属性面板共享 entity.content 单一数据源）。提升后原画布元素保留为投影。这是 Canon 写入，必须显式用户确认。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId", "elementId"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}, "elementId": map[string]string{"type": "string"}, "typeId": map[string]string{"type": "string", "description": "可选：便签→实体时的 type id。"}, "relationType": map[string]string{"type": "string", "description": "可选：箭头→关系时的 relation_type。"}, "field": map[string]string{"type": "string", "description": "可选：箭头→属性绑定时的实体属性 key。"}, "title": map[string]string{"type": "string", "description": "可选：便签→实体时的实体标题。"}, "expectedRevisionId": map[string]string{"type": "string"}}}},
		{"name": "recut.worlds.canvas.lock", "description": "进入「多步」World 画布 AI 编辑会话时调用一次，给该世界加 advisory AI 锁：前台画布会立即落盘当前改动、暂停本地保存并显示「AI 正在编辑」，避免并发覆盖。返回 {token}；会话结束务必调用 recut.worlds.canvas.unlock 释放（空闲 5 分钟也会自动释放）。单次只读或一次写入不要上锁。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}, "owner": map[string]string{"type": "string", "description": "可选：会话标识，缺省 mcp。"}}}},
		{"name": "recut.worlds.canvas.unlock", "description": "释放 recut.worlds.canvas.lock 建立的 AI 画布锁。传入 lock 返回的 token 避免误释放他人会话。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}, "token": map[string]string{"type": "string"}}}},
		{"name": "recut.worlds.evidence.archive", "description": "把一份证据从当前 Canon 归档，不删除源素材或旧作品使用的历史版本。仅在用户明确要求移除时调用。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId", "evidenceId"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}, "evidenceId": map[string]string{"type": "string"}, "expectedRevisionId": map[string]string{"type": "string"}}}},
		{"name": "recut.worlds.fork", "description": "把任意 World（平台/发布/本地）在其当前 revision 上复制为一个全新的本地可编辑 World（origin=local），返回新 World 详情。非 local 世界是只读的，用户要求修改平台世界时先说明再经用户确认调用本工具，之后在副本上继续。仅在用户明确要求 Fork/副本/基于某世界修改时调用。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}, "name": map[string]string{"type": "string", "description": "可选：新 World 名称；缺省为源名称加“副本”。"}}}},
		{"name": "recut.worlds.bind_project", "description": "把 World 的固定 revision 绑定到当前 Project。必须是用户动作、当前 Project owner App 或获得用户确认的 Agent 调用；绑定是跨系统可观察的状态变化。Project 已有 primary binding 时默认替换需提供 replace: true，否则返回 PROJECT_WORLD_ALREADY_BOUND。绑定非 local World 不受只读门禁限制。", "inputSchema": map[string]any{"type": "object", "required": []string{"projectId", "worldId", "selection"}, "properties": map[string]any{"projectId": map[string]string{"type": "string"}, "worldId": map[string]string{"type": "string"}, "revisionId": map[string]string{"type": "string"}, "selection": map[string]any{"type": "object", "required": []string{"purpose"}, "properties": map[string]any{"storyId": map[string]string{"type": "string"}, "entityIds": map[string]any{"type": "array", "items": map[string]string{"type": "string"}}, "assetRoles": map[string]any{"type": "array", "items": map[string]string{"type": "string"}}, "purpose": worldPurposeSchema()}}, "replace": map[string]string{"type": "boolean"}}}},
	}
}

func worldKindSchema() map[string]any {
	return map[string]any{"type": "string", "enum": []string{"character_ip", "creator_brand", "brand", "fiction_world", "custom"}}
}

// canvasElementConventions documents the frontend-mirrored id/geometry
// conventions the UI uses, so an AI placing elements by MCP produces cards that
// render and select exactly like the ones created interactively.
const canvasElementConventions = "几何约定（geometry 用 {x,y,width,height,zIndex}）：实体投影卡 264x328（服务端缺省自动补尺寸与网格位）、便签 150x100、World 节点 200x200（后两者需自行给尺寸）；自动排布可沿 x 每 260、y 每 180 起步。关系箭头由 world_relations 投影（id=`arrow:<relationId>`），不要手写；自由箭头/属性边用 props.fromElementId（`shape:<entityId>` 或元素 id）指向同文档的 entity 元素表达起点，props.toElementId 表达终点。"

// canvasDocUpdateSchema is the input schema of recut.worlds.canvas.doc.update:
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
		"type": "object",
		"required": []string{"worldId", "contextId", "ops"},
		"properties": map[string]any{
			"worldId":   map[string]string{"type": "string"},
			"contextId": map[string]string{"type": "string", "description": "''=根画布，否则为某实体 id 的内层文档。"},
			"ops": map[string]any{
				"type": "array",
				"description": "insert/update/remove 元素操作；remove 只需 element.id",
				"items": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"op": map[string]string{"type": "string", "description": "insert | update | remove"},
						"element": elementSchema(nil),
					},
				},
			},
		},
	}
}

func worldEntityKindSchema() map[string]any {
	return map[string]any{"type": "string", "enum": []string{"character", "location", "object", "story", "style", "rule"}}
}

func worldPurposeSchema() map[string]any {
	return map[string]any{"type": "string", "enum": []string{"chat", "video", "voice", "image", "cover", "agent"}}
}

func worldReferenceRoleSchema() map[string]any {
	return map[string]any{"type": "string", "enum": []string{"character_reference", "voice_reference", "location_reference", "style_reference", "story_reference", "brand_reference"}}
}

func worldEvidencePurposeSchema() map[string]any {
	return map[string]any{"type": "string", "enum": []string{"identity", "appearance", "wardrobe", "voice", "motion", "scene", "mood", "visual_style", "sound_style", "narrative", "rule_evidence"}}
}

func worldEvidenceStatusSchema() map[string]any {
	return map[string]any{"type": "string", "enum": []string{"primary", "supporting", "counterexample"}}
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
	case "recut.worlds.entities.upsert":
		upsertInput := UpsertEntityInput{CreatedBy: "mcp"}
		if err = decodeJSONMap(input, &upsertInput); err != nil {
			return nil, err
		}
		result, err = worlds.UpsertEntity(upsertInput)
	case "recut.worlds.entities.create_child":
		childInput := CreateChildEntityInput{CreatedBy: "mcp"}
		if err = decodeJSONMap(input, &childInput); err != nil {
			return nil, err
		}
		result, err = worlds.CreateChildEntity(childInput)
	case "recut.worlds.entities.promote":
		result, err = worlds.PromoteEntity(stringValue(input["worldId"]), stringValue(input["entityId"]), stringValue(input["expectedRevisionId"]), "mcp")
	case "recut.worlds.entityTypes.list":
		items, listErr := worlds.ListEntityTypes(stringValue(input["worldId"]))
		if listErr != nil {
			err = listErr
			break
		}
		result = map[string]any{"items": items, "relations": ListWorldRelationTypes()}
	case "recut.worlds.entityTypes.upsert":
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
	case "recut.worlds.relations.create":
		metadata := map[string]any{}
		_ = decodeJSONMap(inputMap(input["metadata"]), &metadata)
		result, err = worlds.CreateRelation(CreateRelationInput{
			WorldID: stringValue(input["worldId"]), FromEntityID: stringValue(input["fromEntityId"]),
			ToEntityID: stringValue(input["toEntityId"]), RelationType: stringValue(input["relationType"]),
			ScopeEntityID: stringValue(input["scopeEntityId"]), Metadata: metadata,
			ExpectedRevisionID: stringValue(input["expectedRevisionId"]), CreatedBy: "mcp",
		})
	case "recut.worlds.relations.update":
		result, err = worlds.UpdateRelation(UpdateRelationInput{
			WorldID: stringValue(input["worldId"]), RelationID: stringValue(input["relationId"]),
			FromEntityID: stringValue(input["fromEntityId"]), ToEntityID: stringValue(input["toEntityId"]),
			RelationType: stringValue(input["relationType"]),
			ExpectedRevisionID: stringValue(input["expectedRevisionId"]), CreatedBy: "mcp",
		})
	case "recut.worlds.relations.list":
		var items []WorldEntityRelation
		items, err = worlds.ListRelations(stringValue(input["worldId"]), stringValue(input["entityId"]))
		result = map[string]any{"items": items}
	case "recut.worlds.canvas.docs":
		var items []map[string]any
		items, err = worlds.ListCanvasDocuments(stringValue(input["worldId"]))
		result = map[string]any{"items": items}
	case "recut.worlds.canvas.lock":
		owner := stringValue(input["owner"])
		if owner == "" {
			owner = "mcp"
		}
		token, acquired := worlds.canvasLock(stringValue(input["worldId"]), owner)
		result = map[string]any{"locked": true, "token": token, "owner": owner, "acquired": acquired}
		worlds.publishCanvasLock(stringValue(input["worldId"]), true, owner)
	case "recut.worlds.canvas.unlock":
		unlocked := worlds.releaseCanvasLock(stringValue(input["worldId"]), stringValue(input["token"]))
		result = map[string]any{"unlocked": unlocked}
		// 只有确实释放成功才广播：token 不匹配时锁仍在，误发 unlock 会让前台提前恢复保存。
		if unlocked {
			worlds.publishCanvasLock(stringValue(input["worldId"]), false, "")
		}
	case "recut.worlds.canvas.doc":
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
	case "recut.worlds.canvas.doc.update":
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
	case "recut.worlds.canvas.promote":
		result, err = worlds.PromoteCanvasElement(PromoteCanvasElementInput{
			WorldID: stringValue(input["worldId"]), ElementID: stringValue(input["elementId"]),
			TypeID: stringValue(input["typeId"]), RelationType: stringValue(input["relationType"]),
			Title: stringValue(input["title"]),
			ExpectedRevisionID: stringValue(input["expectedRevisionId"]), CreatedBy: "mcp",
		})
	case "recut.worlds.evidence.archive":
		err = worlds.ArchiveEvidence(ArchiveEvidenceInput{WorldID: stringValue(input["worldId"]), EvidenceID: stringValue(input["evidenceId"]), ExpectedRevisionID: stringValue(input["expectedRevisionId"]), CreatedBy: "mcp"})
		result = map[string]bool{"archived": err == nil}
	case "recut.worlds.fork":
		result, err = worlds.ForkWorld(ForkWorldInput{WorldID: stringValue(input["worldId"]), Name: stringValue(input["name"])})
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
