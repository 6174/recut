/*
 * [INPUT]: 无外部依赖；供 editor ops/store/handlers 共享的时间线原语（model-base.js 的 Go 权威实现）。
 * [OUTPUT]: tick、轨道、元素、关键帧与自动混音的纯函数；motion-graphic 元素保留 assetId 与 componentId。
 * [POS]: service editor 域的基础层；Go 为 timeline 变更/校验/读模型的唯一权威实现，渲染端只消费不复制。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"encoding/json"
	"math"
	"math/rand"
	"strconv"
	"time"
)

// ============================================================================
// AI Model Core —— 纯函数，无 DB/React 依赖。与 apps/editor/background/model-base.js 等价。
// ============================================================================

const editorTicksPerSecond = 120000

var editorDefaultFPS = map[string]any{"numerator": float64(30), "denominator": float64(1)}
var editorDefaultCanvas = map[string]any{"width": float64(1920), "height": float64(1080)}
var editorDefaultBlendModes = []string{
	"normal", "multiply", "screen", "overlay", "darken", "lighten",
	"color-dodge", "color-burn", "hard-light", "soft-light", "difference",
	"exclusion", "hue", "saturation", "color", "luminosity", "additive",
}

var editorCoreDefaultParams = map[string]any{
	"transform.positionX": float64(0),
	"transform.positionY": float64(0),
	"transform.positionZ": float64(0),
	"transform.scaleX":    float64(1),
	"transform.scaleY":    float64(1),
	"transform.rotate":    float64(0),
	"opacity":             float64(1),
	"blendMode":           "normal",
}

var editorCoreDefaultTextParams = map[string]any{
	"content":        "文本",
	"fontFamily":     "sans-serif",
	"fontSize":       float64(72),
	"color":          "#FFFFFF",
	"textAlign":      "center",
	"fontWeight":     "400",
	"fontStyle":      "normal",
	"textDecoration": "none",
	"letterSpacing":  float64(0),
	"lineHeight":     float64(1.2),
}

var editorCoreDefaultAudioParams = map[string]any{"volume": float64(0), "muted": false}

var editorSubtitleDefaultTextParams = map[string]any{
	"fontFamily":     "Arial",
	"fontSize":       float64(5),
	"color":          "#FFFFFF",
	"textAlign":      "center",
	"fontWeight":     "bold",
	"fontStyle":      "normal",
	"textDecoration": "none",
	"letterSpacing":  float64(0),
	"lineHeight":     float64(1.2),
}

const editorDuckDefaultDepthDB = 8.0
const editorDuckFadeSilenceDB = -100.0
const editorAudioSmoothFadeMS = 120.0

// ---- 类型安全的 JSON 访问辅助（JSON 反序列化后数值一律 float64）--------------
func edMap(v any) map[string]any {
	if m, ok := v.(map[string]any); ok {
		return m
	}
	return nil
}

func edSlice(v any) []any {
	if s, ok := v.([]any); ok {
		return s
	}
	return nil
}

func edStr(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

// edNum 取任意 JSON 数值为 float64（等同 JS number）。
func edNum(v any) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case float32:
		return float64(n)
	case int:
		return float64(n)
	case int64:
		return float64(n)
	case json.Number:
		f, _ := n.Float64()
		return f
	default:
		return 0
	}
}

// edIsNum 判断 v 是否是 JSON 数值（区别于 nil/字符串）。
func edIsNum(v any) bool {
	switch v.(type) {
	case float64, float32, int, int64, json.Number:
		return true
	default:
		return false
	}
}

func edBool(v any) bool {
	b, _ := v.(bool)
	return b
}

// edHas 判断对象是否显式包含某 key（用于区分 undefined 与零值）。
func edHas(m map[string]any, key string) bool {
	if m == nil {
		return false
	}
	_, ok := m[key]
	return ok
}

func edClone(v any) any {
	switch value := v.(type) {
	case map[string]any:
		out := make(map[string]any, len(value))
		for k, item := range value {
			out[k] = edClone(item)
		}
		return out
	case []any:
		out := make([]any, len(value))
		for i, item := range value {
			out[i] = edClone(item)
		}
		return out
	default:
		return v
	}
}

func edCloneMap(v any) map[string]any {
	if m := edMap(v); m != nil {
		return edClone(m).(map[string]any)
	}
	return map[string]any{}
}

func edCloneSlice(v any) []any {
	if s := edSlice(v); s != nil {
		return edClone(s).([]any)
	}
	return []any{}
}

func nowIso() string {
	return time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
}

func edRandomSuffix() string {
	const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, 8)
	for i := range b {
		b[i] = alphabet[rand.Intn(len(alphabet))]
	}
	return string(b)
}

// ---- tick 换算 --------------------------------------------------------------
func tickOf(sec any) float64 {
	v := edNum(sec)
	return math.Round(v * editorTicksPerSecond)
}

func secOf(ticks float64) float64 {
	return ticks / editorTicksPerSecond
}

func edClamp(v, lo, hi float64) float64 {
	return math.Max(lo, math.Min(hi, v))
}

// loc：用户可见字符串双语（zh fallback，en 由 locale 提供）。
func loc(locale Locale, zh, en string) string {
	if locale == LocaleEn {
		return en
	}
	return zh
}

func coreParamsForType(elementType string) map[string]any {
	p := map[string]any{}
	for k, v := range editorCoreDefaultParams {
		p[k] = v
	}
	if elementType == "text" {
		for k, v := range editorCoreDefaultTextParams {
			p[k] = v
		}
	}
	if elementType == "audio" {
		for k, v := range editorCoreDefaultAudioParams {
			p[k] = v
		}
	}
	return p
}

func makeTrack(trackType string, seq any, name string) map[string]any {
	suffix := ""
	if seq == nil {
		suffix = "-" + edRandomSuffix()
	} else {
		suffix = "-ai" + edSeqString(seq)
	}
	if name == "" {
		name = trackDefaultName(trackType)
	}
	return map[string]any{
		"id":       "track-" + trackType + suffix,
		"name":     name,
		"type":     trackType,
		"elements": []any{},
		"muted":    false,
		"hidden":   false,
	}
}

func edSeqString(seq any) string {
	if s, ok := seq.(string); ok {
		return s
	}
	f := edNum(seq)
	if f == math.Trunc(f) {
		return strconv.Itoa(int(f))
	}
	return strconv.FormatFloat(f, 'f', -1, 64)
}

func trackDefaultName(trackType string) string {
	names := map[string]string{"video": "Main", "text": "Text", "audio": "Audio", "graphic": "Graphic", "effect": "Effect"}
	if n, ok := names[trackType]; ok {
		return n
	}
	return "Track"
}

func findScene(project map[string]any, sceneID any) map[string]any {
	scenes := edSlice(project["scenes"])
	if scenes == nil {
		return nil
	}
	id := edStr(sceneID)
	if id != "" {
		for _, sv := range scenes {
			scene := edMap(sv)
			if scene != nil && edStr(scene["id"]) == id {
				return scene
			}
		}
	}
	for _, sv := range scenes {
		scene := edMap(sv)
		if scene != nil && edBool(scene["isMain"]) {
			return scene
		}
	}
	if len(scenes) > 0 {
		return edMap(scenes[0])
	}
	return nil
}

func edSceneTracks(scene map[string]any) map[string]any {
	tracks := edMap(scene["tracks"])
	if tracks == nil {
		tracks = map[string]any{"overlay": []any{}, "main": nil, "audio": []any{}}
		scene["tracks"] = tracks
	}
	if main := edMap(tracks["main"]); main == nil {
		main = makeTrack("video", nil, "Main")
		main["type"] = "video"
		tracks["main"] = main
	}
	if tracks["overlay"] == nil {
		tracks["overlay"] = []any{}
	}
	if tracks["audio"] == nil {
		tracks["audio"] = []any{}
	}
	return tracks
}

func sceneTrackList(tracks map[string]any) []map[string]any {
	out := []map[string]any{}
	if main := edMap(tracks["main"]); main != nil {
		out = append(out, main)
	}
	for _, group := range []string{"overlay", "audio"} {
		for _, tv := range edSlice(tracks[group]) {
			if track := edMap(tv); track != nil {
				out = append(out, track)
			}
		}
	}
	return out
}

func findTrack(scene map[string]any, trackID any) map[string]any {
	t := edSceneTracks(scene)
	id := edStr(trackID)
	if id == "" && trackID == nil {
		return nil
	}
	if main := edMap(t["main"]); main != nil && edStr(main["id"]) == id {
		return main
	}
	for _, group := range []string{"overlay", "audio"} {
		for _, tv := range edSlice(t[group]) {
			track := edMap(tv)
			if track != nil && edStr(track["id"]) == id {
				return track
			}
		}
	}
	return nil
}

func defaultTrackTypeForElement(elementType string) string {
	switch elementType {
	case "video", "image":
		return "video"
	case "text":
		return "text"
	case "audio":
		return "audio"
	case "graphic", "component":
		return "graphic"
	case "effect":
		return "effect"
	default:
		return "video"
	}
}

func findOrCreateTrack(scene map[string]any, trackType string, seq any, trackID any) map[string]any {
	t := edSceneTracks(scene)
	if edStr(trackID) != "" {
		if existing := findTrack(scene, trackID); existing != nil {
			return existing
		}
	}
	if trackType == "video" {
		if main := edMap(t["main"]); main != nil && edSlice(main["elements"]) != nil && edStr(main["type"]) == "video" {
			return main
		}
		main := edMap(t["main"])
		if main == nil {
			main = makeTrack("video", seq, "Main")
		}
		t["main"] = main
		return main
	}
	group := "overlay"
	if trackType == "audio" {
		group = "audio"
	}
	arr := edSlice(t[group])
	for _, tv := range arr {
		if track := edMap(tv); track != nil && edStr(track["type"]) == trackType {
			return track
		}
	}
	track := makeTrack(trackType, seq, "")
	t[group] = append(arr, track)
	return track
}

func spansOverlap(startA, endA, startB, endB float64) bool {
	return startA < endB && startB < endA
}

func trackCanPlaceSpan(track map[string]any, startTime, duration float64) bool {
	endTime := startTime + duration
	for _, ev := range edSlice(track["elements"]) {
		existing := edMap(ev)
		if existing == nil {
			continue
		}
		if spansOverlap(startTime, endTime, edNum(existing["startTime"]), edNum(existing["startTime"])+edNum(existing["duration"])) {
			return false
		}
	}
	return true
}

// findOrCreateAvailableTrack 组件批量放置的唯一避碰入口：按同类型轨的稳定顺序复用空时段。
func findOrCreateAvailableTrack(scene map[string]any, trackType string, seq any, trackID any, startTime, duration float64) map[string]any {
	if edStr(trackID) != "" {
		return findOrCreateTrack(scene, trackType, seq, trackID)
	}
	t := edSceneTracks(scene)
	var arr []any
	if trackType == "audio" {
		arr = edSlice(t["audio"])
	} else if trackType == "video" {
		arr = []any{t["main"]}
	} else {
		arr = edSlice(t["overlay"])
	}
	for _, tv := range arr {
		track := edMap(tv)
		if track != nil && edStr(track["type"]) == trackType && trackCanPlaceSpan(track, startTime, duration) {
			return track
		}
	}
	if trackType == "video" {
		if main := edMap(t["main"]); main != nil && edStr(main["type"]) == "video" && trackCanPlaceSpan(main, startTime, duration) {
			return main
		}
	}
	attempt := 0
	var created map[string]any
	for {
		trackSequence := seq
		if attempt > 0 {
			trackSequence = edSeqString(seq) + "-" + strconv.Itoa(attempt)
		}
		created = makeTrack(trackType, trackSequence, "")
		attempt++
		if findTrack(scene, created["id"]) == nil {
			break
		}
	}
	if trackType == "audio" {
		t["audio"] = append(edSlice(t["audio"]), created)
	} else {
		t["overlay"] = append(edSlice(t["overlay"]), created)
	}
	return created
}

func addTrackToScene(scene map[string]any, trackType string, seq any, name string, index any) map[string]any {
	t := edSceneTracks(scene)
	if trackType == "video" {
		existingMain := edMap(t["main"])
		if existingMain != nil && len(edSlice(existingMain["elements"])) == 0 && (name == "" || edStr(existingMain["name"]) == "Main") {
			if name != "" {
				existingMain["name"] = name
			}
			return existingMain
		}
		trackName := name
		if trackName == "" {
			trackName = "Video " + strconv.Itoa(len(edSlice(t["overlay"]))+1)
		}
		track := makeTrack("video", seq, trackName)
		track["type"] = "video"
		overlay := edSlice(t["overlay"])
		if edIsNum(index) {
			i := int(edNum(index))
			if i < 0 {
				i = 0
			}
			if i > len(overlay) {
				i = len(overlay)
			}
			overlay = append(overlay[:i], append([]any{track}, overlay[i:]...)...)
		} else {
			overlay = append(overlay, track)
		}
		t["overlay"] = overlay
		return track
	}
	group := "overlay"
	if trackType == "audio" {
		group = "audio"
	}
	track := makeTrack(trackType, seq, name)
	arr := edSlice(t[group])
	if edIsNum(index) {
		i := int(edNum(index))
		if i < 0 {
			i = 0
		}
		if i > len(arr) {
			i = len(arr)
		}
		arr = append(arr[:i], append([]any{track}, arr[i:]...)...)
	} else {
		arr = append(arr, track)
	}
	t[group] = arr
	return track
}

func removeTrackFromScene(scene map[string]any, trackID any) bool {
	t := edSceneTracks(scene)
	id := edStr(trackID)
	if main := edMap(t["main"]); main != nil && edStr(main["id"]) == id {
		if len(edSlice(main["elements"])) > 0 {
			return false
		}
		return true
	}
	for _, group := range []string{"overlay", "audio"} {
		arr := edSlice(t[group])
		for i, tv := range arr {
			track := edMap(tv)
			if track == nil || edStr(track["id"]) != id {
				continue
			}
			if len(edSlice(track["elements"])) > 0 {
				return false
			}
			t[group] = append(arr[:i], arr[i+1:]...)
			return true
		}
	}
	return false
}

func buildElement(payload map[string]any, seq any, locale Locale) map[string]any {
	elementType := edStr(payload["type"])
	// 旧命名兼容：历史 op / 文档里的 "component" 归一到 "component"。
	if elementType == "component" {
		elementType = "component"
	}
	elementID := edStr(payload["elementId"])
	if elementID == "" {
		elementID = "el-ai" + edSeqString(seq) + "-" + edSeqString(payload["slot"])
	}
	params := coreParamsForType(elementType)
	for k, v := range edMap(payload["params"]) {
		params[k] = v
	}
	el := map[string]any{
		"id":        elementID,
		"name":      nonEmpty(edStr(payload["name"]), defaultElementName(elementType, locale)),
		"type":      elementType,
		"startTime": tickOf(payload["startSec"]),
		"duration":  math.Max(tickOf(payload["durationSec"]), 1),
		"trimStart": tickOf(payload["trimStartSec"]),
		"trimEnd":   tickOf(payload["trimEndSec"]),
		"params":    params,
	}
	switch elementType {
	case "video", "image":
		el["mediaId"] = payload["mediaId"]
	case "text":
		if content, ok := payload["content"].(string); ok {
			params["content"] = content
		}
		if edBool(payload["subtitle"]) {
			subtitle := map[string]any{"source": nonEmpty(edStr(payload["subtitleSource"]), "srt")}
			if edIsNum(payload["subtitleCueIndex"]) {
				subtitle["cueIndex"] = payload["subtitleCueIndex"]
			}
			el["subtitle"] = subtitle
		}
	case "graphic":
		el["definitionId"] = nonEmpty(edStr(payload["definitionId"]), "rectangle")
	case "component":
		el["assetId"] = payload["assetId"]
		el["componentId"] = payload["componentId"]
	case "effect":
		el["effectType"] = payload["effectType"]
	case "audio":
		if edStr(payload["sourceType"]) == "library" {
			el["sourceType"] = "library"
			el["sourceUrl"] = payload["sourceUrl"]
		} else {
			el["sourceType"] = "upload"
			el["mediaId"] = payload["mediaId"]
		}
	}
	if !edHas(payload, "trimEndSec") || payload["trimEndSec"] == nil {
		el["trimEnd"] = el["duration"]
	}
	if transcript := payload["transcript"]; transcript != nil {
		el["transcript"] = transcript
	}
	el["hidden"] = edBool(payload["hidden"])
	return el
}

func defaultElementName(elementType string, locale Locale) string {
	names := map[string]string{}
	if locale == LocaleEn {
		names = map[string]string{"video": "Video", "image": "Image", "text": "Text", "graphic": "Graphic", "component": "Motion Graphic", "audio": "Audio", "effect": "Effect"}
	} else {
		names = map[string]string{"video": "视频", "image": "图片", "text": "文本", "graphic": "图形", "component": "Motion Graphic", "audio": "音频", "effect": "特效"}
	}
	if n, ok := names[elementType]; ok {
		return n
	}
	return elementType
}

func upsertScalarKeyframe(element map[string]any, path string, atTicks float64, value any, segmentToNext string) {
	if segmentToNext == "" {
		segmentToNext = "linear"
	}
	animations := edMap(element["animations"])
	if animations == nil {
		animations = map[string]any{}
		element["animations"] = animations
	}
	channel := edMap(animations[path])
	keys := edSlice(channel["keys"])
	if channel == nil || len(keys) == 0 {
		animations[path] = map[string]any{"keys": []any{
			map[string]any{"value": value, "time": atTicks, "segmentToNext": segmentToNext, "leftHandle": nil, "rightHandle": nil, "tangentMode": "auto"},
		}}
		return
	}
	for _, kv := range keys {
		key := edMap(kv)
		if key != nil && edNum(key["time"]) == atTicks {
			key["value"] = value
			return
		}
	}
	keys = append(keys, map[string]any{"value": value, "time": atTicks, "segmentToNext": segmentToNext, "leftHandle": nil, "rightHandle": nil, "tangentMode": "auto"})
	sortKeysByTime(keys)
	channel["keys"] = keys
}

func sortKeysByTime(keys []any) {
	// 稳定排序，保持同 time 的既有顺序（与 JS Array.sort 稳定语义一致）。
	for i := 1; i < len(keys); i++ {
		for j := i; j > 0; j-- {
			a := edMap(keys[j-1])
			b := edMap(keys[j])
			if edNum(a["time"]) <= edNum(b["time"]) {
				break
			}
			keys[j-1], keys[j] = keys[j], keys[j-1]
		}
	}
}

func setParamAt(element map[string]any, path string, value any, atSec any) {
	var atTicks *float64
	if atSec != nil {
		v := tickOf(atSec) - edNum(element["startTime"])
		atTicks = &v
	}
	channel := edMap(edMap(element["animations"])[path])
	hasKeyframes := channel != nil && len(edSlice(channel["keys"])) > 0
	if hasKeyframes && atTicks != nil {
		upsertScalarKeyframe(element, path, *atTicks, value, "linear")
		return
	}
	params := edMap(element["params"])
	if params == nil {
		params = map[string]any{}
		element["params"] = params
	}
	params[path] = value
}

func elementRefPath(ref map[string]any) map[string]any {
	return map[string]any{"trackId": ref["trackId"], "elementId": ref["elementId"]}
}

func findElementInTrack(track map[string]any, elementID any) map[string]any {
	if track == nil {
		return nil
	}
	id := edStr(elementID)
	for _, ev := range edSlice(track["elements"]) {
		el := edMap(ev)
		if el != nil && edStr(el["id"]) == id {
			return el
		}
	}
	return nil
}

func removeElementFromTrack(track map[string]any, elementID any) bool {
	if track == nil {
		return false
	}
	id := edStr(elementID)
	arr := edSlice(track["elements"])
	for i, ev := range arr {
		el := edMap(ev)
		if el != nil && edStr(el["id"]) == id {
			track["elements"] = append(arr[:i], arr[i+1:]...)
			return true
		}
	}
	return false
}

func rippleTrack(track map[string]any, afterTimeTicks, deltaTicks float64) {
	if track == nil || deltaTicks == 0 {
		return
	}
	for _, ev := range edSlice(track["elements"]) {
		el := edMap(ev)
		if el == nil {
			continue
		}
		if edNum(el["startTime"]) >= afterTimeTicks {
			el["startTime"] = math.Max(0, edNum(el["startTime"])+deltaTicks)
		}
	}
}

// ---- 自动混音 ---------------------------------------------------------------
func dBToLinearCore(db float64) float64 {
	return math.Pow(10, db/20)
}

func trackRole(track map[string]any) string {
	if track != nil {
		if role := edStr(track["role"]); role != "" {
			return role
		}
	}
	return "none"
}

type editorDuckSpan struct {
	StartSec float64
	EndSec   float64
}

type editorDuckEnvelope struct {
	DepthDB    float64
	Spans      []editorDuckSpan
	DuckFactor float64
}

func (e editorDuckEnvelope) factorAt(sec float64) float64 {
	for _, span := range e.Spans {
		if sec >= span.StartSec && sec < span.EndSec {
			return e.DuckFactor
		}
	}
	return 1
}

func collectAnchorSpans(scene map[string]any) []editorDuckSpan {
	spans := []editorDuckSpan{}
	for _, track := range sceneTrackList(edSceneTracks(scene)) {
		if trackRole(track) != "anchor" || edBool(track["muted"]) {
			continue
		}
		for _, ev := range edSlice(track["elements"]) {
			el := edMap(ev)
			if el == nil {
				continue
			}
			elementType := edStr(el["type"])
			if elementType != "audio" && elementType != "video" {
				continue
			}
			params := edMap(el["params"])
			if edBool(params["muted"]) {
				continue
			}
			vol := float64(0)
			if edIsNum(params["volume"]) {
				vol = edNum(params["volume"])
			}
			if vol <= editorDuckFadeSilenceDB+40 {
				continue
			}
			start := secOf(edNum(el["startTime"]))
			end := secOf(edNum(el["startTime"]) + edNum(el["duration"]))
			if end <= start {
				continue
			}
			spans = append(spans, editorDuckSpan{StartSec: start, EndSec: end})
		}
	}
	for i := 1; i < len(spans); i++ {
		for j := i; j > 0 && spans[j-1].StartSec > spans[j].StartSec; j-- {
			spans[j-1], spans[j] = spans[j], spans[j-1]
		}
	}
	merged := []editorDuckSpan{}
	for _, cur := range spans {
		if len(merged) > 0 && cur.StartSec <= merged[len(merged)-1].EndSec {
			if cur.EndSec > merged[len(merged)-1].EndSec {
				merged[len(merged)-1].EndSec = cur.EndSec
			}
			continue
		}
		merged = append(merged, cur)
	}
	return merged
}

func autoInitDuckDepth(scene map[string]any) float64 {
	sum := 0.0
	n := 0
	for _, track := range sceneTrackList(edSceneTracks(scene)) {
		if trackRole(track) != "anchor" {
			continue
		}
		for _, ev := range edSlice(track["elements"]) {
			el := edMap(ev)
			if el == nil {
				continue
			}
			params := edMap(el["params"])
			v := 0.0
			if edIsNum(params["volume"]) {
				v = edNum(params["volume"])
			}
			if v > editorDuckFadeSilenceDB+40 {
				sum += v
				n++
			}
		}
	}
	if n == 0 {
		return editorDuckDefaultDepthDB
	}
	return edClamp(10-sum/float64(n), 4, 16)
}

func buildDuckEnvelope(scene map[string]any, depthDb *float64) editorDuckEnvelope {
	spans := collectAnchorSpans(scene)
	depth := autoInitDuckDepth(scene)
	if depthDb != nil {
		depth = *depthDb
	}
	return editorDuckEnvelope{DepthDB: depth, Spans: spans, DuckFactor: dBToLinearCore(-depth)}
}

func resolveDuckGainAt(envelope *editorDuckEnvelope, sec float64) float64 {
	if envelope == nil {
		return 1
	}
	return envelope.factorAt(sec)
}

func isAudioCapable(el map[string]any) bool {
	if el == nil {
		return false
	}
	t := edStr(el["type"])
	return t == "audio" || t == "video"
}

func elementVolumeAt(el map[string]any, localSec float64) float64 {
	params := edMap(el["params"])
	animations := edMap(el["animations"])
	if edIsNum(params["volume"]) && edMap(animations["volume"]) == nil {
		return edNum(params["volume"])
	}
	keys := edSlice(edMap(animations["volume"])["keys"])
	base := float64(0)
	if edIsNum(params["volume"]) {
		base = edNum(params["volume"])
	}
	if len(keys) == 0 {
		return base
	}
	atTicks := math.Round(localSec * editorTicksPerSecond)
	value := base
	for _, kv := range keys {
		key := edMap(kv)
		if key != nil && edNum(key["time"]) <= atTicks {
			value = edNum(key["value"])
		}
	}
	return value
}

// ---- 小工具 -----------------------------------------------------------------
func localeString(locale Locale) string {
	if locale == "" {
		return string(DefaultLocale)
	}
	return string(locale)
}
