/*
 * [INPUT]: 依赖 WorldStore 的 UpsertEntity / UpdateCanvasDocumentOps / ProductionStatus 与 world_entities 表
 * [OUTPUT]: 对外提供生产层的两个动作——plan（按类型 schema 的 childTypes 批量派生「作品→场次→镜头」草稿，
 *   零花费、不产 revision）与 apply（把草稿一次性确认为正式，产 1 条 revision）
 * [POS]: service 的生产层写面（M3）；与 worlds_production.go（读模型）配对，共同支撑 Agent 的 plan→人确认→apply
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import "strings"

// ProductionPlanShot is one shot in a plan (description fields + any product attrs).
type ProductionPlanShot struct {
	Name  string       `json:"name"`
	Intro string       `json:"intro,omitempty"`
	Attrs []EntityAttr `json:"attrs,omitempty"`
}

// ProductionPlanScene is one scene in a plan, with its shots.
type ProductionPlanScene struct {
	Name  string               `json:"name"`
	Intro string               `json:"intro,omitempty"`
	Attrs []EntityAttr         `json:"attrs,omitempty"`
	Shots []ProductionPlanShot `json:"shots,omitempty"`
}

// ProductionPlanInput is the typed input of recut.worlds.production.plan.
// ParentID is the node the scenes hang under — canonical usage is a 视频脚本
// (script) inside a 作品 (work), or a work for a script-less piece.
type ProductionPlanInput struct {
	WorldID    string
	ParentID   string
	Scenes     []ProductionPlanScene
	PlaceCards bool
	CreatedBy  string
}

// ProductionPlanResult reports what the plan materialized.
type ProductionPlanResult struct {
	ParentID    string          `json:"parentId"`
	SceneIDs    []string        `json:"sceneIds"`
	ShotIDs     []string        `json:"shotIds"`
	PlacedCards int             `json:"placedCards"`
	Production  WorldProduction `json:"production"`
}

// PlanProduction materializes a production draft: 作品(work) → 视频脚本(script) →
// 场次(scene) → 镜头(shot). Scenes hang under `ParentID` — canonical usage is a
// script inside a work (a work may hold several scripts), or a work directly for
// a script-less piece.
// Every node is created as an isProvisional draft (零花费、不产 revision、不进 Canon),
// so the Agent can derive the whole graph from world.get + the script and let the
// user review it before anything is generated. The tree shape follows the type
// directory's `childTypes` (advisory): a plan may attach shots directly to the
// work for a one-scene piece.
//
// The single source of truth for containment stays `parentId`; no relation
// arrows are written (树 ≠ 关系, 见 RFC §6). Cards are optional (`PlaceCards`)
// and land on the work's inner canvas (contextId = workId) when requested.
func (w *WorldStore) PlanProduction(input ProductionPlanInput) (ProductionPlanResult, error) {
	if strings.TrimSpace(input.ParentID) == "" {
		return ProductionPlanResult{}, worldsError(WorldsErrContextInvalid, "parentId is required")
	}
	if len(input.Scenes) == 0 {
		return ProductionPlanResult{}, worldsError(WorldsErrContextInvalid, "scenes are required")
	}
	db, err := w.database()
	if err != nil {
		return ProductionPlanResult{}, err
	}
	parent, err := w.getEntity(db, input.WorldID, input.ParentID)
	if err != nil {
		return ProductionPlanResult{}, err
	}
	createdBy := input.CreatedBy
	if createdBy == "" {
		createdBy = "agent"
	}
	place := func(entity WorldEntity) error {
		if !input.PlaceCards {
			return nil
		}
		ops := []CanvasDocOp{{Op: "insert", Element: &UpsertCanvasElementInput{
			WorldID: input.WorldID, ContextID: parent.ID, Kind: "entity",
			RefKind: "entity", RefID: entity.ID, Name: entity.Name, CreatedBy: createdBy,
		}}}
		_, placeErr := w.UpdateCanvasDocumentOps(input.WorldID, parent.ID, ops)
		return placeErr
	}

	result := ProductionPlanResult{ParentID: parent.ID, SceneIDs: []string{}, ShotIDs: []string{}}
	for _, sceneSpec := range input.Scenes {
		scene, err := w.UpsertEntity(UpsertEntityInput{
			WorldID: input.WorldID, TypeID: ProductionTypeScene, Name: sceneSpec.Name,
			Intro: sceneSpec.Intro, Attrs: sceneSpec.Attrs,
			ParentID: parent.ID, IsProvisional: true, CreatedBy: createdBy,
		})
		if err != nil {
			return ProductionPlanResult{}, err
		}
		result.SceneIDs = append(result.SceneIDs, scene.ID)
		if err := place(scene); err != nil {
			return ProductionPlanResult{}, err
		}
		if input.PlaceCards {
			result.PlacedCards++
		}
		for _, shotSpec := range sceneSpec.Shots {
			shot, err := w.UpsertEntity(UpsertEntityInput{
				WorldID: input.WorldID, TypeID: ProductionTypeShot, Name: shotSpec.Name,
				Intro: shotSpec.Intro, Attrs: shotSpec.Attrs,
				ParentID: scene.ID, IsProvisional: true, CreatedBy: createdBy,
			})
			if err != nil {
				return ProductionPlanResult{}, err
			}
			result.ShotIDs = append(result.ShotIDs, shot.ID)
			if err := place(shot); err != nil {
				return ProductionPlanResult{}, err
			}
			if input.PlaceCards {
				result.PlacedCards++
			}
		}
	}
	production, err := w.ProductionStatus(input.WorldID)
	if err != nil {
		return ProductionPlanResult{}, err
	}
	result.Production = production
	return result, nil
}

// ProductionApplyInput is the typed input of recut.worlds.production.apply.
type ProductionApplyInput struct {
	WorldID            string
	WorkID             string
	ExpectedRevisionID string
	CreatedBy          string
}

// ProductionApplyResult reports how many drafts were promoted.
type ProductionApplyResult struct {
	Confirmed  int             `json:"confirmed"`
	Production WorldProduction `json:"production"`
}

// ApplyProduction promotes a work's production drafts (场次/镜头, and the work
// itself when provisional) to formal entities in ONE transaction, producing a
// single revision. This is the "人确认之后" half of plan → 人确认 → apply; the
// per-shot generation itself is driven by the Agent through the media tools
// (with the video proposal gate), never by this call.
func (w *WorldStore) ApplyProduction(input ProductionApplyInput) (ProductionApplyResult, error) {
	db, err := w.database()
	if err != nil {
		return ProductionApplyResult{}, err
	}
	if _, err := w.summary(db, input.WorldID); err != nil {
		return ProductionApplyResult{}, err
	}
	tx, err := db.Begin()
	if err != nil {
		return ProductionApplyResult{}, err
	}
	defer tx.Rollback()
	if err := w.checkWritable(tx, input.WorldID); err != nil {
		return ProductionApplyResult{}, err
	}
	if err := w.checkWorldRevision(tx, input.WorldID, input.ExpectedRevisionID); err != nil {
		return ProductionApplyResult{}, err
	}

	// Collect the ids to confirm along the structural links (has_script /
	// has_scene / has_shot) — the single source of truth for the production tree
	// (生产层 RFC D8). With a workId: the work itself plus its whole descendant
	// subgraph; without one: every provisional production node in the world.
	// Traversal is cycle-safe.
	ids := []string{}
	linkIDs := []string{}
	if strings.TrimSpace(input.WorkID) != "" {
		ids = append(ids, input.WorkID)
		visited := map[string]bool{input.WorkID: true}
		frontier := []string{input.WorkID}
		for len(frontier) > 0 {
			placeholders := strings.TrimRight(strings.Repeat("?,", len(frontier)), ",")
			args := []any{input.WorldID}
			for _, id := range frontier {
				args = append(args, id)
			}
			rows, err := tx.Query("select id, to_entity_id from world_relations where world_id = ? and relation_type in ('has_script','has_scene','has_shot') and from_entity_id in ("+placeholders+")", args...)
			if err != nil {
				return ProductionApplyResult{}, err
			}
			next := []string{}
			for rows.Next() {
				var relationID, toID string
				if err := rows.Scan(&relationID, &toID); err != nil {
					rows.Close()
					return ProductionApplyResult{}, err
				}
				linkIDs = append(linkIDs, relationID)
				if visited[toID] {
					continue
				}
				visited[toID] = true
				ids = append(ids, toID)
				next = append(next, toID)
			}
			rows.Close()
			if err := rows.Err(); err != nil {
				return ProductionApplyResult{}, err
			}
			frontier = next
		}
	} else {
		rows, err := tx.Query("select id from world_entities where world_id = ? and archived_at is null and is_provisional = 1 and coalesce(nullif(type_id, ''), kind) in (?, ?)", input.WorldID, ProductionTypeScene, ProductionTypeShot)
		if err != nil {
			return ProductionApplyResult{}, err
		}
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return ProductionApplyResult{}, err
			}
			ids = append(ids, id)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return ProductionApplyResult{}, err
		}
		linkRows, err := tx.Query("select id from world_relations where world_id = ? and is_provisional = 1 and relation_type in ('has_script','has_scene','has_shot')", input.WorldID)
		if err != nil {
			return ProductionApplyResult{}, err
		}
		for linkRows.Next() {
			var id string
			if err := linkRows.Scan(&id); err != nil {
				linkRows.Close()
				return ProductionApplyResult{}, err
			}
			linkIDs = append(linkIDs, id)
		}
		linkRows.Close()
		if err := linkRows.Err(); err != nil {
			return ProductionApplyResult{}, err
		}
	}
	if len(ids) == 0 && len(linkIDs) == 0 {
		production, err := w.ProductionStatus(input.WorldID)
		if err != nil {
			return ProductionApplyResult{}, err
		}
		return ProductionApplyResult{Confirmed: 0, Production: production}, nil
	}

	now := isoTimeNow()
	createdBy := input.CreatedBy
	if createdBy == "" {
		createdBy = "user"
	}
	placeholders := strings.TrimRight(strings.Repeat("?,", len(ids)), ",")
	args := []any{now, input.WorldID}
	for _, id := range ids {
		args = append(args, id)
	}
	res, err := tx.Exec("update world_entities set is_provisional = 0, updated_at = ? where world_id = ? and archived_at is null and is_provisional = 1 and id in ("+placeholders+")", args...)
	if err != nil {
		return ProductionApplyResult{}, err
	}
	confirmed, err := res.RowsAffected()
	if err != nil {
		return ProductionApplyResult{}, err
	}
	// Promote the draft structural links in the same revision, so the chain
	// becomes canonical together with its nodes.
	if len(linkIDs) > 0 {
		linkPlaceholders := strings.TrimRight(strings.Repeat("?,", len(linkIDs)), ",")
		linkArgs := []any{input.WorldID}
		for _, id := range linkIDs {
			linkArgs = append(linkArgs, id)
		}
		if _, err := tx.Exec("update world_relations set is_provisional = 0 where world_id = ? and is_provisional = 1 and id in ("+linkPlaceholders+")", linkArgs...); err != nil {
			return ProductionApplyResult{}, err
		}
	}
	if _, err := w.commitRevision(tx, input.WorldID, "production.applied", createdBy); err != nil {
		return ProductionApplyResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return ProductionApplyResult{}, err
	}
	logWorldEvent("world.production.applied", map[string]string{"worldId": input.WorldID, "workId": input.WorkID})
	production, err := w.ProductionStatus(input.WorldID)
	if err != nil {
		return ProductionApplyResult{}, err
	}
	return ProductionApplyResult{Confirmed: int(confirmed), Production: production}, nil
}
