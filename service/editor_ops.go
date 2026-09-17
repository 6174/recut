/*
 * [INPUT]: 依赖 editor_model 的纯模型函数。
 * [OUTPUT]: applyOp、校验与供 UI/Agent 共用的时间线读取模型（op-engine.js 的 Go 权威实现）；component clip 读回 assetId 与 componentId。
 * [POS]: service editor 域的确定性命令内核；不访问 SQLite、不注册外部 operation。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import "math"

type editorOpOptions struct {
	Seq    any
	Locale Locale
}

// applyOp 是时间线 mutation 的唯一内核；返回 { refs, element?, items?, trackId?, sceneId?, deleted? }。
func applyOp(project map[string]any, op map[string]any, opts editorOpOptions) (map[string]any, error) {
	seq := opts.Seq
	if seq == nil {
		seq = float64(0)
	}
	payload := edMap(op["payload"])
	if payload == nil {
		payload = map[string]any{}
	}
	result := map[string]any{"refs": []any{}}
	scene := findScene(project, payload["sceneId"])
	opType := edStr(op["type"])

	switch opType {
	case "insert":
		trackType := nonEmpty(edStr(payload["trackType"]), defaultTrackTypeForElement(edStr(edMap(payload["element"])["type"])))
		if payload["element"] == nil {
			payload["element"] = map[string]any{}
		}
		element := edMap(payload["element"])
		elementType := edStr(element["type"])
		isImplicitComponentPlacement := elementType == "component" && edStr(payload["trackId"]) == ""
		var track map[string]any
		if isImplicitComponentPlacement {
			track = findOrCreateAvailableTrack(scene, trackType, seq, nil, tickOf(element["startSec"]), tickOf(element["durationSec"]))
		} else {
			track = findOrCreateTrack(scene, trackType, seq, payload["trackId"])
		}
		if edStr(element["elementId"]) == "" {
			element["elementId"] = "el-ai" + edSeqString(seq) + "-" + edSeqString(element["slot"])
		}
		el := buildElement(element, seq, opts.Locale)
		if track != nil && edStr(track["type"]) == "text" && track["captionStyle"] != nil && edStr(el["type"]) == "text" && el["subtitle"] != nil {
			merged := map[string]any{}
			for k, v := range edMap(track["captionStyle"]) {
				merged[k] = v
			}
			for k, v := range edMap(el["params"]) {
				merged[k] = v
			}
			el["params"] = merged
		}
		elements := edSlice(track["elements"])
		idx := len(elements)
		if edIsNum(payload["index"]) {
			idx = int(edNum(payload["index"]))
			if idx < 0 {
				idx = 0
			}
			if idx > len(elements) {
				idx = len(elements)
			}
		}
		track["elements"] = append(elements[:idx], append([]any{el}, elements[idx:]...)...)
		ref := map[string]any{"trackId": track["id"], "elementId": el["id"]}
		result["refs"] = append(edSlice(result["refs"]), ref)
		result["element"] = map[string]any{"trackId": track["id"], "elementId": el["id"], "id": el["id"]}

	case "component-placement":
		items := edSlice(payload["items"])
		if len(items) == 0 {
			return nil, editorBizError("component-placement: items required")
		}
		placementTrackType := nonEmpty(edStr(payload["trackType"]), "graphic")
		for itemIndex, itemValue := range items {
			item := edMap(itemValue)
			raw := map[string]any{}
			for k, v := range item {
				raw[k] = v
			}
			raw["type"] = "component"
			startTime := tickOf(raw["startSec"])
			duration := tickOf(raw["durationSec"])
			if duration <= 0 {
				return nil, editorBizError("component-placement: durationSec must be positive")
			}
			placementTrack := findOrCreateAvailableTrack(scene, placementTrackType, seq, item["trackId"], startTime, duration)
			if edStr(raw["elementId"]) == "" {
				raw["elementId"] = "el-ai" + edSeqString(seq) + "-" + edSeqString(itemIndex)
			}
			placed := buildElement(raw, seq, opts.Locale)
			placementTrack["elements"] = append(edSlice(placementTrack["elements"]), placed)
			result["refs"] = append(edSlice(result["refs"]), map[string]any{"trackId": placementTrack["id"], "elementId": placed["id"]})
		}
		result["items"] = result["refs"]

	case "audio-placement":
		audioItems := edSlice(payload["items"])
		if len(audioItems) == 0 {
			return nil, editorBizError("audio-placement: items required")
		}
		audioTrackType := nonEmpty(edStr(payload["trackType"]), "audio")
		for ai, itemValue := range audioItems {
			audioItem := edMap(itemValue)
			if edStr(audioItem["mediaId"]) == "" {
				return nil, editorBizError("audio-placement: each item requires mediaId")
			}
			audioRaw := map[string]any{}
			for k, v := range audioItem {
				audioRaw[k] = v
			}
			audioRaw["type"] = "audio"
			audioRaw["sourceType"] = "upload"
			audioRaw["mediaId"] = audioItem["mediaId"]
			delete(audioRaw, "audioId")
			delete(audioRaw, "assetId")
			audioStartTime := tickOf(audioRaw["startSec"])
			audioDuration := tickOf(audioRaw["durationSec"])
			if audioDuration <= 0 {
				return nil, editorBizError("audio-placement: durationSec must be positive")
			}
			audioTrack := findOrCreateAvailableTrack(scene, audioTrackType, seq, audioItem["trackId"], audioStartTime, audioDuration)
			if edStr(audioRaw["elementId"]) == "" {
				audioRaw["elementId"] = "el-ai" + edSeqString(seq) + "-" + edSeqString(ai)
			}
			placedAudio := buildElement(audioRaw, seq, opts.Locale)
			audioTrack["elements"] = append(edSlice(audioTrack["elements"]), placedAudio)
			result["refs"] = append(edSlice(result["refs"]), map[string]any{"trackId": audioTrack["id"], "elementId": placedAudio["id"]})
		}
		result["items"] = result["refs"]

	case "delete":
		refs := edSlice(payload["refs"])
		any := false
		for _, refValue := range refs {
			ref := edMap(refValue)
			delTrack := findTrack(scene, ref["trackId"])
			if delTrack != nil && removeElementFromTrack(delTrack, ref["elementId"]) {
				any = true
			}
		}
		if !any {
			return nil, editorBizError("delete: element not found")
		}
		result["deleted"] = refs

	case "param":
		ref := edMap(payload["ref"])
		pEl := findElementInTrack(findTrack(scene, ref["trackId"]), ref["elementId"])
		if pEl == nil {
			return nil, editorBizError("param: element not found")
		}
		for k, v := range edMap(payload["params"]) {
			setParamAt(pEl, k, v, payload["atSec"])
		}
		for k, v := range edMap(payload["fields"]) {
			pEl[k] = v
		}
		result["refs"] = append(edSlice(result["refs"]), elementRefPath(ref))
		if edStr(pEl["type"]) == "text" && pEl["subtitle"] != nil {
			pTrack := findTrack(scene, ref["trackId"])
			broadcastSubtitleStyle(pTrack, pEl)
		}

	case "trim":
		ref := edMap(payload["ref"])
		trTrack := findTrack(scene, ref["trackId"])
		trEl := findElementInTrack(trTrack, ref["elementId"])
		if trEl == nil {
			return nil, editorBizError("trim: element not found")
		}
		oldStart := edNum(trEl["startTime"])
		oldEnd := oldStart + edNum(trEl["duration"])
		newStart := edNum(trEl["startTime"])
		if edHas(payload, "startSec") && payload["startSec"] != nil {
			newStart = tickOf(payload["startSec"])
		}
		if edHas(payload, "durationSec") && payload["durationSec"] != nil {
			trEl["duration"] = mathMax(tickOf(payload["durationSec"]), 1)
		}
		if edHas(payload, "trimStartSec") && payload["trimStartSec"] != nil {
			trEl["trimStart"] = mathMax(tickOf(payload["trimStartSec"]), 0)
		}
		if edHas(payload, "trimEndSec") && payload["trimEndSec"] != nil {
			trEl["trimEnd"] = mathMax(tickOf(payload["trimEndSec"]), edNum(trEl["trimStart"]))
		}
		trEl["startTime"] = mathMax(newStart, 0)
		if edBool(payload["ripple"]) {
			delta := edNum(trEl["startTime"]) + edNum(trEl["duration"]) - oldEnd
			rippleTrack(trTrack, oldEnd, delta)
		}
		result["refs"] = append(edSlice(result["refs"]), elementRefPath(ref))

	case "split":
		ref := edMap(payload["ref"])
		spTrack := findTrack(scene, ref["trackId"])
		spEl := findElementInTrack(spTrack, ref["elementId"])
		if spEl == nil {
			return nil, editorBizError("split: element not found")
		}
		localTicks := tickOf(payload["atSec"]) - edNum(spEl["startTime"])
		if localTicks <= 0 || localTicks >= edNum(spEl["duration"]) {
			return nil, editorBizError("split: atSec outside element")
		}
		retainSide := nonEmpty(edStr(payload["retainSide"]), "both")
		sourceStart := edNum(spEl["trimStart"])
		sourceEnd := sourceStart + edNum(spEl["duration"])
		if edHas(spEl, "trimEnd") && spEl["trimEnd"] != nil {
			sourceEnd = edNum(spEl["trimEnd"])
		}
		sourceSpan := sourceEnd - sourceStart
		leftDur := localTicks
		rightDur := edNum(spEl["duration"]) - localTicks
		if edStr(payload["leftElementId"]) == "" {
			payload["leftElementId"] = "el-ai" + edSeqString(seq) + "-r1"
		}
		if edStr(payload["rightElementId"]) == "" {
			payload["rightElementId"] = "el-ai" + edSeqString(seq) + "-r2"
		}
		leftClone := edCloneMap(spEl)
		rightClone := edCloneMap(spEl)
		leftClone["id"] = payload["leftElementId"]
		rightClone["id"] = payload["rightElementId"]
		leftClone["duration"] = leftDur
		leftClone["trimEnd"] = sourceStart + math.Round(sourceSpan*leftDur/edNum(spEl["duration"]))
		rightClone["startTime"] = edNum(spEl["startTime"]) + localTicks
		rightClone["duration"] = rightDur
		rightClone["trimStart"] = sourceStart + math.Round(sourceSpan*leftDur/edNum(spEl["duration"]))
		elIdx := -1
		for i, ev := range edSlice(spTrack["elements"]) {
			if e := edMap(ev); e != nil && edStr(e["id"]) == edStr(spEl["id"]) {
				elIdx = i
				break
			}
		}
		if elIdx < 0 {
			return nil, editorBizError("split: element not found")
		}
		elements := edSlice(spTrack["elements"])
		spTrack["elements"] = append(elements[:elIdx], elements[elIdx+1:]...)
		insertAt := elIdx
		keepLeft := retainSide == "left" || retainSide == "both"
		keepRight := retainSide == "right" || retainSide == "both"
		if keepLeft {
			cur := edSlice(spTrack["elements"])
			spTrack["elements"] = append(cur[:insertAt], append([]any{leftClone}, cur[insertAt:]...)...)
			insertAt++
		}
		if keepRight {
			cur := edSlice(spTrack["elements"])
			spTrack["elements"] = append(cur[:insertAt], append([]any{rightClone}, cur[insertAt:]...)...)
		}
		if keepLeft {
			result["refs"] = append(edSlice(result["refs"]), map[string]any{"trackId": spTrack["id"], "elementId": leftClone["id"]})
		}
		if keepRight {
			result["refs"] = append(edSlice(result["refs"]), map[string]any{"trackId": spTrack["id"], "elementId": rightClone["id"]})
		}

	case "keyframe-upsert":
		ref := edMap(payload["ref"])
		kfTrack := findTrack(scene, ref["trackId"])
		kfEl := findElementInTrack(kfTrack, ref["elementId"])
		if kfEl == nil {
			return nil, editorBizError("keyframe-upsert: element not found")
		}
		upsertScalarKeyframe(kfEl, edStr(payload["path"]), tickOf(payload["atSec"])-edNum(kfEl["startTime"]), payload["value"], edStr(payload["segmentToNext"]))
		result["refs"] = append(edSlice(result["refs"]), elementRefPath(ref))

	case "keyframe-remove":
		ref := edMap(payload["ref"])
		krTrack := findTrack(scene, ref["trackId"])
		krEl := findElementInTrack(krTrack, ref["elementId"])
		if krEl == nil {
			return nil, editorBizError("keyframe-remove: element not found")
		}
		path := edStr(payload["path"])
		animations := edMap(krEl["animations"])
		if animations != nil && edMap(animations[path]) != nil {
			if payload["atSec"] == nil {
				delete(animations, path)
			} else {
				at := tickOf(payload["atSec"]) - edNum(krEl["startTime"])
				channel := edMap(animations[path])
				keys := edSlice(channel["keys"])
				filtered := []any{}
				for _, kv := range keys {
					if edNum(edMap(kv)["time"]) != at {
						filtered = append(filtered, kv)
					}
				}
				channel["keys"] = filtered
				if len(filtered) == 0 {
					delete(animations, path)
				}
			}
		}
		result["refs"] = append(edSlice(result["refs"]), elementRefPath(ref))

	case "track-add":
		newTrack := addTrackToScene(scene, edStr(payload["type"]), seq, edStr(payload["name"]), payload["index"])
		result["refs"] = append(edSlice(result["refs"]), map[string]any{"trackId": newTrack["id"], "elementId": nil})
		result["trackId"] = newTrack["id"]

	case "track-remove":
		ok := removeTrackFromScene(scene, payload["trackId"])
		if !ok {
			return nil, editorBizError("track-remove: track not empty or missing")
		}

	case "track-mute":
		mTrack := findTrack(scene, payload["trackId"])
		if mTrack == nil {
			return nil, editorBizError("track-mute: track not found")
		}
		if payload["muted"] == nil {
			mTrack["muted"] = !edBool(mTrack["muted"])
		} else {
			mTrack["muted"] = edBool(payload["muted"])
		}

	case "track-visible":
		vTrack := findTrack(scene, payload["trackId"])
		if vTrack == nil {
			return nil, editorBizError("track-visible: track not found")
		}
		if payload["hidden"] == nil {
			vTrack["hidden"] = !edBool(vTrack["hidden"])
		} else {
			vTrack["hidden"] = edBool(payload["hidden"])
		}

	case "track-role":
		rTrack := findTrack(scene, payload["trackId"])
		if rTrack == nil {
			return nil, editorBizError("track-role: track not found")
		}
		role := nonEmpty(edStr(payload["role"]), "none")
		if role != "anchor" && role != "follower" && role != "none" {
			return nil, editorBizError("track-role: invalid role " + role)
		}
		if role == "none" {
			delete(rTrack, "role")
		} else {
			rTrack["role"] = role
		}
		if payload["duckDepthDb"] != nil {
			routing := edMap(rTrack["audioRouting"])
			if routing == nil {
				routing = map[string]any{}
				rTrack["audioRouting"] = routing
			}
			routing["duckDepthDb"] = edNum(payload["duckDepthDb"])
		}
		result["trackId"] = rTrack["id"]

	case "scene-create":
		newScene := map[string]any{
			"id":        "scene-ai" + edSeqString(seq),
			"name":      nonEmpty(edStr(payload["name"]), loc(opts.Locale, "场景 "+edSeqString(seq), "Scene "+edSeqString(seq))),
			"isMain":    edBool(payload["isMain"]),
			"tracks":    map[string]any{"overlay": []any{}, "main": makeTrack("video", seq, "Main"), "audio": []any{}},
			"bookmarks": []any{},
			"createdAt": nowIso(),
			"updatedAt": nowIso(),
		}
		scenes := edSlice(project["scenes"])
		project["scenes"] = append(scenes, newScene)
		if edBool(payload["isMain"]) {
			for _, sv := range edSlice(project["scenes"]) {
				if s := edMap(sv); s != nil {
					s["isMain"] = false
				}
			}
			newScene["isMain"] = true
		}
		result["sceneId"] = newScene["id"]

	case "scene-rename":
		sc := findScene(project, payload["sceneId"])
		if sc == nil {
			return nil, editorBizError("scene-rename: scene not found")
		}
		sc["name"] = payload["name"]

	case "scene-delete":
		scenes := edSlice(project["scenes"])
		delIdx := -1
		for i, sv := range scenes {
			if s := edMap(sv); s != nil && edStr(s["id"]) == edStr(payload["sceneId"]) {
				if edBool(s["isMain"]) {
					return nil, editorBizError("scene-delete: cannot delete main scene")
				}
				delIdx = i
				break
			}
		}
		if delIdx < 0 {
			return nil, editorBizError("scene-delete: scene not found")
		}
		project["scenes"] = append(scenes[:delIdx], scenes[delIdx+1:]...)

	case "bookmark-add":
		bmScene := findScene(project, payload["sceneId"])
		if bmScene == nil {
			return nil, editorBizError("bookmark-add: scene not found")
		}
		bookmarks := edSlice(bmScene["bookmarks"])
		btime := tickOf(payload["timeSec"])
		exists := false
		for _, bv := range bookmarks {
			if b := edMap(bv); b != nil && edNum(b["time"]) == btime {
				exists = true
				break
			}
		}
		if !exists {
			note := payload["note"]
			if note == nil {
				note = nil
			}
			bookmarks = append(bookmarks, map[string]any{"time": btime, "note": note})
			bmScene["bookmarks"] = bookmarks
		}

	case "bookmark-remove":
		brScene := findScene(project, payload["sceneId"])
		if brScene == nil {
			return nil, editorBizError("bookmark-remove: scene not found")
		}
		brt := tickOf(payload["timeSec"])
		filtered := []any{}
		for _, bv := range edSlice(brScene["bookmarks"]) {
			if b := edMap(bv); b != nil && edNum(b["time"]) != brt {
				filtered = append(filtered, bv)
			}
		}
		brScene["bookmarks"] = filtered

	case "settings":
		settings := edMap(project["settings"])
		if settings == nil {
			settings = map[string]any{}
			project["settings"] = settings
		}
		if payload["fps"] != nil {
			settings["fps"] = payload["fps"]
		}
		if payload["canvasSize"] != nil {
			settings["canvasSize"] = payload["canvasSize"]
		}
		if payload["background"] != nil {
			settings["background"] = payload["background"]
		}

	case "caption-style":
		csTrack := findTrack(scene, payload["trackId"])
		if csTrack == nil {
			return nil, editorBizError("caption-style: track not found")
		}
		if edStr(csTrack["type"]) != "text" {
			return nil, editorBizError("caption-style: track is not a text track")
		}
		cs := map[string]any{}
		for k, v := range edMap(csTrack["captionStyle"]) {
			cs[k] = v
		}
		for k, v := range edMap(payload["style"]) {
			cs[k] = v
		}
		delete(cs, "content")
		delete(cs, "transform.positionX")
		delete(cs, "transform.positionY")
		csTrack["captionStyle"] = cs
		var firstPosX, firstPosY any
		hasPosX, hasPosY := false, false
		for _, cueValue := range edSlice(csTrack["elements"]) {
			cue := edMap(cueValue)
			if cue == nil || edStr(cue["type"]) != "text" || cue["subtitle"] == nil {
				continue
			}
			cueParams := edMap(cue["params"])
			if !hasPosX {
				firstPosX = cueParams["transform.positionX"]
				hasPosX = true
			}
			if !hasPosY {
				firstPosY = cueParams["transform.positionY"]
				hasPosY = true
			}
			merged := map[string]any{}
			for k, v := range cs {
				merged[k] = v
			}
			content := any("")
			if cueParams["content"] != nil {
				content = cueParams["content"]
			}
			merged["content"] = content
			merged["transform.positionX"] = cueParams["transform.positionX"]
			merged["transform.positionY"] = cueParams["transform.positionY"]
			cue["params"] = merged
		}
		if firstPosX != nil {
			cs["transform.positionX"] = firstPosX
		}
		if firstPosY != nil {
			cs["transform.positionY"] = firstPosY
		}
		result["trackId"] = csTrack["id"]

	case "transcript-attach":
		ref := edMap(payload["ref"])
		taEl := findElementInTrack(findTrack(scene, ref["trackId"]), ref["elementId"])
		if taEl == nil {
			return nil, editorBizError("transcript-attach: element not found")
		}
		if edStr(payload["assetId"]) == "" {
			return nil, editorBizError("transcript-attach: assetId required")
		}
		prevT := edMap(taEl["transcript"])
		transcript := map[string]any{
			"assetId": payload["assetId"],
			"source":  nonEmpty(edStr(payload["source"]), "transcript"),
			"language": func() any {
				if payload["language"] == nil {
					return nil
				}
				return payload["language"]
			}(),
		}
		if prevT != nil && prevT["overrides"] != nil {
			transcript["overrides"] = prevT["overrides"]
		}
		taEl["transcript"] = transcript
		result["refs"] = append(edSlice(result["refs"]), elementRefPath(ref))

	case "transcript-fix":
		ref := edMap(payload["ref"])
		tfEl := findElementInTrack(findTrack(scene, ref["trackId"]), ref["elementId"])
		if tfEl == nil {
			return nil, editorBizError("transcript-fix: element not found")
		}
		transcript := edMap(tfEl["transcript"])
		if transcript == nil {
			transcript = map[string]any{"source": "transcript"}
			tfEl["transcript"] = transcript
		}
		overrides := edMap(transcript["overrides"])
		if overrides == nil {
			overrides = map[string]any{}
			transcript["overrides"] = overrides
		}
		if !edIsNum(payload["segmentIndex"]) {
			return nil, editorBizError("transcript-fix: segmentIndex required")
		}
		overrides[edSeqString(payload["segmentIndex"])] = edStr(payload["text"])
		result["refs"] = append(edSlice(result["refs"]), elementRefPath(ref))

	case "subtitle-import":
		cues := edSlice(payload["cues"])
		if len(cues) == 0 {
			return nil, editorBizError("subtitle-import: no cues")
		}
		var capTrack map[string]any
		if edStr(payload["trackId"]) != "" {
			capTrack = findTrack(scene, payload["trackId"])
			if capTrack != nil && edStr(capTrack["type"]) != "text" {
				return nil, editorBizError("subtitle-import: track is not a text track")
			}
		}
		if capTrack == nil {
			capTrack = makeTrack("text", seq, loc(opts.Locale, "字幕", "Captions"))
			t := edSceneTracks(scene)
			overlay := edSlice(t["overlay"])
			t["overlay"] = append([]any{capTrack}, overlay...)
		}
		canvas := editorDefaultCanvas
		if project["settings"] != nil {
			if cs := edMap(edMap(project["settings"])["canvasSize"]); cs != nil {
				canvas = cs
			}
		}
		baseStyle := map[string]any{}
		for k, v := range editorCoreDefaultParams {
			baseStyle[k] = v
		}
		for k, v := range editorSubtitleDefaultTextParams {
			baseStyle[k] = v
		}
		for k, v := range edMap(payload["style"]) {
			baseStyle[k] = v
		}
		for k, v := range edMap(capTrack["captionStyle"]) {
			baseStyle[k] = v
		}
		delete(baseStyle, "content")
		captionStyle := map[string]any{}
		for k, v := range baseStyle {
			captionStyle[k] = v
		}
		capTrack["captionStyle"] = captionStyle
		startTicks := float64(0)
		if payload["startSec"] != nil {
			startTicks = tickOf(payload["startSec"])
		}
		source := nonEmpty(edStr(payload["source"]), "srt")
		fontSize := edNum(editorCoreDefaultTextParams["fontSize"])
		if edIsNum(baseStyle["fontSize"]) {
			fontSize = edNum(baseStyle["fontSize"])
		}
		lineHeight := 1.2
		if edIsNum(baseStyle["lineHeight"]) {
			lineHeight = edNum(baseStyle["lineHeight"])
		}
		approxBlockHeight := fontSize * (edNum(canvas["height"]) / 90) * lineHeight
		approxMargin := edNum(canvas["height"]) * 0.05
		approxY := edNum(canvas["height"])/2 - approxMargin - approxBlockHeight/2
		for cq, cueValue := range cues {
			cueData := edMap(cueValue)
			durTicks := mathMax(tickOf(cueData["durationSec"]), 1)
			params := map[string]any{}
			for k, v := range baseStyle {
				params[k] = v
			}
			params["content"] = cueData["text"]
			params["transform.positionX"] = float64(0)
			params["transform.positionY"] = approxY
			elCue := map[string]any{
				"id":        "el-ai" + edSeqString(seq) + "-cap" + edSeqString(cq),
				"name":      "Caption " + edSeqString(cq+1),
				"type":      "text",
				"startTime": startTicks + tickOf(cueData["startSec"]),
				"duration":  durTicks,
				"trimStart": float64(0),
				"trimEnd":   durTicks,
				"params":    params,
				"subtitle":  map[string]any{"source": source, "cueIndex": float64(cq)},
			}
			capTrack["elements"] = append(edSlice(capTrack["elements"]), elCue)
		}
		captionStyle["transform.positionX"] = float64(0)
		captionStyle["transform.positionY"] = approxY
		result["trackId"] = capTrack["id"]
		firstElementID := any(nil)
		if first := edMap(firstElement(edSlice(capTrack["elements"]))); first != nil {
			firstElementID = first["id"]
		}
		result["element"] = map[string]any{"trackId": capTrack["id"], "elementId": firstElementID}
		refs := []any{}
		for _, ev := range edSlice(capTrack["elements"]) {
			e := edMap(ev)
			if e != nil && edStr(e["type"]) == "text" && e["subtitle"] != nil {
				refs = append(refs, map[string]any{"trackId": capTrack["id"], "elementId": e["id"]})
			}
		}
		result["refs"] = refs

	default:
		return nil, editorBizError("applyOp: unknown op type " + edStr(op["type"]))
	}
	return result, nil
}

func firstElement(items []any) any {
	if len(items) == 0 {
		return nil
	}
	return items[0]
}

// ---- 校验 ------------------------------------------------------------------
func validateTimeline(project map[string]any, registeredAssets []any, componentIDs []string) []any {
	violations := []any{}
	assetSet := map[string]bool{}
	for _, id := range registeredAssets {
		assetSet[edStr(id)] = true
	}
	componentSet := map[string]bool{}
	for _, id := range componentIDs {
		componentSet[id] = true
	}
	for _, sv := range edSlice(project["scenes"]) {
		scene := edMap(sv)
		tracks := edSceneTracks(scene)
		allTracks := sceneTrackList(tracks)
		for _, track := range allTracks {
			trackID := track["id"]
			for _, ev := range edSlice(track["elements"]) {
				el := edMap(ev)
				elementID := el["id"]
				ref := map[string]any{"trackId": trackID, "elementId": elementID}
				if edStr(el["mediaId"]) != "" && !assetSet[edStr(el["mediaId"])] {
					violations = append(violations, map[string]any{"code": "asset-exists", "ref": ref, "detail": "mediaId not registered: " + edStr(el["mediaId"])})
				}
				if edStr(el["type"]) == "audio" {
					sourceType := edStr(el["sourceType"])
					if sourceType == "upload" && edStr(el["mediaId"]) == "" {
						violations = append(violations, map[string]any{"code": "audio-unresolvable", "ref": ref, "detail": "audio upload requires mediaId"})
					}
					if sourceType == "library" && edStr(el["sourceUrl"]) == "" {
						violations = append(violations, map[string]any{"code": "audio-unresolvable", "ref": ref, "detail": "audio library requires sourceUrl"})
					}
					if sourceType != "upload" && sourceType != "library" {
						violations = append(violations, map[string]any{"code": "audio-unresolvable", "ref": ref, "detail": "audio sourceType must be upload or library"})
					}
				}
				if edNum(el["duration"]) <= 0 {
					violations = append(violations, map[string]any{"code": "duration>0", "ref": ref, "detail": "duration <= 0"})
				}
				if edHas(el, "trimEnd") && el["trimEnd"] != nil && edNum(el["trimStart"]) > edNum(el["trimEnd"]) {
					violations = append(violations, map[string]any{"code": "out-of-range", "ref": ref, "detail": "trimStart > trimEnd"})
				}
				if edStr(el["type"]) == "component" && edStr(el["componentId"]) != "" && !componentSet[edStr(el["componentId"])] {
					violations = append(violations, map[string]any{"code": "component-def", "ref": ref, "detail": "unknown componentId: " + edStr(el["componentId"])})
				}
				if bm := edMap(el["params"])["blendMode"]; bm != nil && !editorContainsString(editorDefaultBlendModes, edStr(bm)) {
					violations = append(violations, map[string]any{"code": "param-valid", "ref": ref, "detail": "invalid blendMode: " + edStr(bm)})
				}
				if opacity := edMap(el["params"])["opacity"]; opacity != nil && edIsNum(opacity) && (edNum(opacity) < 0 || edNum(opacity) > 1) {
					violations = append(violations, map[string]any{"code": "param-valid", "ref": ref, "detail": "opacity out of [0,1]"})
				}
				if transcript := edMap(el["transcript"]); transcript != nil && edStr(transcript["assetId"]) == "" && len(edSlice(transcript["segments"])) == 0 {
					violations = append(violations, map[string]any{"code": "transcript-src", "ref": ref, "detail": "transcript declared without source (assetId or segments)"})
				}
				if edStr(el["type"]) == "effect" && edStr(el["effectType"]) == "" {
					violations = append(violations, map[string]any{"code": "effect-type", "ref": ref, "detail": "effect element without effectType (use library.browse ids)"})
				}
			}
		}
		if main := edMap(tracks["main"]); main != nil {
			sorted := []map[string]any{}
			for _, ev := range edSlice(main["elements"]) {
				sorted = append(sorted, edMap(ev))
			}
			for i := 1; i < len(sorted); i++ {
				for j := i; j > 0 && edNum(sorted[j-1]["startTime"]) > edNum(sorted[j]["startTime"]); j-- {
					sorted[j-1], sorted[j] = sorted[j], sorted[j-1]
				}
			}
			for o := 1; o < len(sorted); o++ {
				if edNum(sorted[o]["startTime"]) < edNum(sorted[o-1]["startTime"])+edNum(sorted[o-1]["duration"]) {
					violations = append(violations, map[string]any{"code": "overlap", "ref": map[string]any{"trackId": main["id"], "elementId": sorted[o]["id"]}, "detail": "overlaps " + edStr(sorted[o-1]["id"])})
				}
			}
		}
	}
	return violations
}

// ---- condensed 读取 ---------------------------------------------------------
func condensedClip(el map[string]any, trackID any) map[string]any {
	p := edMap(el["params"])
	params := map[string]any{
		"transform": map[string]any{
			"positionX": edFirstNum(p["transform.positionX"], 0),
			"positionY": edFirstNum(p["transform.positionY"], 0),
			"scaleX":    edFirstNum(p["transform.scaleX"], 1),
			"scaleY":    edFirstNum(p["transform.scaleY"], 1),
			"rotate":    edFirstNum(p["transform.rotate"], 0),
		},
		"opacity":   edFirstNum(p["opacity"], 1),
		"blendMode": edFirstStr(p["blendMode"], "normal"),
	}
	if p["volume"] != nil {
		params["volume"] = p["volume"]
	}
	if edStr(el["type"]) == "text" {
		params["text"] = map[string]any{"content": edFirstStr(p["content"], ""), "fontSize": p["fontSize"], "color": p["color"]}
	}
	clip := map[string]any{
		"ref":           map[string]any{"trackId": trackID, "elementId": el["id"]},
		"type":          el["type"],
		"name":          el["name"],
		"startSec":      secOf(edNum(el["startTime"])),
		"durationSec":   secOf(edNum(el["duration"])),
		"trimStartSec":  secOf(edNum(el["trimStart"])),
		"trimEndSec":    secOf(edNum(el["trimEnd"])),
		"params":        params,
		"keyframeCount": countKeyframes(el),
		"effectCount":   len(edSlice(el["effects"])),
		"maskCount":     len(edSlice(el["masks"])),
		"muted":         el["isSourceAudioEnabled"] == false || edBool(p["muted"]),
		"hidden":        edBool(el["hidden"]),
		"mediaId":       el["mediaId"],
		"assetId":       el["assetId"],
		"componentId":   el["componentId"],
		"definitionId":  el["definitionId"],
		"effectType":    el["effectType"],
		"sourceType":    el["sourceType"],
		"sourceUrl":     el["sourceUrl"],
		"hasTranscript": el["transcript"] != nil,
	}
	if subtitle := edMap(el["subtitle"]); subtitle != nil {
		clip["subtitle"] = map[string]any{"source": subtitle["source"], "cueIndex": subtitle["cueIndex"]}
	}
	if transcript := edMap(el["transcript"]); transcript != nil {
		entry := map[string]any{"source": transcript["source"]}
		if edStr(transcript["language"]) != "" {
			entry["language"] = transcript["language"]
		}
		clip["transcript"] = entry
	}
	return clip
}

func countKeyframes(el map[string]any) int {
	animations := edMap(el["animations"])
	if animations == nil {
		return 0
	}
	n := 0
	for _, channel := range animations {
		n += len(edSlice(edMap(channel)["keys"]))
	}
	return n
}

func condensedTimeline(project map[string]any) map[string]any {
	scenes := edSlice(project["scenes"])
	clips := []any{}
	tracks := []any{}
	maxEnd := float64(0)
	activeScene := findScene(project, project["currentSceneId"])
	activeSceneID := any(nil)
	if activeScene != nil {
		activeSceneID = activeScene["id"]
	} else if len(scenes) > 0 {
		activeSceneID = edMap(scenes[0])["id"]
	}
	for _, sv := range scenes {
		scene := edMap(sv)
		for _, track := range sceneTrackList(edSceneTracks(scene)) {
			els := edSlice(track["elements"])
			tracks = append(tracks, map[string]any{
				"trackId":      track["id"],
				"type":         track["type"],
				"name":         track["name"],
				"muted":        edBool(track["muted"]),
				"hidden":       edBool(track["hidden"]),
				"role":         trackRole(track),
				"audioRouting": track["audioRouting"],
				"captionStyle": track["captionStyle"],
				"clipCount":    len(els),
			})
			for _, ev := range els {
				el := edMap(ev)
				end := edNum(el["startTime"]) + edNum(el["duration"])
				if end > maxEnd {
					maxEnd = end
				}
				clips = append(clips, condensedClip(el, track["id"]))
			}
		}
	}
	sortClipsByStart(clips)
	var settings any
	if project["settings"] != nil {
		settings = project["settings"]
	}
	return map[string]any{
		"currentSceneId": activeSceneID,
		"durationSec":    maxEnd / editorTicksPerSecond,
		"tracks":         tracks,
		"clips":          clips,
		"settings":       settings,
	}
}

func sortClipsByStart(clips []any) {
	for i := 1; i < len(clips); i++ {
		for j := i; j > 0; j-- {
			a := edNum(edMap(clips[j-1])["startSec"])
			b := edNum(edMap(clips[j])["startSec"])
			if a <= b {
				break
			}
			clips[j-1], clips[j] = clips[j], clips[j-1]
		}
	}
}

func elementDetail(project map[string]any, ref map[string]any) map[string]any {
	var track map[string]any
	if edStr(ref["sceneId"]) != "" {
		scene := findScene(project, ref["sceneId"])
		if scene != nil {
			track = findTrack(scene, ref["trackId"])
		}
	} else {
		scene := findScene(project, nil)
		if scene != nil {
			track = findTrack(scene, ref["trackId"])
		}
	}
	el := findElementInTrack(track, ref["elementId"])
	if el == nil {
		for _, sv := range edSlice(project["scenes"]) {
			t := findTrack(edMap(sv), ref["trackId"])
			el = findElementInTrack(t, ref["elementId"])
			if el != nil {
				break
			}
		}
	}
	if el == nil {
		return nil
	}
	animations := map[string]any{}
	for path, channelValue := range edMap(el["animations"]) {
		channel := edMap(channelValue)
		animations[path] = map[string]any{"keyCount": len(edSlice(channel["keys"])), "keys": channel["keys"]}
	}
	detail := map[string]any{
		"ref":           map[string]any{"trackId": ref["trackId"], "elementId": ref["elementId"]},
		"type":          el["type"],
		"name":          el["name"],
		"startSec":      secOf(edNum(el["startTime"])),
		"startTicks":    edNum(el["startTime"]),
		"durationSec":   secOf(edNum(el["duration"])),
		"durationTicks": edNum(el["duration"]),
		"trimStartSec":  secOf(edNum(el["trimStart"])),
		"trimEndSec":    secOf(edNum(el["trimEnd"])),
		"params":        nonNilMap(el["params"]),
		"animations":    animations,
		"effects":       nonNilSlice(el["effects"]),
		"masks":         nonNilSlice(el["masks"]),
		"mediaId":       el["mediaId"],
		"assetId":       el["assetId"],
		"componentId":   el["componentId"],
		"definitionId":  el["definitionId"],
		"effectType":    el["effectType"],
		"sourceType":    el["sourceType"],
		"sourceUrl":     el["sourceUrl"],
		"retime":        el["retime"],
		"hidden":        edBool(el["hidden"]),
		"hasTranscript": el["transcript"] != nil,
	}
	if el["subtitle"] != nil {
		detail["subtitle"] = el["subtitle"]
	}
	if transcript := edMap(el["transcript"]); transcript != nil {
		entry := map[string]any{"source": transcript["source"]}
		if edStr(transcript["language"]) != "" {
			entry["language"] = transcript["language"]
		}
		detail["transcript"] = entry
	}
	return detail
}

// ---- 小工具 -----------------------------------------------------------------
func editorBizError(message string) error {
	return &mcpError{Kind: "business", Code: "invalid-request", Message: message}
}

func editorContainsString(list []string, value string) bool {
	for _, item := range list {
		if item == value {
			return true
		}
	}
	return false
}

func edFirstNum(v any, fallback float64) float64 {
	if edIsNum(v) {
		return edNum(v)
	}
	return fallback
}

func edFirstStr(v any, fallback string) string {
	if s, ok := v.(string); ok {
		return s
	}
	return fallback
}

func nonNilMap(v any) map[string]any {
	if m := edMap(v); m != nil {
		return m
	}
	return map[string]any{}
}

func nonNilSlice(v any) []any {
	if s := edSlice(v); s != nil {
		return s
	}
	return []any{}
}

func mathMax(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}
