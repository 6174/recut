/*
 * [INPUT]: 依赖 WorldStore 与标准库 JSON 编码
 * [OUTPUT]: 对外提供全局 recut.worlds.* MCP 工具：只读 list/get/entities.list/entities.get/resolve 无条件可发现，
 * 写 create/update/entities.upsert/references.attach 与 bind_project 常注册但仅在用户明确要求时调用；
 * 返回同构 structuredContent，列表按主机规则包装为 {items:[...]}
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
		{"name": "recut.worlds.entities.list", "description": "列出指定 World 的实体摘要。worldId 必填；可按 kind、text 过滤并分页。实体从不跨 World 复用，entityId 只在所属 worldId 内有效。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}, "kind": worldEntityKindSchema(), "text": map[string]string{"type": "string"}, "cursor": map[string]string{"type": "string"}, "limit": map[string]any{"type": "number", "minimum": 1, "maximum": 50}}}},
		{"name": "recut.worlds.entities.get", "description": "读取一个实体的完整内容、关系与语义 Asset references。worldId 与 entityId 必填，两者一起校验。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId", "entityId"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}, "entityId": map[string]string{"type": "string"}}}},
		{"name": "recut.worlds.evidence.list", "description": "读取 World 当前的多模态证据：图片、视频、声音和文字资料均包含用途、主次、集合、片段与内容哈希。它是创作前应读取的完整 Canon，不是附件名称列表。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}}}},
		{"name": "recut.worlds.resolve", "description": "按 World、revision 与显式 selection 解析可消费的 CreationContext（身份、实体、约束、references）。selection 的 entityIds/storyId 必须都属于该 World；revisionId 缺省用当前 revision。结果带 revisionId 与 canonicalHash，可追溯。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId", "selection"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}, "revisionId": map[string]string{"type": "string", "description": "可选：缺省为 World 当前 revision。"}, "selection": map[string]any{"type": "object", "required": []string{"purpose"}, "properties": map[string]any{"storyId": map[string]string{"type": "string"}, "entityIds": map[string]any{"type": "array", "items": map[string]string{"type": "string"}}, "assetRoles": map[string]any{"type": "array", "items": map[string]string{"type": "string"}}, "purpose": worldPurposeSchema()}}}}},
		{"name": "recut.worlds.create", "description": "创建一个 Creation World 并按其类型写入模板初始实体。只在用户明确要求创建 World 时调用；这是 Canon 写入，Agent 不得因推测有帮助而自动创建。", "inputSchema": map[string]any{"type": "object", "required": []string{"name", "type"}, "properties": map[string]any{"name": map[string]string{"type": "string"}, "type": worldKindSchema(), "description": map[string]string{"type": "string"}, "identity": map[string]any{"type": "object"}}}},
		{"name": "recut.worlds.update", "description": "修改 World 的身份或元数据并按需产出新 revision。expectedRevisionId 提供乐观并发门；过期时返回 WORLD_REVISION_CONFLICT，绝不静默覆盖。只在用户明确要求修改时调用。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}, "name": map[string]string{"type": "string"}, "description": map[string]string{"type": "string"}, "identity": map[string]any{"type": "object"}, "expectedRevisionId": map[string]string{"type": "string"}}}},
		{"name": "recut.worlds.entities.upsert", "description": "新增或修改 World 内的 Character、Story、Style、Rule 等实体。entityId 缺省为新建；提供后更新。每次语义写入都会产出新的不可变 revision。只在用户明确要求记录或修改设定时调用。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId", "kind", "title"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}, "entityId": map[string]string{"type": "string", "description": "缺省为新建实体；提供后更新该实体。"}, "kind": worldEntityKindSchema(), "title": map[string]string{"type": "string"}, "summary": map[string]string{"type": "string"}, "content": map[string]any{"type": "object", "description": "结构化属性；不同 kind 有不同的 JSON 契约。"}, "expectedRevisionId": map[string]string{"type": "string"}}}},
		{"name": "recut.worlds.references.attach", "description": "以语义 role 把一个已完成的全局 Asset 引用到 World（可选绑定到实体）。只记录 assetId 与语义，不复制二进制。只在用户明确要求把素材登记为参考时调用；不能自动把生成结果写进 Canon。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId", "assetId", "role"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}, "entityId": map[string]string{"type": "string"}, "assetId": map[string]string{"type": "string"}, "role": worldReferenceRoleSchema(), "label": map[string]string{"type": "string"}, "expectedRevisionId": map[string]string{"type": "string"}}}},
		{"name": "recut.worlds.evidence.attach", "description": "将用户确认的媒体或文字资料收录为多模态 Canon。服务从 assetId 推导 modality 和内容哈希；purpose、status、collection 与可选 segment 决定 AI 如何使用它。不得自动将生成结果写入。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId", "assetId", "purpose"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}, "entityId": map[string]string{"type": "string"}, "assetId": map[string]string{"type": "string"}, "purpose": worldEvidencePurposeSchema(), "status": worldEvidenceStatusSchema(), "collection": map[string]string{"type": "string"}, "label": map[string]string{"type": "string"}, "segment": map[string]any{"type": "object", "properties": map[string]any{"startSec": map[string]string{"type": "number"}, "endSec": map[string]string{"type": "number"}}}, "expectedRevisionId": map[string]string{"type": "string"}}}},
		{"name": "recut.worlds.evidence.update", "description": "修改一份已收录资料的用途、参考强度或说明，不替换原始素材且会产出新的 Canon revision。仅在用户明确要求编辑该资料时调用。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId", "evidenceId", "purpose", "status"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}, "evidenceId": map[string]string{"type": "string"}, "purpose": worldEvidencePurposeSchema(), "status": worldEvidenceStatusSchema(), "label": map[string]string{"type": "string"}, "expectedRevisionId": map[string]string{"type": "string"}}}},
		{"name": "recut.worlds.evidence.archive", "description": "把一份证据从当前 Canon 归档，不删除源素材或旧作品使用的历史版本。仅在用户明确要求移除时调用。", "inputSchema": map[string]any{"type": "object", "required": []string{"worldId", "evidenceId"}, "properties": map[string]any{"worldId": map[string]string{"type": "string"}, "evidenceId": map[string]string{"type": "string"}, "expectedRevisionId": map[string]string{"type": "string"}}}},
		{"name": "recut.worlds.bind_project", "description": "把 World 的固定 revision 绑定到当前 Project。必须是用户动作、当前 Project owner App 或获得用户确认的 Agent 调用；绑定是跨系统可观察的状态变化。Project 已有 primary binding 时默认替换需提供 replace: true，否则返回 PROJECT_WORLD_ALREADY_BOUND。", "inputSchema": map[string]any{"type": "object", "required": []string{"projectId", "worldId", "selection"}, "properties": map[string]any{"projectId": map[string]string{"type": "string"}, "worldId": map[string]string{"type": "string"}, "revisionId": map[string]string{"type": "string"}, "selection": map[string]any{"type": "object", "required": []string{"purpose"}, "properties": map[string]any{"storyId": map[string]string{"type": "string"}, "entityIds": map[string]any{"type": "array", "items": map[string]string{"type": "string"}}, "assetRoles": map[string]any{"type": "array", "items": map[string]string{"type": "string"}}, "purpose": worldPurposeSchema()}}, "replace": map[string]string{"type": "boolean"}}}},
	}
}

func worldKindSchema() map[string]any {
	return map[string]any{"type": "string", "enum": []string{"character_ip", "creator_brand", "brand", "fiction_world", "custom"}}
}

func worldEntityKindSchema() map[string]any {
	return map[string]any{"type": "string", "enum": []string{"character", "location", "story", "style", "rule", "reference"}}
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
			WorldID: stringValue(input["worldId"]), Kind: WorldEntityKind(stringValue(input["kind"])),
			Text: stringValue(input["text"]), Cursor: stringValue(input["cursor"]), Limit: int(numericValue(input["limit"])),
		})
		result = map[string]any{"items": items, "nextCursor": nextCursor}
	case "recut.worlds.entities.get":
		result, err = worlds.GetEntity(stringValue(input["worldId"]), stringValue(input["entityId"]))
	case "recut.worlds.evidence.list":
		result, err = worlds.ListEvidence(stringValue(input["worldId"]))
	case "recut.worlds.resolve":
		selection := WorldSelection{}
		if err = decodeJSONMap(inputMap(input["selection"]), &selection); err != nil {
			return nil, err
		}
		result, err = worlds.Resolve(ResolveInput{WorldID: stringValue(input["worldId"]), RevisionID: stringValue(input["revisionId"]), Selection: selection})
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
		}
		if err = decodeJSONMap(input, &parsed); err != nil {
			return nil, err
		}
		result, err = worlds.UpdateWorld(UpdateWorldInput{
			WorldID: stringValue(input["worldId"]), Name: parsed.Name, Description: parsed.Description,
			Identity: parsed.Identity, ExpectedRevisionID: stringValue(input["expectedRevisionId"]), CreatedBy: "mcp",
		})
	case "recut.worlds.entities.upsert":
		content := map[string]any{}
		_ = decodeJSONMap(inputMap(input["content"]), &content)
		result, err = worlds.UpsertEntity(UpsertEntityInput{
			WorldID: stringValue(input["worldId"]), EntityID: stringValue(input["entityId"]),
			Kind: WorldEntityKind(stringValue(input["kind"])), Title: stringValue(input["title"]),
			Summary: stringValue(input["summary"]), Content: content,
			ExpectedRevisionID: stringValue(input["expectedRevisionId"]), CreatedBy: "mcp",
		})
	case "recut.worlds.references.attach":
		result, err = worlds.AttachReference(AttachReferenceInput{
			WorldID: stringValue(input["worldId"]), EntityID: stringValue(input["entityId"]),
			AssetID: stringValue(input["assetId"]), Role: stringValue(input["role"]),
			Label: stringValue(input["label"]), ExpectedRevisionID: stringValue(input["expectedRevisionId"]), CreatedBy: "mcp",
		})
	case "recut.worlds.evidence.attach":
		var segment *WorldEvidenceSegment
		if raw := inputMap(input["segment"]); len(raw) > 0 {
			parsed := WorldEvidenceSegment{}
			if err = decodeJSONMap(raw, &parsed); err != nil {
				return nil, err
			}
			segment = &parsed
		}
		result, err = worlds.AttachReference(AttachReferenceInput{
			WorldID: stringValue(input["worldId"]), EntityID: stringValue(input["entityId"]), AssetID: stringValue(input["assetId"]),
			Purpose: stringValue(input["purpose"]), Status: stringValue(input["status"]), Collection: stringValue(input["collection"]),
			Label: stringValue(input["label"]), Segment: segment, ExpectedRevisionID: stringValue(input["expectedRevisionId"]), CreatedBy: "mcp",
		})
	case "recut.worlds.evidence.archive":
		err = worlds.ArchiveEvidence(ArchiveEvidenceInput{WorldID: stringValue(input["worldId"]), EvidenceID: stringValue(input["evidenceId"]), ExpectedRevisionID: stringValue(input["expectedRevisionId"]), CreatedBy: "mcp"})
		result = map[string]bool{"archived": err == nil}
	case "recut.worlds.evidence.update":
		result, err = worlds.UpdateEvidence(UpdateEvidenceInput{
			WorldID: stringValue(input["worldId"]), EvidenceID: stringValue(input["evidenceId"]),
			Purpose: stringValue(input["purpose"]), Status: stringValue(input["status"]), Label: stringValue(input["label"]),
			ExpectedRevisionID: stringValue(input["expectedRevisionId"]), CreatedBy: "mcp",
		})
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
