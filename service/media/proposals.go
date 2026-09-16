/*
 * [INPUT]: 依赖 Workspace 数据库、模型目录与 media 的资产/任务生命周期（assets.go、jobs.go、catalog.go）
 * [OUTPUT]: 对外提供生成提案能力：RequiresProposal（按 capability/model 判定提案门禁）、Propose（提案落库，不建 job、不花钱）、
 *   ConfirmProposal（复用同一 assetId 转 queued 并提交 job）、UpdateProposal（确认前原地改配方）、
 *   RejectProposal（软删放弃）、ListProposals 与 readProposalSpec
 * [POS]: media 的提案门禁层；把 World Canvas 私有 props.proposal 收敛为全局素材状态，素材库/画布/编辑器共享同一策略
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package media

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// proposalRouteInput picks the route-resolution fields for a propose/confirm
// call. A concrete credential pins a direct model binding; otherwise a named
// route re-resolves (and pins the model+credential it returns); otherwise the
// model resolves directly (local provider with no credential).
func proposalRouteInput(capability MediaCapability, routeID, modelID, credentialID string) GenerateMediaInput {
	input := GenerateMediaInput{Capability: capability}
	switch {
	case credentialID != "":
		input.ModelID, input.CredentialID = modelID, credentialID
	case routeID != "" && routeID != "direct":
		input.Route = routeID
	default:
		input.ModelID = modelID
	}
	return input
}

// RequiresProposal reports whether a generation of this capability/model must
// first land as a user-confirmed proposal. Video is gated by capability for any
// model; other capabilities are gated only when the catalog marks the model
// high-cost via RequiresProposal.
func RequiresProposal(capability MediaCapability, modelID string) bool {
	if capability == VideoGenerate {
		return true
	}
	if model, ok := modelByID(modelID); ok {
		return model.RequiresProposal
	}
	return false
}

// ShouldPropose applies the proposal gate for one submission. An explicit mode
// ("propose"/"generate") wins; an empty mode derives the default from the
// capability/model policy, resolving the route when necessary.
func (m *MediaService) ShouldPropose(input GenerateMediaInput, mode string) (bool, error) {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case "generate":
		return false, nil
	case "propose":
		return true, nil
	}
	if input.Capability == VideoGenerate {
		return true, nil
	}
	route, _, err := m.resolveRoute(input)
	if err != nil {
		return false, err
	}
	return RequiresProposal(input.Capability, route.ModelID), nil
}

// readProposalSpec extracts metadata.proposal from an asset. The metadata map
// holds JSON-decoded values, so it round-trips through JSON to the typed spec;
// a missing/invalid payload yields the zero spec.
func readProposalSpec(asset MediaAsset) ProposalSpec {
	raw, ok := asset.Metadata["proposal"]
	if !ok || raw == nil {
		return ProposalSpec{}
	}
	data, err := json.Marshal(raw)
	if err != nil {
		return ProposalSpec{}
	}
	var spec ProposalSpec
	if err := json.Unmarshal(data, &spec); err != nil {
		return ProposalSpec{}
	}
	return spec
}

// ProposalOf is the read-only accessor other packages (world canvas bridge) use
// to resolve a proposed asset's recipe without re-implementing the metadata
// shape.
func (m *MediaService) ProposalOf(assetID string) (MediaAsset, ProposalSpec, error) {
	asset, err := m.GetAsset(assetID)
	if err != nil {
		return MediaAsset{}, ProposalSpec{}, err
	}
	return asset, readProposalSpec(asset), nil
}

// Propose records a generation proposal as a global asset. It resolves and
// validates the model/credential/references exactly like a real submission, but
// writes no media_jobs row and consumes no provider cost; the asset stays
// status=proposed until the user confirms.
func (m *MediaService) Propose(input ProposeInput) (MediaAsset, error) {
	if !knownCapability(input.Capability) || strings.TrimSpace(input.Prompt) == "" {
		return MediaAsset{}, errors.New("capability and prompt are required")
	}
	if input.ProjectID != "" {
		if _, err := projectExists(m.store, input.ProjectID); err != nil {
			return MediaAsset{}, err
		}
	}
	// Callers may declare references only through role bindings; derive the flat
	// submission order from them so the two stay in lockstep.
	if len(input.ReferenceIDs) == 0 && len(input.ReferencesMeta) > 0 {
		input.ReferenceIDs = proposalReferenceIDs(input.ReferencesMeta)
	}
	route, credential, err := m.resolveRoute(proposalRouteInput(input.Capability, input.Route, input.ModelID, input.CredentialID))
	if err != nil {
		return MediaAsset{}, err
	}
	model, ok := modelByID(route.ModelID)
	if !ok {
		return MediaAsset{}, errors.New("media route model is unknown")
	}
	output := normalizedGenerationOutput(input.Capability, route.ModelID, input.Output)
	normalizedOutput, err := normalizeModelOutput(model, output)
	if err != nil {
		return MediaAsset{}, err
	}
	output = normalizedOutput
	if input.Capability == SpeechGenerate && speechVoiceID(MediaJob{Output: output}) == "" {
		if credential.Provider == "local-audio" {
			output["voiceId"] = speechLocalVoiceDefault
		} else {
			return MediaAsset{}, errors.New("voiceId is required for speech generation")
		}
	}
	refs, err := m.validateReferences(GenerateMediaInput{
		Capability: input.Capability, ModelID: route.ModelID, References: input.References, ReferenceIDs: input.ReferenceIDs,
	})
	if err != nil {
		return MediaAsset{}, err
	}
	spec, err := buildProposalSpec(input, refs)
	if err != nil {
		return MediaAsset{}, err
	}
	kind, mimeType := queuedAssetSpec(MediaJob{Capability: input.Capability, Output: output})
	metadata := map[string]any{
		"prompt":       input.Prompt,
		"modelId":      route.ModelID,
		"provider":     credential.Provider,
		"capability":   input.Capability,
		"output":       output,
		"referenceIds": refs.Flat(),
		"proposal":     spec,
	}
	if credential.ID != "" {
		metadata["credentialId"] = credential.ID
	}
	if route.ID != "" {
		metadata["routeId"] = route.ID
	}
	return m.createProposedAsset(input.ProjectID, kind, mimeType, metadata)
}

// buildProposalSpec assembles the reviewable recipe. referenceIds (refs.Flat)
// is the submission-order authority; the returned references follow that same
// order, taking role/label from caller metadata when the ids match.
func buildProposalSpec(input ProposeInput, refs MediaReferences) (ProposalSpec, error) {
	byID := map[string]ProposalReference{}
	for _, ref := range input.ReferencesMeta {
		id := strings.TrimSpace(ref.ID)
		if id == "" {
			continue
		}
		byID[id] = ref
	}
	references := make([]ProposalReference, 0)
	for _, ref := range refs.List() {
		item := ProposalReference{ID: ref.Value, Kind: ref.Kind}
		if declared, ok := byID[ref.Value]; ok {
			item.Role = declared.Role
			item.Label = declared.Label
			if declared.Kind != "" {
				item.Kind = declared.Kind
			}
		}
		references = append(references, item)
	}
	if err := validateProposalRoles(references); err != nil {
		return ProposalSpec{}, err
	}
	proposedBy := strings.TrimSpace(input.ProposedBy)
	if proposedBy != "user" {
		proposedBy = "agent"
	}
	return ProposalSpec{
		References:  references,
		AspectRatio: strings.TrimSpace(input.AspectRatio),
		DurationSec: input.DurationSec,
		Note:        strings.TrimSpace(input.Note),
		ProposedBy:  proposedBy,
		ProposedAt:  time.Now().UTC().Format(time.RFC3339Nano),
		BatchID:     strings.TrimSpace(input.BatchID),
		Origin:      input.Origin,
	}, nil
}

// proposalRoles is the controlled role vocabulary shared with the generation
// reference protocol. A declared role must be compatible with the reference
// kind; an unknown role id is rejected (fail closed).
var proposalRoles = map[string][]string{
	"pov":         {"image", "video"},
	"color-card":  {"image"},
	"environment": {"image", "video"},
	"character":   {"image"},
	"prop":        {"image"},
	"style-ref":   {"image"},
	"motion-ref":  {"video"},
	"voice":       {"audio"},
	"sfx":         {"audio"},
	"music":       {"audio"},
}

func validateProposalRoles(references []ProposalReference) error {
	for _, ref := range references {
		role := strings.TrimSpace(ref.Role)
		if role == "" {
			continue
		}
		kinds, ok := proposalRoles[role]
		if !ok {
			return fmt.Errorf("unknown reference role %q", role)
		}
		if ref.Kind == "" {
			continue
		}
		matched := false
		for _, kind := range kinds {
			if kind == ref.Kind {
				matched = true
				break
			}
		}
		if !matched {
			return fmt.Errorf("reference role %q cannot anchor a %s reference", role, ref.Kind)
		}
	}
	return nil
}

// createProposedAsset inserts the proposed asset row. It deliberately bypasses
// the job lifecycle: proposed assets have no bytes and no media_jobs binding.
func (m *MediaService) createProposedAsset(projectID, kind, mimeType string, metadata map[string]any) (MediaAsset, error) {
	id, err := newID()
	if err != nil {
		return MediaAsset{}, err
	}
	now := time.Now().UTC()
	serialized, err := json.Marshal(metadata)
	if err != nil {
		return MediaAsset{}, err
	}
	name := "proposal-" + id
	asset := MediaAsset{ID: id, Kind: kind, Name: name, MimeType: mimeType, Origin: "proposed", Status: AssetStatusProposed, Metadata: metadata, CreatedAt: now, UpdatedAt: now}
	db, err := m.database()
	if err != nil {
		return MediaAsset{}, err
	}
	tx, err := db.Begin()
	if err != nil {
		return MediaAsset{}, err
	}
	rollback := func(cause error) (MediaAsset, error) { _ = tx.Rollback(); return MediaAsset{}, cause }
	if _, err := tx.Exec("insert into media_assets (id, kind, name, mime_type, size_bytes, content_hash, origin, parent_id, status, job_id, remote_id, remote_poll_url, error, metadata_json, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", asset.ID, asset.Kind, asset.Name, asset.MimeType, 0, "", asset.Origin, "", asset.Status, "", "", "", "", string(serialized), now.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano)); err != nil {
		return rollback(err)
	}
	if projectID != "" {
		if err := attachTx(tx, asset.ID, projectID, now); err != nil {
			return rollback(err)
		}
		asset.ProjectIDs = []string{projectID}
	}
	if err := recordAssetEvent(tx, asset.ID, now); err != nil {
		return rollback(err)
	}
	if err := tx.Commit(); err != nil {
		return MediaAsset{}, err
	}
	m.publishAssetChange()
	return asset, nil
}

// ListProposals lists proposed assets for a project (or the workspace when
// projectID is empty), newest first, with the shared asset pagination.
func (m *MediaService) ListProposals(projectID string, filter MediaAssetFilter) (MediaAssetPage, error) {
	filter.Status = AssetStatusProposed
	return m.ListAssetsFiltered(projectID, filter)
}

// RejectProposal abandons a proposal via the existing soft-delete tombstone.
// The asset record (and its recipe) is preserved for audit; references to a
// proposed asset are not yet placed, so no timeline/canvas repair is needed.
func (m *MediaService) RejectProposal(assetID string) error {
	asset, err := m.GetAsset(assetID)
	if err != nil {
		return errors.New("media asset not found")
	}
	if asset.Status != AssetStatusProposed {
		return fmt.Errorf("only a proposed asset can be rejected; this asset is %s", asset.Status)
	}
	return m.DeleteAsset(assetID)
}

// ProposeInputFromAsset reconstructs the propose/submit recipe of a proposed
// asset, after applying a patch. It is the single merge point shared by
// UpdateProposal and ConfirmProposal so both observe the same validation.
func proposalInputFromAsset(asset MediaAsset, patch *ProposalPatch) (ProposeInput, error) {
	spec := readProposalSpec(asset)
	prompt, _ := asset.Metadata["prompt"].(string)
	modelID, _ := asset.Metadata["modelId"].(string)
	credentialID, _ := asset.Metadata["credentialId"].(string)
	routeID, _ := asset.Metadata["routeId"].(string)
	capability, _ := asset.Metadata["capability"].(string)
	output, _ := asset.Metadata["output"].(map[string]any)
	referenceIDs := metadataStringSlice(asset.Metadata["referenceIds"])
	references := spec.References
	if patch != nil {
		if patch.Prompt != nil {
			prompt = *patch.Prompt
		}
		if patch.ModelID != nil {
			modelID = strings.TrimSpace(*patch.ModelID)
		}
		if patch.CredentialID != nil {
			credentialID = strings.TrimSpace(*patch.CredentialID)
		}
		if patch.Output != nil {
			output = patch.Output
		}
		if patch.References != nil {
			references = *patch.References
		}
		if patch.ReferenceIDs != nil {
			referenceIDs = *patch.ReferenceIDs
		}
		if patch.AspectRatio != nil {
			spec.AspectRatio = strings.TrimSpace(*patch.AspectRatio)
		}
		if patch.DurationSec != nil {
			spec.DurationSec = *patch.DurationSec
		}
		if patch.Note != nil {
			spec.Note = strings.TrimSpace(*patch.Note)
		}
	}
	// Reference order authority: an explicit references patch wins; otherwise
	// the stored flat referenceIds; otherwise the stored references.
	if patch != nil && patch.References != nil {
		referenceIDs = proposalReferenceIDs(references)
	} else if references != nil && (patch == nil || patch.ReferenceIDs == nil) {
		referenceIDs = proposalReferenceIDs(references)
	}
	if strings.TrimSpace(prompt) == "" {
		return ProposeInput{}, errors.New("proposal prompt is empty")
	}
	return ProposeInput{
		Capability:     MediaCapability(capability),
		Route:          routeID,
		ModelID:        modelID,
		CredentialID:   credentialID,
		Prompt:         strings.TrimSpace(prompt),
		ReferenceIDs:   referenceIDs,
		Output:         output,
		ProjectID:      firstProjectID(asset),
		ReferencesMeta: references,
		AspectRatio:    spec.AspectRatio,
		DurationSec:    spec.DurationSec,
		Note:           spec.Note,
	}, nil
}

// UpdateProposal rewrites a proposal's recipe in place (prompt / references /
// model / parameters). It is confirmation-eligible only while the asset is
// still proposed; anything else fails closed so a running/completed asset can
// never be rewritten.
func (m *MediaService) UpdateProposal(assetID string, patch ProposalPatch) (MediaAsset, error) {
	asset, err := m.GetAsset(assetID)
	if err != nil {
		return MediaAsset{}, errors.New("media asset not found")
	}
	if asset.Status != AssetStatusProposed {
		return MediaAsset{}, fmt.Errorf("only a proposed asset can be edited; this asset is %s", asset.Status)
	}
	recipe, err := proposalInputFromAsset(asset, &patch)
	if err != nil {
		return MediaAsset{}, err
	}
	if err := m.applyProposalRecipe(assetID, recipe); err != nil {
		return MediaAsset{}, err
	}
	return m.GetAsset(assetID)
}

// applyProposalRecipe validates a patched recipe and rewrites the proposed
// asset's metadata. Model output and references are re-validated against the
// current catalog so an edit cannot smuggle an invalid submission past confirm.
func (m *MediaService) applyProposalRecipe(assetID string, recipe ProposeInput) error {
	if !knownCapability(recipe.Capability) {
		return errors.New("proposal capability is invalid")
	}
	route, credential, err := m.resolveRoute(proposalRouteInput(recipe.Capability, recipe.Route, recipe.ModelID, recipe.CredentialID))
	if err != nil {
		return err
	}
	model, ok := modelByID(route.ModelID)
	if !ok {
		return errors.New("media route model is unknown")
	}
	output, err := normalizeModelOutput(model, normalizedGenerationOutput(recipe.Capability, route.ModelID, recipe.Output))
	if err != nil {
		return err
	}
	if recipe.Capability == SpeechGenerate && speechVoiceID(MediaJob{Output: output}) == "" {
		if credential.Provider == "local-audio" {
			output["voiceId"] = speechLocalVoiceDefault
		} else {
			return errors.New("voiceId is required for speech generation")
		}
	}
	refs, err := m.validateReferences(GenerateMediaInput{
		Capability: recipe.Capability, ModelID: route.ModelID, References: recipe.References, ReferenceIDs: recipe.ReferenceIDs,
	})
	if err != nil {
		return err
	}
	spec, err := buildProposalSpec(recipe, refs)
	if err != nil {
		return err
	}
	// Preserve the original proposal identity/timestamp when editing.
	asset, err := m.GetAsset(assetID)
	if err != nil {
		return err
	}
	existing := readProposalSpec(asset)
	if existing.ProposedAt != "" {
		spec.ProposedAt = existing.ProposedAt
	}
	if existing.ProposedBy != "" {
		spec.ProposedBy = existing.ProposedBy
	}
	if existing.BatchID != "" {
		spec.BatchID = existing.BatchID
	}
	if existing.Origin != nil {
		spec.Origin = existing.Origin
	}

	metadata := asset.Metadata
	if metadata == nil {
		metadata = map[string]any{}
	}
	metadata["prompt"] = recipe.Prompt
	metadata["modelId"] = route.ModelID
	metadata["provider"] = credential.Provider
	metadata["capability"] = recipe.Capability
	metadata["output"] = output
	metadata["referenceIds"] = refs.Flat()
	metadata["proposal"] = spec
	if credential.ID != "" {
		metadata["credentialId"] = credential.ID
	} else {
		delete(metadata, "credentialId")
	}
	if route.ID != "" {
		metadata["routeId"] = route.ID
	}
	return m.updateProposedAssetMetadata(assetID, metadata)
}

// ConfirmProposal is the user's confirmation: it transitions the same proposed
// asset into the job lifecycle. The generation is submitted as a real job
// bound to the existing assetId, so every reference (canvas element, timeline
// clip) keeps resolving without a re-point.
func (m *MediaService) ConfirmProposal(assetID string, patch *ProposalPatch) (MediaJob, error) {
	asset, err := m.GetAsset(assetID)
	if err != nil {
		return MediaJob{}, errors.New("media asset not found")
	}
	if asset.Status != AssetStatusProposed {
		return MediaJob{}, fmt.Errorf("proposal is already %s", asset.Status)
	}
	recipe, err := proposalInputFromAsset(asset, patch)
	if err != nil {
		return MediaJob{}, err
	}
	// Re-validate the final recipe before spending money.
	if err := m.applyProposalRecipe(assetID, recipe); err != nil {
		return MediaJob{}, err
	}
	input := GenerateMediaInput{
		Capability:     recipe.Capability,
		Prompt:         recipe.Prompt,
		ReferenceIDs:   recipe.ReferenceIDs,
		Output:         recipe.Output,
		ProjectID:      recipe.ProjectID,
		IdempotencyKey: "proposal:" + assetID,
	}
	// Route resolution: a proposal created from an explicit route re-resolves
	// that route; a direct credential is passed through; a local direct model
	// has no credential and resolves by modelId alone.
	if recipe.CredentialID != "" {
		input.ModelID = recipe.ModelID
		input.CredentialID = recipe.CredentialID
	} else if recipe.Route != "" && recipe.Route != "direct" {
		input.Route = recipe.Route
	} else {
		input.ModelID = recipe.ModelID
	}
	job, err := m.generateBoundToAsset(input, assetID)
	if err != nil {
		return job, err
	}
	// Record the confirmation on the retained proposal spec.
	if current, getErr := m.GetAsset(assetID); getErr == nil {
		spec := readProposalSpec(current)
		spec.ConfirmedAt = time.Now().UTC().Format(time.RFC3339Nano)
		metadata := current.Metadata
		if metadata == nil {
			metadata = map[string]any{}
		}
		metadata["proposal"] = spec
		_ = m.updateProposedAssetMetadata(assetID, metadata)
	}
	return job, nil
}

// updateProposedAssetMetadata rewrites an asset's metadata and emits a durable
// asset event. Callers keep the asset's status untouched.
func (m *MediaService) updateProposedAssetMetadata(assetID string, metadata map[string]any) error {
	serialized, err := json.Marshal(metadata)
	if err != nil {
		return err
	}
	db, err := m.database()
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	result, err := tx.Exec("update media_assets set metadata_json = ?, updated_at = ? where id = ?", string(serialized), now.Format(time.RFC3339Nano), assetID)
	if err != nil {
		_ = tx.Rollback()
		return err
	}
	if changed, err := result.RowsAffected(); err != nil || changed != 1 {
		_ = tx.Rollback()
		if err != nil {
			return err
		}
		return errors.New("media asset not found")
	}
	if err := recordAssetEvent(tx, assetID, now); err != nil {
		_ = tx.Rollback()
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	m.publishAssetChange()
	return nil
}

// bindProposedAssetToJob is the confirmation transaction: it flips the proposed
// asset to queued and links it to the job in one write, so the scheduler sees a
// recoverable queued task and no external observer sees a half-bound state.
func (m *MediaService) bindProposedAssetToJob(assetID string, job MediaJob, provider string) (MediaAsset, error) {
	db, err := m.database()
	if err != nil {
		return MediaAsset{}, err
	}
	asset, err := scanAsset(db, db.QueryRow("select "+assetColumns+" from media_assets where id = ?", assetID))
	if err != nil {
		return MediaAsset{}, err
	}
	if asset.Status != AssetStatusProposed {
		return asset, fmt.Errorf("proposal is already %s", asset.Status)
	}
	if provider == "" {
		provider, _ = asset.Metadata["provider"].(string)
	}
	now := time.Now().UTC()
	metadata := asset.Metadata
	if metadata == nil {
		metadata = map[string]any{}
	}
	metadata["provider"] = provider
	metadata[generationStartedAtMetadataKey] = now.Format(time.RFC3339Nano)
	serialized, _ := json.Marshal(metadata)
	tx, err := db.Begin()
	if err != nil {
		return MediaAsset{}, err
	}
	rollback := func(cause error) (MediaAsset, error) { _ = tx.Rollback(); return MediaAsset{}, cause }
	// The status guard makes a double-confirm race safe: only one caller can
	// transition proposed -> queued.
	result, err := tx.Exec("update media_assets set status = ?, origin = ?, job_id = ?, error = ?, metadata_json = ?, updated_at = ? where id = ? and status = ?", "queued", "generated", job.ID, "", string(serialized), now.Format(time.RFC3339Nano), assetID, AssetStatusProposed)
	if err != nil {
		return rollback(err)
	}
	if changed, err := result.RowsAffected(); err != nil || changed != 1 {
		if err != nil {
			return rollback(err)
		}
		return rollback(errors.New("proposal was confirmed concurrently"))
	}
	assetIDs, _ := json.Marshal([]string{assetID})
	if _, err := tx.Exec("update media_jobs set status = ?, asset_ids_json = ?, error = ?, updated_at = ? where id = ?", "queued", string(assetIDs), "", now.Format(time.RFC3339Nano), job.ID); err != nil {
		return rollback(err)
	}
	if job.ProjectID != "" {
		if err := attachTx(tx, assetID, job.ProjectID, now); err != nil {
			return rollback(err)
		}
	}
	if err := recordAssetEvent(tx, assetID, now); err != nil {
		return rollback(err)
	}
	if err := tx.Commit(); err != nil {
		return MediaAsset{}, err
	}
	m.publishAssetChange()
	return m.GetAsset(assetID)
}

// proposalReferenceIDs derives the submission order from a reference binding
// list, de-duplicating by id while preserving first-seen order.
func proposalReferenceIDs(references []ProposalReference) []string {
	seen := map[string]bool{}
	ids := make([]string, 0, len(references))
	for _, ref := range references {
		id := strings.TrimSpace(ref.ID)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		ids = append(ids, id)
	}
	return ids
}

func metadataStringSlice(value any) []string {
	items, ok := value.([]any)
	if !ok {
		if typed, ok := value.([]string); ok {
			return typed
		}
		return nil
	}
	out := make([]string, 0, len(items))
	for _, item := range items {
		if text, ok := item.(string); ok {
			out = append(out, text)
		}
	}
	return out
}

func firstProjectID(asset MediaAsset) string {
	if len(asset.ProjectIDs) > 0 {
		return asset.ProjectIDs[0]
	}
	return ""
}
