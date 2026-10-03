/*
 * [INPUT]: 依赖 WorldStore 的 upsertEntityTx / UpdateCanvasDocumentOps / ProductionStatus 与 world_entities 表
 * [OUTPUT]: 对外提供生产层的批量建树动作 `recut.worlds.production.create`：一次调用、一条事务、一条 revision，
 *   直接建出 canonical 的「场次(scene) → 镜头(shot)」（含 has_scene/has_shot 结构链）。无草稿态、无转正步骤。
 * [POS]: service 的生产层写面；与 worlds_production.go（读模型）配对
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import "strings"

// ProductionCreateShot is one shot in a batch create. A shot is a storyboard /
// framed-reference unit used to detail and anchor the picture (景别/机位/关键帧),
// NOT a per-shot video generation unit — the scene is. `Detail` is the shot's
// full frame description (画面描述); products (keyframe/clip) are attached later
// as media attrs.
type ProductionCreateShot struct {
	Name   string       `json:"name"`
	Intro  string       `json:"intro,omitempty"`
	Detail string       `json:"detail,omitempty"`
	Attrs  []EntityAttr `json:"attrs,omitempty"`
}

// ProductionCreateScene is one scene in a batch create, with its shots. A scene
// is the VIDEO-GENERATION unit: `Detail` is its complete content (what happens,
// who is present, environment/emotion/key action/dialogue), it owns the total
// duration, and its finished video attaches to the scene. Shots under it are the
// storyboard breakdown used for frame-level reference.
type ProductionCreateScene struct {
	Name   string                 `json:"name"`
	Intro  string                 `json:"intro,omitempty"`
	Detail string                 `json:"detail,omitempty"`
	Attrs  []EntityAttr           `json:"attrs,omitempty"`
	Shots  []ProductionCreateShot `json:"shots,omitempty"`
}

// ProductionCreateInput is the typed input of recut.worlds.production.create.
// ParentID is the node the scenes hang under — canonical usage is a 视频脚本
// (script) inside a 作品 (work), or a work for a script-less piece.
type ProductionCreateInput struct {
	WorldID            string
	ParentID           string
	Scenes             []ProductionCreateScene
	PlaceCards         bool
	ExpectedRevisionID string
	CreatedBy          string
}

// ProductionCreateResult reports what the call materialized.
type ProductionCreateResult struct {
	ParentID    string          `json:"parentId"`
	SceneIDs    []string        `json:"sceneIds"`
	ShotIDs     []string        `json:"shotIds"`
	PlacedCards int             `json:"placedCards"`
	Production  WorldProduction `json:"production"`
}

// CreateProduction materializes a production tree: 作品(work) → 视频脚本(script)
// → 场次(scene) → 镜头(shot). Scenes hang under `ParentID` — canonical usage is
// a script inside a work (a work may hold several scripts), or a work directly
// for a script-less piece. Nodes are written CANONICAL: the whole tree is one
// transaction producing exactly ONE revision, so a batch never pollutes the
// history with one revision per node. There is no draft state and no promotion
// step — the tree is real the moment it is created. Structural links
// has_scene/has_shot are materialized by upsertEntityTx as the tree's single
// source of truth. Cards are optional (`PlaceCards`) and land on the parent's
// inner canvas AFTER the write commits (canvas elements never produce a revision).
func (w *WorldStore) CreateProduction(input ProductionCreateInput) (ProductionCreateResult, error) {
	if strings.TrimSpace(input.ParentID) == "" {
		return ProductionCreateResult{}, worldsError(WorldsErrContextInvalid, "parentId is required")
	}
	if len(input.Scenes) == 0 {
		return ProductionCreateResult{}, worldsError(WorldsErrContextInvalid, "scenes are required")
	}
	db, err := w.database()
	if err != nil {
		return ProductionCreateResult{}, err
	}
	if _, err := w.summary(db, input.WorldID); err != nil {
		return ProductionCreateResult{}, err
	}
	parent, err := w.getEntity(db, input.WorldID, input.ParentID)
	if err != nil {
		return ProductionCreateResult{}, err
	}
	createdBy := input.CreatedBy
	if createdBy == "" {
		createdBy = "agent"
	}

	tx, err := db.Begin()
	if err != nil {
		return ProductionCreateResult{}, err
	}
	defer tx.Rollback()
	if err := w.checkWritable(tx, input.WorldID); err != nil {
		return ProductionCreateResult{}, err
	}
	if err := w.checkWorldRevision(tx, input.WorldID, input.ExpectedRevisionID); err != nil {
		return ProductionCreateResult{}, err
	}

	result := ProductionCreateResult{ParentID: parent.ID, SceneIDs: []string{}, ShotIDs: []string{}}
	type placedNode struct{ id, name string }
	placed := []placedNode{}
	for _, sceneSpec := range input.Scenes {
		sceneID, _, err := w.upsertEntityTx(tx, UpsertEntityInput{
			WorldID: input.WorldID, TypeID: ProductionTypeScene, Name: sceneSpec.Name,
			Intro: sceneSpec.Intro, Detail: sceneSpec.Detail, Attrs: sceneSpec.Attrs, ParentID: parent.ID, CreatedBy: createdBy,
		}, WorldEntity{})
		if err != nil {
			return ProductionCreateResult{}, err
		}
		result.SceneIDs = append(result.SceneIDs, sceneID)
		placed = append(placed, placedNode{id: sceneID, name: sceneSpec.Name})
		for _, shotSpec := range sceneSpec.Shots {
			shotID, _, err := w.upsertEntityTx(tx, UpsertEntityInput{
				WorldID: input.WorldID, TypeID: ProductionTypeShot, Name: shotSpec.Name,
				Intro: shotSpec.Intro, Detail: shotSpec.Detail, Attrs: shotSpec.Attrs, ParentID: sceneID, CreatedBy: createdBy,
			}, WorldEntity{})
			if err != nil {
				return ProductionCreateResult{}, err
			}
			result.ShotIDs = append(result.ShotIDs, shotID)
			placed = append(placed, placedNode{id: shotID, name: shotSpec.Name})
		}
	}
	// ONE revision for the whole tree — the reason this is a batch tool: a
	// per-node create would otherwise emit one revision per node.
	if _, err := w.commitRevision(tx, input.WorldID, "production.created", createdBy); err != nil {
		return ProductionCreateResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return ProductionCreateResult{}, err
	}

	// Cards land on the parent's inner canvas after the semantic write commits.
	if input.PlaceCards {
		for _, node := range placed {
			ops := []CanvasDocOp{{Op: "insert", Element: &UpsertCanvasElementInput{
				WorldID: input.WorldID, ContextID: parent.ID, Kind: "entity",
				RefKind: "entity", RefID: node.id, Name: node.name, CreatedBy: createdBy,
			}}}
			if _, err := w.UpdateCanvasDocumentOps(input.WorldID, parent.ID, ops); err != nil {
				return ProductionCreateResult{}, err
			}
			result.PlacedCards++
		}
	}

	logWorldEvent("world.production.created", map[string]string{"worldId": input.WorldID, "parentId": parent.ID})
	production, err := w.ProductionStatus(input.WorldID)
	if err != nil {
		return ProductionCreateResult{}, err
	}
	result.Production = production
	return result, nil
}
