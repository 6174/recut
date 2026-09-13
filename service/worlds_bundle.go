/*
 * [INPUT]: 依赖 WorldStore 的 worlds/world_entities/world_relations/world_entity_types/world_canvases 表、
 *          MediaService（素材内容寻址读取/导入）与既有 commitRevision 协议
 * [OUTPUT]: 对外提供 World 内容的可移植能力：ExportWorldBundle（世界 → worlds v2 源格式 zip：
 *          world.json + entities/*.json + assets/*.json + canvas.json + world.md，媒体下载为文件并带 sidecar）、
 *          ImportWorldBundle（zip → 本地可编辑 World，素材按内容哈希去重导入，实体/关系/画布 id 全量重映射）。
 * [POS]: service 的 World 交换层（RFC world-content-format-v2 P3）：导出是「把世界带走」，导入是「把 bundle 变成我的世界」；
 *        与 materialize（平台内容只读同步）互不影响。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"sort"
	"strings"
	"time"
)

// WorldBundleAsset is the sidecar written next to an exported media file
// (assets/<id>.json). file is relative to the assets/ directory. recipe keeps
// the generation recipe (prompt/references/model) when the asset carries one.
type WorldBundleAsset struct {
	ID         string         `json:"id"`
	Name       string         `json:"name"`
	Kind       string         `json:"kind"`
	File       string         `json:"file"`
	Recipe     map[string]any `json:"recipe,omitempty"`
	Provenance map[string]any `json:"provenance,omitempty"`
}

// WorldBundleManifest is the source world.json inside an exported zip.
type WorldBundleManifest struct {
	SourceVersion int                       `json:"sourceVersion"`
	Version       string                    `json:"version,omitempty"`
	World         WorldManifestWorld        `json:"world"`
	EntityTypes   []WorldManifestEntityType `json:"entityTypes"`
	Relations     []WorldManifestRelation   `json:"relations"`
	Provenance    *Provenance               `json:"provenance,omitempty"`
}

type bundleCanvas struct {
	DocVersion int                   `json:"docVersion"`
	Canvases   []WorldManifestCanvas `json:"canvases"`
}

const worldBundleMaxBytes = 512 * 1024 * 1024 // 512MB zip ceiling (media-heavy worlds)

func worldBundleSlug(value, fallback string) string {
	var out strings.Builder
	previousDash := false
	for _, r := range strings.ToLower(value) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			out.WriteRune(r)
			previousDash = false
		default:
			if !previousDash && out.Len() > 0 {
				out.WriteByte('-')
				previousDash = true
			}
		}
	}
	slug := strings.Trim(out.String(), "-")
	if slug == "" {
		return fallback
	}
	return slug
}

func bundleExtension(mimeType, name string) string {
	switch strings.ToLower(strings.TrimSpace(strings.Split(mimeType, ";")[0])) {
	case "image/png":
		return ".png"
	case "image/jpeg":
		return ".jpg"
	case "image/webp":
		return ".webp"
	case "image/gif":
		return ".gif"
	case "image/avif":
		return ".avif"
	case "video/mp4":
		return ".mp4"
	case "video/quicktime":
		return ".mov"
	case "video/webm":
		return ".webm"
	case "audio/mpeg":
		return ".mp3"
	case "audio/wav":
		return ".wav"
	case "audio/mp4":
		return ".m4a"
	case "audio/ogg":
		return ".ogg"
	}
	lower := strings.ToLower(name)
	if idx := strings.LastIndex(lower, "."); idx >= 0 && idx < len(lower)-1 && len(lower)-idx <= 6 {
		return lower[idx:]
	}
	return ".bin"
}

// sourceEntityID strips the per-world storage namespace ("<worldID>:<slug>").
func sourceEntityID(worldID, storedID string) string {
	return strings.TrimPrefix(storedID, worldID+":")
}

// ExportWorldBundle renders one World as a self-contained v2 source zip. Media
// referenced by assetId is read from the content-addressed store; media carried
// as a public url is fetched through the SSRF-guarded remote cache. Identical
// media is written once per bundle.
func (w *WorldStore) ExportWorldBundle(worldID string) ([]byte, string, error) {
	detail, err := w.GetWorld(worldID)
	if err != nil {
		return nil, "", err
	}
	db, err := w.database()
	if err != nil {
		return nil, "", err
	}

	buffer := &bytes.Buffer{}
	zw := zip.NewWriter(buffer)
	written := map[string]int{}
	writeFile := func(name string, data []byte) error {
		name = strings.TrimPrefix(path.Clean("/"+name), "/")
		if _, exists := written[name]; exists {
			return nil
		}
		writer, err := zw.Create(name)
		if err != nil {
			return err
		}
		if _, err := writer.Write(data); err != nil {
			return err
		}
		written[name] = 1
		return nil
	}
	writeJSON := func(name string, value any) error {
		data, err := json.MarshalIndent(value, "", "  ")
		if err != nil {
			return err
		}
		return writeFile(name, append(data, '\n'))
	}

	// Asset protocol: dedupe identical media across entities/canvas.
	usedIDs := map[string]bool{}
	assetSidecars := map[string]WorldBundleAsset{}
	assetRefs := map[string]string{} // assetId or url:<url> → bundle asset id
	exportMedia := func(value map[string]any) (map[string]any, error) {
		assetID, _ := value["assetId"].(string)
		rawURL, _ := value["url"].(string)
		kind, _ := value["kind"].(string)
		name, _ := value["name"].(string)
		segment, _ := value["segment"]
		out := map[string]any{}
		if segment != nil {
			out["segment"] = segment
		}
		key := ""
		var data []byte
		var mimeType, displayName string
		var recipe map[string]any
		provenance := map[string]any{}
		switch {
		case assetID != "":
			key = "asset:" + assetID
			asset, getErr := w.media.GetAsset(assetID)
			if getErr != nil {
				return nil, fmt.Errorf("export asset %s: %w", assetID, getErr)
			}
			filePath, _ := asset.Metadata["path"].(string)
			if filePath == "" {
				return nil, fmt.Errorf("export asset %s: no local file", assetID)
			}
			data, err = os.ReadFile(filePath)
			if err != nil {
				return nil, fmt.Errorf("read asset %s: %w", assetID, err)
			}
			mimeType, displayName = asset.MimeType, asset.Name
			if kind == "" {
				kind = asset.Kind
			}
			if name == "" {
				name = asset.Name
			}
			if r, ok := asset.Metadata["recipe"].(map[string]any); ok {
				recipe = r
			}
			if asset.ContentHash != "" {
				provenance["contentHash"] = asset.ContentHash
			}
		case rawURL != "":
			key = "url:" + rawURL
			result, getErr := w.media.RemoteCache().LocalPathFor(rawURL)
			if getErr != nil {
				return nil, fmt.Errorf("export url %s: %w", rawURL, getErr)
			}
			data, err = os.ReadFile(result.Path)
			if err != nil {
				return nil, fmt.Errorf("read url %s: %w", rawURL, err)
			}
			mimeType = result.ContentType
			displayName = path.Base(rawURL)
			provenance["sourceUrl"] = rawURL
		default:
			return value, nil
		}
		bundleID, ok := assetRefs[key]
		if !ok {
			base := worldBundleSlug(name, worldBundleSlug(strings.TrimSuffix(displayName, path.Ext(displayName)), "asset"))
			bundleID = base
			for n := 2; usedIDs[bundleID]; n++ {
				bundleID = fmt.Sprintf("%s-%d", base, n)
			}
			usedIDs[bundleID] = true
			assetRefs[key] = bundleID
			ext := bundleExtension(mimeType, displayName)
			assetSidecars[bundleID] = WorldBundleAsset{ID: bundleID, Name: name, Kind: kind, File: bundleID + ext, Recipe: recipe, Provenance: provenance}
			if err := writeFile("assets/"+bundleID+ext, data); err != nil {
				return nil, err
			}
		}
		out["asset"] = bundleID
		return out, nil
	}

	// Entities
	type entityRecord struct {
		ID, TypeID, Name, Intro, Detail, ParentID, ContainerRole string
		IsProvisional                                            bool
		Attrs                                                    []EntityAttr
	}
	rows, err := db.Query("select id, coalesce(nullif(type_id, ''), kind), title, summary, detail, attrs_json, coalesce(parent_id, ''), container_role, is_provisional from world_entities where world_id = ? and archived_at is null order by created_at, id", worldID)
	if err != nil {
		return nil, "", err
	}
	var records []entityRecord
	for rows.Next() {
		var record entityRecord
		var attrsJSON string
		var provisional int
		if err := rows.Scan(&record.ID, &record.TypeID, &record.Name, &record.Intro, &record.Detail, &attrsJSON, &record.ParentID, &record.ContainerRole, &provisional); err != nil {
			rows.Close()
			return nil, "", err
		}
		record.IsProvisional = provisional != 0
		if attrsJSON != "" {
			if err := json.Unmarshal([]byte(attrsJSON), &record.Attrs); err != nil {
				rows.Close()
				return nil, "", err
			}
		}
		records = append(records, record)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, "", err
	}

	entities := make([]WorldManifestEntityV2, 0, len(records))
	for _, record := range records {
		attrs := make([]EntityAttr, 0, len(record.Attrs))
		for _, attr := range record.Attrs {
			if attr.Type == "media" {
				if value, ok := attr.Value.(map[string]any); ok {
					resolved, mediaErr := exportMedia(value)
					if mediaErr != nil {
						return nil, "", mediaErr
					}
					attr.Value = resolved
				}
			}
			attrs = append(attrs, attr)
		}
		entities = append(entities, WorldManifestEntityV2{
			ID: sourceEntityID(worldID, record.ID), TypeID: record.TypeID, Name: record.Name, Intro: record.Intro,
			Detail: record.Detail, ParentID: sourceEntityID(worldID, record.ParentID), ContainerRole: record.ContainerRole,
			IsProvisional: record.IsProvisional, Attrs: attrs,
		})
	}

	// Relations
	relationRows, err := db.Query("select id, relation_type, from_entity_id, to_entity_id, coalesce(scope_entity_id, '') from world_relations where world_id = ? order by created_at, id", worldID)
	if err != nil {
		return nil, "", err
	}
	relations := []WorldManifestRelation{}
	for relationRows.Next() {
		var id, relationType, fromID, toID, scopeID string
		if err := relationRows.Scan(&id, &relationType, &fromID, &toID, &scopeID); err != nil {
			relationRows.Close()
			return nil, "", err
		}
		relations = append(relations, WorldManifestRelation{
			ID: id, Type: relationType, From: sourceEntityID(worldID, fromID), To: sourceEntityID(worldID, toID), Scope: sourceEntityID(worldID, scopeID),
		})
	}
	relationRows.Close()
	if err := relationRows.Err(); err != nil {
		return nil, "", err
	}

	// Entity types: export custom types and builtin overrides (skip untouched presets).
	typeRows, err := db.Query("select id, scope, name, icon, color, base_kind, fields_json, builtin from world_entity_types where world_id = ? and archived_at is null order by id", worldID)
	if err != nil {
		return nil, "", err
	}
	entityTypes := []WorldManifestEntityType{}
	for typeRows.Next() {
		var id, scope, name, icon, color, baseKind, fieldsJSON string
		var builtin int
		if err := typeRows.Scan(&id, &scope, &name, &icon, &color, &baseKind, &fieldsJSON, &builtin); err != nil {
			typeRows.Close()
			return nil, "", err
		}
		fields := []EntityTypeField{}
		_ = json.Unmarshal([]byte(fieldsJSON), &fields)
		if scope == "builtin" && samePresetFields(id, fields) {
			continue // preset baseline, reconstructed on import
		}
		entityTypes = append(entityTypes, WorldManifestEntityType{ID: id, Scope: scope, Name: name, Icon: icon, Color: color, BaseKind: baseKind, Fields: fields})
	}
	typeRows.Close()
	if err := typeRows.Err(); err != nil {
		return nil, "", err
	}

	// Canvas documents
	docRows, err := db.Query("select context_id, doc_json from world_canvases where world_id = ? order by case when context_id = '' then 0 else 1 end, context_id", worldID)
	if err != nil {
		return nil, "", err
	}
	canvases := []WorldManifestCanvas{}
	for docRows.Next() {
		var contextID, raw string
		if err := docRows.Scan(&contextID, &raw); err != nil {
			docRows.Close()
			return nil, "", err
		}
		payload, decodeErr := decodeCanvasDocPayload(raw)
		if decodeErr != nil {
			docRows.Close()
			return nil, "", decodeErr
		}
		elements := []WorldCanvasElement{}
		for _, element := range payload.Elements {
			element.ContextID = sourceEntityID(worldID, contextID)
			if element.RefID != "" {
				element.RefID = sourceEntityID(worldID, element.RefID)
			}
			if element.Props != nil {
				if assetID, _ := element.Props["assetId"].(string); assetID != "" {
					resolved, mediaErr := exportMedia(map[string]any{"assetId": assetID, "name": element.Props["assetName"], "kind": element.Props["media"]})
					if mediaErr != nil {
						return nil, "", mediaErr
					}
					delete(element.Props, "assetId")
					delete(element.Props, "assetName")
					if bundleID, _ := resolved["asset"].(string); bundleID != "" {
						element.Props["asset"] = bundleID
					}
				}
			}
			elements = append(elements, element)
		}
		canvases = append(canvases, WorldManifestCanvas{ContextID: sourceEntityID(worldID, contextID), Elements: elements})
	}
	docRows.Close()
	if err := docRows.Err(); err != nil {
		return nil, "", err
	}

	source := WorldBundleManifest{
		SourceVersion: 2,
		World: WorldManifestWorld{
			ID: detail.ID, Name: detail.Name, Type: detail.Type, Description: detail.Description,
			Identity: detail.Identity,
		},
		EntityTypes: entityTypes,
		Relations:   relations,
	}
	if detail.OriginMeta != nil {
		source.Provenance = detail.OriginMeta.Provenance
		source.Version = detail.OriginMeta.Version
	}
	if err := writeJSON("world.json", source); err != nil {
		return nil, "", err
	}
	if err := writeJSON("canvas.json", bundleCanvas{DocVersion: 1, Canvases: canvases}); err != nil {
		return nil, "", err
	}
	if detail.SkillMd != "" {
		if err := writeFile("world.md", []byte(detail.SkillMd)); err != nil {
			return nil, "", err
		}
	}
	for _, entity := range entities {
		if err := writeJSON("entities/"+entity.ID+".json", entity); err != nil {
			return nil, "", err
		}
	}
	// Deterministic sidecar writes.
	assetIDs := make([]string, 0, len(assetSidecars))
	for id := range assetSidecars {
		assetIDs = append(assetIDs, id)
	}
	sort.Strings(assetIDs)
	for _, id := range assetIDs {
		if err := writeJSON("assets/"+id+".json", assetSidecars[id]); err != nil {
			return nil, "", err
		}
	}
	if err := zw.Close(); err != nil {
		return nil, "", err
	}
	name := worldBundleSlug(strings.TrimPrefix(strings.TrimPrefix(worldID, "pgc."), "pub."), "world") + "-world.zip"
	logWorldEvent("world.exported", map[string]string{"worldId": worldID})
	return buffer.Bytes(), name, nil
}

func samePresetFields(id string, fields []EntityTypeField) bool {
	preset, ok := presetEntityTypeFields[id]
	if !ok || len(preset) != len(fields) {
		return false
	}
	for i := range preset {
		if preset[i].Key != fields[i].Key || preset[i].Type != fields[i].Type || preset[i].Label != fields[i].Label {
			return false
		}
	}
	return true
}

// ImportWorldBundle turns an exported zip into a fresh local, editable World.
// Assets are imported through the content-addressed store, so identical bytes
// are deduplicated and never uploaded twice. Entity/relation/canvas ids are
// remapped deterministically; the whole content lands in one revision.
func (w *WorldStore) ImportWorldBundle(data []byte, nameOverride, createdBy string) (WorldDetail, error) {
	if len(data) == 0 {
		return WorldDetail{}, worldsError(WorldsErrContextInvalid, "empty bundle")
	}
	if len(data) > worldBundleMaxBytes {
		return WorldDetail{}, worldsError(WorldsErrContextInvalid, "bundle is too large")
	}
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return WorldDetail{}, worldsError(WorldsErrContextInvalid, "invalid zip bundle")
	}
	files := map[string]*zip.File{}
	for _, file := range reader.File {
		files[strings.TrimPrefix(path.Clean("/"+file.Name), "/")] = file
	}
	readFile := func(name string) ([]byte, bool) {
		file, ok := files[name]
		if !ok {
			return nil, false
		}
		handle, err := file.Open()
		if err != nil {
			return nil, false
		}
		defer handle.Close()
		content, err := io.ReadAll(io.LimitReader(handle, worldBundleMaxBytes))
		if err != nil {
			return nil, false
		}
		return content, true
	}

	worldBytes, ok := readFile("world.json")
	if !ok {
		return WorldDetail{}, worldsError(WorldsErrContextInvalid, "bundle is missing world.json")
	}
	source := WorldBundleManifest{}
	if err := json.Unmarshal(worldBytes, &source); err != nil {
		return WorldDetail{}, worldsError(WorldsErrContextInvalid, "invalid world.json")
	}
	if source.SourceVersion != 2 {
		return WorldDetail{}, worldsError(WorldsErrContextInvalid, "bundle is not a v2 world")
	}
	if !worldKinds[source.World.Type] {
		return WorldDetail{}, worldsError(WorldsErrContextInvalid, "invalid world type")
	}
	name := strings.TrimSpace(nameOverride)
	if name == "" {
		name = strings.TrimSpace(source.World.Name)
	}
	if name == "" {
		return WorldDetail{}, worldsError(WorldsErrContextInvalid, "world name is required")
	}
	if skill, ok := readFile("world.md"); ok && source.World.SkillMd == "" {
		source.World.SkillMd = string(skill)
	}

	// 1. Upload assets (content-hash deduplicated by the media store).
	assetMap := map[string]string{} // bundle asset id → platform asset id
	sidecars := []WorldBundleAsset{}
	for fileName := range files {
		if !strings.HasPrefix(fileName, "assets/") || !strings.HasSuffix(fileName, ".json") {
			continue
		}
		raw, _ := readFile(fileName)
		sidecar := WorldBundleAsset{}
		if err := json.Unmarshal(raw, &sidecar); err != nil {
			continue
		}
		if sidecar.ID == "" {
			sidecar.ID = strings.TrimSuffix(path.Base(fileName), ".json")
		}
		sidecars = append(sidecars, sidecar)
	}
	for _, sidecar := range sidecars {
		binary, ok := readFile("assets/" + sidecar.File)
		if !ok {
			continue
		}
		mimeType := mimeTypeByExtension(sidecar.File)
		if mimeType == "" {
			mimeType = http.DetectContentType(binary)
		}
		asset, err := w.media.ImportMediaReader(sidecar.File, mimeType, bytes.NewReader(binary))
		if err != nil {
			return WorldDetail{}, fmt.Errorf("import asset %s: %w", sidecar.ID, err)
		}
		assetMap[sidecar.ID] = asset.ID
	}

	resolveMedia := func(value map[string]any) map[string]any {
		assetID, _ := value["asset"].(string)
		segment, _ := value["segment"]
		out := map[string]any{}
		if assetID != "" {
			if mapped, ok := assetMap[assetID]; ok {
				out["assetId"] = mapped
				out["kind"] = value["kind"]
				if name, ok := value["name"].(string); ok && name != "" {
					out["name"] = name
				}
				if segment != nil {
					out["segment"] = segment
				}
				return out
			}
		}
		// url or unresolved asset: keep as-is (url survives; unknown asset is dropped)
		for key, item := range value {
			if key != "asset" {
				out[key] = item
			}
		}
		return out
	}

	// 2. Build the unified manifest (ids are namespaced by the new world id in the tx).
	manifest := WorldManifestV2{
		ManifestVersion: 2,
		World:           source.World,
		EntityTypes:     source.EntityTypes,
		Relations:       source.Relations,
		Canvases:        []WorldManifestCanvas{},
	}
	manifest.World.Name = name
	manifest.World.SkillMd = source.World.SkillMd

	entityFiles := []string{}
	for fileName := range files {
		if strings.HasPrefix(fileName, "entities/") && strings.HasSuffix(fileName, ".json") {
			entityFiles = append(entityFiles, fileName)
		}
	}
	sort.Strings(entityFiles)
	for _, fileName := range entityFiles {
		raw, _ := readFile(fileName)
		entity := WorldManifestEntityV2{}
		if err := json.Unmarshal(raw, &entity); err != nil {
			return WorldDetail{}, worldsError(WorldsErrContextInvalid, "invalid entity "+fileName)
		}
		if entity.ID == "" {
			entity.ID = strings.TrimSuffix(path.Base(fileName), ".json")
		}
		attrs := make([]EntityAttr, 0, len(entity.Attrs))
		for _, attr := range entity.Attrs {
			if attr.Type == "media" {
				if value, ok := attr.Value.(map[string]any); ok {
					attr.Value = resolveMedia(value)
				}
			}
			attrs = append(attrs, attr)
		}
		entity.Attrs = attrs
		manifest.Entities = append(manifest.Entities, entity)
	}

	if canvasRaw, ok := readFile("canvas.json"); ok {
		bundle := bundleCanvas{}
		if err := json.Unmarshal(canvasRaw, &bundle); err != nil {
			return WorldDetail{}, worldsError(WorldsErrContextInvalid, "invalid canvas.json")
		}
		for _, canvas := range bundle.Canvases {
			elements := make([]WorldCanvasElement, 0, len(canvas.Elements))
			for _, element := range canvas.Elements {
				if element.Props != nil {
					if assetID, _ := element.Props["asset"].(string); assetID != "" {
						resolved := resolveMedia(map[string]any{"asset": assetID, "kind": element.Props["kind"], "name": element.Props["name"]})
						delete(element.Props, "asset")
						if mapped, _ := resolved["assetId"].(string); mapped != "" {
							element.Props["assetId"] = mapped
						}
						if kind, _ := resolved["kind"].(string); kind != "" && element.Props["kind"] == nil {
							element.Props["kind"] = kind
						}
					}
				}
				elements = append(elements, element)
			}
			canvas.Elements = elements
			manifest.Canvases = append(manifest.Canvases, canvas)
		}
	}

	// 3. Create the local world and its content in one revision.
	db, err := w.database()
	if err != nil {
		return WorldDetail{}, err
	}
	worldID, err := newID()
	if err != nil {
		return WorldDetail{}, err
	}
	identityJSON, err := json.Marshal(manifest.World.Identity)
	if err != nil {
		return WorldDetail{}, err
	}
	originMeta := WorldOriginMeta{Provenance: source.Provenance}
	originMetaJSON, _ := json.Marshal(originMeta)
	now := iso(time.Now().UTC())

	tx, err := db.Begin()
	if err != nil {
		return WorldDetail{}, err
	}
	defer tx.Rollback()
	if _, err := tx.Exec("insert into worlds (id, name, type, description, identity_json, origin, origin_meta_json, skill_md, current_revision_id, cover_asset_id, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, '', '', ?, ?)",
		worldID, strings.TrimSpace(manifest.World.Name), string(manifest.World.Type), strings.TrimSpace(manifest.World.Description),
		string(identityJSON), WorldLocal, string(originMetaJSON), manifest.World.SkillMd, now, now); err != nil {
		return WorldDetail{}, err
	}
	if err := insertManifestV2Tx(tx, worldID, &manifest, now); err != nil {
		return WorldDetail{}, err
	}
	if _, err := w.commitRevision(tx, worldID, "world.imported", createdBy); err != nil {
		return WorldDetail{}, err
	}
	if err := tx.Commit(); err != nil {
		return WorldDetail{}, err
	}
	logWorldEvent("world.imported", map[string]string{"worldId": worldID})
	return w.GetWorld(worldID)
}

func mimeTypeByExtension(name string) string {
	switch strings.ToLower(path.Ext(name)) {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".webp":
		return "image/webp"
	case ".gif":
		return "image/gif"
	case ".avif":
		return "image/avif"
	case ".mp4":
		return "video/mp4"
	case ".mov":
		return "video/quicktime"
	case ".webm":
		return "video/webm"
	case ".mp3":
		return "audio/mpeg"
	case ".wav":
		return "audio/wav"
	case ".m4a":
		return "audio/mp4"
	case ".ogg":
		return "audio/ogg"
	}
	return ""
}
