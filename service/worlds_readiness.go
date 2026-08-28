/*
 * [INPUT]: 依赖 WorldStore 的 worlds/world_entities/world_asset_refs/world_revisions 表与既有 closed 集合
 * [OUTPUT]: 对外提供 World Readiness 就绪度投影：五份内置场景蓝图（小说改编/IP 账号/风格体系/品牌手册/从零开始）、
 * skeleton/draft/ready 三档判定、按优先级排序的 missing 清单（含原因与建议动作）、空壳实体的忽略规则；
 * 同一纯函数同时服务 HTTP/MCP readiness 端点与 brief.missing 填充
 * [POS]: service 的 Creation Worlds Onboarding 度量层；readiness 是纯计算投影，不建表、不持久化、
 * 不进入 canonical；蓝图只约束 missing 度量与建议，绝不限制 Canon 的自由增删
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

// Scenario IDs (closed set, v1). A scenario is a start-point blueprint: it
// declares what a usable world of that shape needs so users never have to
// invent the structure themselves. Blueprints measure and suggest; they never
// restrict what users may store.
const (
	ScenarioNovelAdaptation = "novel-adaptation"
	ScenarioIPAccount       = "ip-account"
	ScenarioStyleSystem     = "style-system"
	ScenarioBrandGuide      = "brand-guide"
	ScenarioBlank           = "blank"
)

var scenarioIDs = map[string]bool{
	ScenarioNovelAdaptation: true, ScenarioIPAccount: true, ScenarioStyleSystem: true,
	ScenarioBrandGuide: true, ScenarioBlank: true,
}

// defaultScenarioForType maps each world type to its recommended start-point
// scenario. The create dialog seeds its picker from the same mapping.
var defaultScenarioForType = map[WorldKind]string{
	WorldFiction:      ScenarioNovelAdaptation,
	WorldCreatorBrand: ScenarioIPAccount,
	WorldCharacterIP:  ScenarioStyleSystem,
	WorldBrand:        ScenarioBrandGuide,
	WorldCustom:       ScenarioBlank,
}

// resolveScenario normalizes the caller's scenario hint: unknown IDs fall back
// to the type default so a stale client can never poison the measurement.
func resolveScenario(worldType WorldKind, scenarioID string) string {
	if scenarioIDs[scenarioID] {
		return scenarioID
	}
	if scenario, ok := defaultScenarioForType[worldType]; ok {
		return scenario
	}
	return ScenarioBlank
}

// readinessFieldSpec names one required content field on an entity kind.
type readinessFieldSpec struct {
	key     string
	title   string // zh, user-facing
	reason  string
}

// readinessEntitySpec declares how many substantive entities of one kind the
// blueprint expects, and which fields matter on them.
type readinessEntitySpec struct {
	kind     WorldEntityKind
	title    string
	count    int // required substantive entities (0 = optional, measured only)
	fields   []readinessFieldSpec
}

// readinessEvidenceSpec declares the evidence expectation of a blueprint.
type readinessEvidenceSpec struct {
	purpose  string
	modality string
	count    int
	title    string
	suggestion string
}

// scenarioBlueprint is the declarative target shape of one start-point.
type scenarioBlueprint struct {
	id           string
	entities     []readinessEntitySpec
	evidence     []readinessEvidenceSpec
	requireSkill bool
}

var scenarioBlueprints = map[string]scenarioBlueprint{
	// 小说/故事 → 故事世界：角色群、故事线、场景与世界观规则。
	ScenarioNovelAdaptation: {
		entities: []readinessEntitySpec{
			{kind: EntityCharacter, title: "主角角色", count: 1, fields: []readinessFieldSpec{
				{key: "appearance", title: "外貌与标志", reason: "AI 生成画面时不知道这个角色长什么样"},
				{key: "personality", title: "性格与行为", reason: "没有性格依据，故事与对白会失真"},
				{key: "voice", title: "声音与说话方式", reason: "配音与对白没有语气基准"},
			}},
			{kind: EntityStory, title: "故事线", count: 1, fields: []readinessFieldSpec{
				{key: "premise", title: "故事前提", reason: "AI 不知道这个世界想讲什么"},
			}},
			{kind: EntityLocation, title: "主要场景", count: 1, fields: []readinessFieldSpec{
				{key: "description", title: "场景描述", reason: "画面没有可依赖的空间与氛围依据"},
			}},
		},
	},
	// IP/社媒账号 → 内容账号世界：人设、内容风格与代表作证据。
	ScenarioIPAccount: {
		entities: []readinessEntitySpec{
			{kind: EntityCharacter, title: "账号人设", count: 1, fields: []readinessFieldSpec{
				{key: "personality", title: "人设与语气", reason: "没有语气基准，AI 写出的内容会不像这个账号"},
				{key: "voice", title: "表达方式", reason: "句式与表达习惯缺少可执行描述"},
			}},
			{kind: EntityStyle, title: "内容风格", count: 1, fields: []readinessFieldSpec{
				{key: "guidance", title: "内容风格规范", reason: "选题域与语言规范缺失，产出会漂移"},
			}},
		},
		evidence: []readinessEvidenceSpec{
			{purpose: "visual_style", modality: "image", count: 2, title: "代表作或视觉资产", suggestion: "上传头像/封面/代表作截图，或粘贴账号链接让 AI 收集"},
		},
		requireSkill: true,
	},
	// 风格表达 → 风格生产世界（小黑同款）：风格 DNA、规则集、示例证据与生产工作流。
	ScenarioStyleSystem: {
		entities: []readinessEntitySpec{
			{kind: EntityStyle, title: "风格 DNA", count: 1, fields: []readinessFieldSpec{
				{key: "guidance", title: "风格 guidance", reason: "AI 生成时没有可执行的风格口径"},
			}},
			{kind: EntityRule, title: "创作规则", count: 1},
		},
		evidence: []readinessEvidenceSpec{
			{purpose: "visual_style", modality: "image", count: 3, title: "风格示例图", suggestion: "上传示例图集，或让 AI 生成候选后挑选采纳"},
		},
		requireSkill: true,
	},
	// 品牌手册 → 品牌世界：视觉系统、规则与 VI 证据。
	ScenarioBrandGuide: {
		entities: []readinessEntitySpec{
			{kind: EntityStyle, title: "视觉系统", count: 1, fields: []readinessFieldSpec{
				{key: "guidance", title: "视觉与文案规范", reason: "色板、字体与用法缺少可执行描述"},
			}},
			{kind: EntityRule, title: "品牌规则", count: 1},
		},
		evidence: []readinessEvidenceSpec{
			{purpose: "visual_style", modality: "image", count: 1, title: "Logo 与 VI 资产", suggestion: "上传品牌手册或 logo 源文件"},
		},
	},
	// 从零开始：不假设结构，任何有实质的实体即可离开 skeleton。
	ScenarioBlank: {
		entities: []readinessEntitySpec{},
	},
}

// requiredFieldsByKind is the substance registry: which content fields make an
// entity "real" for readiness purposes. Mirrors the web form field registry.
var requiredFieldsByKind = map[WorldEntityKind][]string{
	EntityCharacter: {"appearance", "personality", "voice", "invariants"},
	EntityStory:     {"premise", "moment", "emotion"},
	EntityStyle:     {"visual", "guidance", "avoid"},
	EntityRule:      {"text"},
	EntityLocation:  {"description", "atmosphere"},
	EntityReference: {},
}

// entityContentFields ignored when judging substance: structural metadata keys
// that never carry facts on their own.
var nonSubstantiveContentKeys = map[string]bool{"kind": true, "type": true}

// MissingItem is one actionable gap: what is missing, why it matters and what
// to do next. The ordered list is the single source for the onboarding guide
// card, the wizard steps and brief.missing.
type MissingItem struct {
	ID         string `json:"id"`
	Kind       string `json:"kind"` // entity | field | evidence | skill | identity
	Title      string `json:"title"`
	Reason     string `json:"reason,omitempty"`
	Suggestion string `json:"suggestion,omitempty"`
}

// WorldReadiness is the readiness projection of one world under one scenario.
// It is computed, never persisted; score exists only for progress UI.
type WorldReadiness struct {
	ScenarioID string        `json:"scenarioId"`
	Level      string        `json:"level"` // skeleton | draft | ready
	Score      int           `json:"score"`
	Missing    []MissingItem `json:"missing"`
}

const (
	ReadinessSkeleton = "skeleton"
	ReadinessDraft    = "draft"
	ReadinessReady    = "ready"
)

// readinessEntitySnapshot is the minimal entity view the pure function needs.
type readinessEntitySnapshot struct {
	Kind    WorldEntityKind
	Content map[string]any
}

type readinessEvidenceSnapshot struct {
	Purpose  string
	Modality string
}

// readinessSnapshot is the world state readiness measures. Both the DB-backed
// Readiness endpoint and the Brief projection build one and call compute.
type readinessSnapshot struct {
	WorldType WorldKind
	SkillMd   string
	Identity  map[string]any
	Entities  []readinessEntitySnapshot
	Evidence  []readinessEvidenceSnapshot
}

// entitySubstantive reports whether an entity carries any real fact. Entities
// whose every registered field is empty are legacy template shells (or never
// finished drafts): readiness ignores them instead of producing noise.
func entitySubstantive(entity readinessEntitySnapshot) bool {
	content := entity.Content
	if len(content) == 0 {
		return false
	}
	if body, ok := content["body"].(string); ok && strings.TrimSpace(body) != "" {
		return true
	}
	for _, key := range requiredFieldsByKind[entity.Kind] {
		if value, ok := content[key].(string); ok && strings.TrimSpace(value) != "" {
			return true
		}
	}
	// Unknown/custom keys still count when they carry non-empty strings, so a
	// freely extended Canon is never misjudged as empty.
	for key, raw := range content {
		if nonSubstantiveContentKeys[key] {
			continue
		}
		if value, ok := raw.(string); ok && strings.TrimSpace(value) != "" {
			return true
		}
	}
	return false
}

// computeReadiness is the single pure function behind readiness: same output
// for the HTTP/MCP endpoint and brief.missing, so UI and Agent never disagree.
func computeReadiness(snapshot readinessSnapshot, scenarioID string) WorldReadiness {
	scenario := resolveScenario(snapshot.WorldType, scenarioID)
	blueprint := scenarioBlueprints[scenario]
	missing := []MissingItem{}

	// Index substantive entities by kind, preserving store order.
	substantive := map[WorldEntityKind][]readinessEntitySnapshot{}
	substantiveCount := 0
	for _, entity := range snapshot.Entities {
		if !entitySubstantive(entity) {
			continue
		}
		substantive[entity.Kind] = append(substantive[entity.Kind], entity)
		substantiveCount++
	}
	// Skeleton is about substance of any kind: any real evidence counts even
	// when the scenario declares no evidence expectation (e.g. blank).
	totalEvidence := len(snapshot.Evidence)

	// 1. Field gaps on the first substantive entity of each expected kind —
	// the highest-signal actions ("what to fill first").
	for _, spec := range blueprint.entities {
		instances := substantive[spec.kind]
		if len(instances) == 0 {
			continue
		}
		primary := instances[0]
		for _, field := range spec.fields {
			value, _ := primary.Content[field.key].(string)
			if strings.TrimSpace(value) == "" {
				missing = append(missing, MissingItem{
					ID:         fmt.Sprintf("%s.primary.%s", spec.kind, field.key),
					Kind:       "field",
					Title:      fmt.Sprintf("%s的%s", spec.title, field.title),
					Reason:     field.reason,
					Suggestion: "手动填写，或让 AI 根据已有素材起草",
				})
			}
		}
	}

	// 2. Entity count gaps.
	for _, spec := range blueprint.entities {
		if spec.count > 0 && len(substantive[spec.kind]) < spec.count {
			missing = append(missing, MissingItem{
				ID:         fmt.Sprintf("entity.%s", spec.kind),
				Kind:       "entity",
				Title:      spec.title,
				Reason:     "这个世界还没有任何有实质内容的" + spec.title,
				Suggestion: "手动添加，或让 AI 从素材中提取起草",
			})
		}
	}

	// 3. Evidence expectations.
	for _, spec := range blueprint.evidence {
		count := 0
		for _, evidence := range snapshot.Evidence {
			if (spec.purpose == "" || evidence.Purpose == spec.purpose) && evidence.Modality == spec.modality {
				count++
			}
		}
		if count < spec.count {
			missing = append(missing, MissingItem{
				ID:         fmt.Sprintf("evidence.%s.%s", spec.purpose, spec.modality),
				Kind:       "evidence",
				Title:      spec.title,
				Reason:     fmt.Sprintf("至少需要 %d 份，当前 %d 份", spec.count, count),
				Suggestion: spec.suggestion,
			})
		}
	}

	// 4. World skill (world.md): the production workflow dimension.
	if blueprint.requireSkill && strings.TrimSpace(snapshot.SkillMd) == "" {
		missing = append(missing, MissingItem{
			ID:         "skill.md",
			Kind:       "skill",
			Title:      "世界技能（world.md）",
			Reason:     "这个世界的生产工作流还没有定义，AI 只能即兴发挥",
			Suggestion: "让 AI 根据实体与证据起草生产工作流",
		})
	}

	// 5. Identity: an empty positioning leaves every consumer guessing.
	if len(snapshot.Identity) == 0 {
		missing = append(missing, MissingItem{
			ID:         "identity.positioning",
			Kind:       "identity",
			Title:      "世界定位",
			Reason:     "这个世界是谁、为什么存在，还没有一句话说明",
			Suggestion: "补充定位与受众描述",
		})
	}

	// Level: skeleton until anything substantive exists; ready when the
	// blueprint expectations (entity/field/evidence/skill) hold. Identity gaps
	// are advisory only — they guide but never block readiness.
	level := ReadinessDraft
	blocking := 0
	for _, item := range missing {
		if item.Kind != "identity" {
			blocking++
		}
	}
	switch {
	case substantiveCount == 0 && totalEvidence == 0 && strings.TrimSpace(snapshot.SkillMd) == "":
		level = ReadinessSkeleton
	case blocking == 0:
		level = ReadinessReady
	}

	sort.SliceStable(missing, func(i, j int) bool { return missingRank(missing[i]) < missingRank(missing[j]) })

	score := 100
	for _, item := range missing {
		switch item.Kind {
		case "field":
			score -= 8
		case "entity":
			score -= 15
		case "evidence":
			score -= 10
		case "skill", "identity":
			score -= 5
		}
	}
	if score < 0 {
		score = 0
	}
	if level == ReadinessSkeleton {
		score = 0
	}
	if missing == nil {
		missing = []MissingItem{}
	}
	return WorldReadiness{ScenarioID: scenario, Level: level, Score: score, Missing: missing}
}

func missingRank(item MissingItem) int {
	switch item.Kind {
	case "field":
		return 0
	case "entity":
		return 1
	case "evidence":
		return 2
	default:
		return 3
	}
}

// Readiness computes the readiness projection for one world from the live
// store. Pure, side-effect free, safe to call at high frequency.
func (w *WorldStore) Readiness(worldID, scenarioID string) (WorldReadiness, error) {
	db, err := w.database()
	if err != nil {
		return WorldReadiness{}, err
	}
	detail, err := w.GetWorld(worldID)
	if err != nil {
		return WorldReadiness{}, err
	}
	snapshot := readinessSnapshot{WorldType: detail.Type, SkillMd: detail.SkillMd, Identity: detail.Identity}
	entityRows, err := db.Query("select kind, content_json from world_entities where world_id = ? and archived_at is null order by created_at", worldID)
	if err != nil {
		return WorldReadiness{}, err
	}
	defer entityRows.Close()
	for entityRows.Next() {
		var kind, contentJSON string
		if err := entityRows.Scan(&kind, &contentJSON); err != nil {
			return WorldReadiness{}, err
		}
		entity := readinessEntitySnapshot{Kind: WorldEntityKind(kind), Content: map[string]any{}}
		if contentJSON != "" {
			_ = json.Unmarshal([]byte(contentJSON), &entity.Content)
		}
		snapshot.Entities = append(snapshot.Entities, entity)
	}
	if err := entityRows.Err(); err != nil {
		return WorldReadiness{}, err
	}
	entityRows.Close()
	evidenceRows, err := db.Query("select purpose, modality from world_asset_refs where world_id = ? and archived_at is null", worldID)
	if err != nil {
		return WorldReadiness{}, err
	}
	defer evidenceRows.Close()
	for evidenceRows.Next() {
		var purpose, modality string
		if err := evidenceRows.Scan(&purpose, &modality); err != nil {
			return WorldReadiness{}, err
		}
		snapshot.Evidence = append(snapshot.Evidence, readinessEvidenceSnapshot{Purpose: purpose, Modality: modality})
	}
	return computeReadiness(snapshot, scenarioID), evidenceRows.Err()
}
