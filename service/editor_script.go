/*
 * [INPUT]: 依赖 editor_model 的时间单位、轨道与元素模型，以及 editorTranscriptLookup。
 * [OUTPUT]: 口播文稿读取/解析/版式/op 生成（script-model.js）与 SRT/ASS 解析/样式广播/导出（subtitles.js）的 Go 权威实现。
 * [POS]: service editor 域的字幕与 speech-track 领域模型；不直接注册 operation。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"math"
	"regexp"
	"strconv"
	"strings"
)

// editorTranscriptLookup 解析 platform 转写素材为 { language, segments: [{start,end,text}] }。
type editorTranscriptLookup func(assetID string) (map[string]any, bool)

// ============================================================================
// 字幕（caption track）—— subtitles.js 的 Go 权威实现
// ============================================================================
func broadcastSubtitleStyle(track map[string]any, targetEl map[string]any) {
	if track == nil || edStr(track["type"]) != "text" || track["captionStyle"] == nil || targetEl == nil {
		return
	}
	if edStr(targetEl["type"]) != "text" || targetEl["subtitle"] == nil {
		return
	}
	style := map[string]any{}
	for k, v := range edMap(targetEl["params"]) {
		if k != "content" {
			style[k] = v
		}
	}
	track["captionStyle"] = style
	for _, sibValue := range edSlice(track["elements"]) {
		sib := edMap(sibValue)
		if sib != nil && edStr(sib["type"]) == "text" && sib["subtitle"] != nil {
			merged := map[string]any{}
			for k, v := range style {
				merged[k] = v
			}
			content := any("")
			if sibParams := edMap(sib["params"]); sibParams["content"] != nil {
				content = sibParams["content"]
			}
			merged["content"] = content
			sib["params"] = merged
		}
	}
}

func pad2(n int) string {
	if n < 10 {
		return "0" + strconv.Itoa(n)
	}
	return strconv.Itoa(n)
}

func formatSrtTime(seconds float64) string {
	s := math.Max(0, seconds)
	h := int(math.Floor(s / 3600))
	m := int(math.Floor(math.Mod(s, 3600) / 60))
	sec := int(math.Floor(math.Mod(s, 60)))
	ms := int(math.Floor((s - math.Floor(s)) * 1000))
	msText := strconv.Itoa(ms)
	if ms < 100 {
		if ms < 10 {
			msText = "00" + msText
		} else {
			msText = "0" + msText
		}
	}
	return pad2(h) + ":" + pad2(m) + ":" + pad2(sec) + "," + msText
}

var editorSrtTimeRe = regexp.MustCompile(`^(\d{1,2}):(\d{2}):(\d{2})\.(\d{1,3})$`)

func parseSrtTime(text string) (float64, bool) {
	t := strings.ReplaceAll(strings.TrimSpace(text), ",", ".")
	m := editorSrtTimeRe.FindStringSubmatch(t)
	if m == nil {
		return 0, false
	}
	h, _ := strconv.Atoi(m[1])
	min, _ := strconv.Atoi(m[2])
	sec, _ := strconv.Atoi(m[3])
	fracText := m[4]
	for len(fracText) < 3 {
		fracText += "0"
	}
	frac, _ := strconv.Atoi(fracText)
	return float64(h*3600+min*60+sec) + float64(frac)/1000, true
}

func parseSrtText(input string) []any {
	normalized := strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(input, "\r\n", "\n"), "\r", "\n"))
	if normalized == "" {
		return []any{}
	}
	blocks := regexp.MustCompile(`\n{2,}`).Split(normalized, -1)
	cues := []any{}
	for _, block := range blocks {
		rawLines := strings.Split(block, "\n")
		lines := []string{}
		for _, l := range rawLines {
			if t := strings.TrimSpace(l); t != "" {
				lines = append(lines, t)
			}
		}
		if len(lines) < 2 {
			continue
		}
		tsIndex := 0
		if !strings.Contains(lines[0], "-->") {
			tsIndex = 1
		}
		if tsIndex >= len(lines) || !strings.Contains(lines[tsIndex], "-->") {
			continue
		}
		parts := regexp.MustCompile(`\s*-->\s*`).Split(lines[tsIndex], -1)
		if len(parts) < 2 {
			continue
		}
		start, sok := parseSrtTime(parts[0])
		end, eok := parseSrtTime(parts[1])
		if !sok || !eok || end <= start {
			continue
		}
		text := strings.TrimSpace(strings.Join(lines[tsIndex+1:], "\n"))
		if text == "" {
			continue
		}
		cues = append(cues, map[string]any{"text": text, "startSec": start, "durationSec": end - start})
	}
	return cues
}

var editorAssTimeRe = regexp.MustCompile(`^(\d+):(\d{2}):(\d{2})\.(\d{2})$`)

func parseAssTime(text string) (float64, bool) {
	m := editorAssTimeRe.FindStringSubmatch(strings.TrimSpace(text))
	if m == nil {
		return 0, false
	}
	h, _ := strconv.Atoi(m[1])
	min, _ := strconv.Atoi(m[2])
	sec, _ := strconv.Atoi(m[3])
	cs, _ := strconv.Atoi(m[4])
	return float64(h*3600+min*60+sec) + float64(cs)/100, true
}

var editorAssInlineTagRe = regexp.MustCompile(`\{[^}]*\}`)
var editorAssNewlineRe = regexp.MustCompile(`\\[NnH]`)

func stripAssInline(text string) string {
	out := editorAssInlineTagRe.ReplaceAllString(text, "")
	out = editorAssNewlineRe.ReplaceAllString(out, "\n")
	return strings.TrimSpace(out)
}

func parseAssText(input string) []any {
	lines := strings.Split(strings.ReplaceAll(strings.ReplaceAll(input, "\r\n", "\n"), "\r", "\n"), "\n")
	cues := []any{}
	for _, raw := range lines {
		line := strings.TrimSpace(raw)
		if !strings.HasPrefix(line, "Dialogue:") {
			continue
		}
		fields := strings.Split(strings.TrimPrefix(line, "Dialogue:"), ",")
		if len(fields) < 10 {
			continue
		}
		start, sok := parseAssTime(fields[1])
		end, eok := parseAssTime(fields[2])
		if !sok || !eok || end <= start {
			continue
		}
		text := stripAssInline(strings.Join(fields[9:], ","))
		if text == "" {
			continue
		}
		cues = append(cues, map[string]any{"text": text, "startSec": start, "durationSec": end - start})
	}
	return cues
}

func parseSubtitleContent(content, fileName string) []any {
	ext := ""
	if idx := strings.LastIndex(fileName, "."); idx >= 0 {
		ext = strings.ToLower(fileName[idx+1:])
	}
	if ext == "ass" || strings.HasPrefix(strings.TrimSpace(content), "Dialogue:") {
		return parseAssText(content)
	}
	return parseSrtText(content)
}

func renderSrtFromTrack(track map[string]any) string {
	cues := []map[string]any{}
	for _, ev := range edSlice(track["elements"]) {
		e := edMap(ev)
		if e != nil && edStr(e["type"]) == "text" && e["subtitle"] != nil {
			cues = append(cues, e)
		}
	}
	for i := 1; i < len(cues); i++ {
		for j := i; j > 0 && edNum(cues[j-1]["startTime"]) > edNum(cues[j]["startTime"]); j-- {
			cues[j-1], cues[j] = cues[j], cues[j-1]
		}
	}
	out := []string{}
	for i, c := range cues {
		content := ""
		if p := edMap(c["params"]); p["content"] != nil {
			content = edStr(p["content"])
		}
		out = append(out, strconv.Itoa(i+1))
		out = append(out, formatSrtTime(secOf(edNum(c["startTime"])))+" --> "+formatSrtTime(secOf(edNum(c["startTime"])+edNum(c["duration"]))))
		out = append(out, content)
		out = append(out, "")
	}
	return strings.TrimSpace(strings.Join(out, "\n")) + "\n"
}

// ============================================================================
// script 文稿面（speech-track）—— script-model.js 的 Go 权威实现
// ============================================================================
var editorScriptFillers = []string{"呃", "额", "um", "uh", "er", "ah"}

func hasTranscript(el map[string]any) bool {
	if el == nil {
		return false
	}
	t := edMap(el["transcript"])
	if t == nil {
		return false
	}
	return edStr(t["assetId"]) != "" || len(edSlice(t["segments"])) > 0
}

func speechTracks(scene map[string]any) []map[string]any {
	t := edSceneTracks(scene)
	out := []map[string]any{}
	if main := edMap(t["main"]); main != nil {
		out = append(out, main)
	}
	for _, av := range edSlice(t["audio"]) {
		if track := edMap(av); track != nil {
			out = append(out, track)
		}
	}
	return out
}

type editorScriptSourceSegment struct {
	Idx      int
	Text     string
	SrcStart float64
	SrcEnd   float64
}

func resolveTranscriptSegments(el map[string]any, lookup editorTranscriptLookup) ([]editorScriptSourceSegment, string) {
	out := []editorScriptSourceSegment{}
	if el == nil || el["transcript"] == nil {
		return out, ""
	}
	t := edMap(el["transcript"])
	raw := edSlice(t["segments"])
	language := edStr(t["language"])
	if raw == nil && edStr(t["assetId"]) != "" && lookup != nil {
		if resolved, ok := lookup(edStr(t["assetId"])); ok && resolved != nil {
			raw = edSlice(resolved["segments"])
			if language == "" {
				language = edStr(resolved["language"])
			}
		}
	}
	if len(raw) == 0 {
		return out, language
	}
	for i, sv := range raw {
		seg := edMap(sv)
		if seg == nil {
			continue
		}
		text := edStr(seg["text"])
		if overrides := edMap(t["overrides"]); overrides != nil {
			if override, ok := overrides[strconv.Itoa(i)]; ok && override != nil {
				text = edStr(override)
			}
		}
		srcStart := edNum(seg["start"])
		srcEnd := edNum(seg["end"])
		if seg["srcStart"] != nil {
			srcStart = edNum(seg["srcStart"])
		}
		if seg["srcEnd"] != nil {
			srcEnd = edNum(seg["srcEnd"])
		}
		if srcEnd <= srcStart {
			continue
		}
		out = append(out, editorScriptSourceSegment{Idx: i, Text: text, SrcStart: srcStart, SrcEnd: srcEnd})
	}
	return out, language
}

type editorScriptSegment struct {
	Idx      int
	Text     string
	SrcStart float64
	SrcEnd   float64
	TlStart  float64
	TlDur    float64
}

func scriptSegments(el map[string]any, lookup editorTranscriptLookup) ([]editorScriptSegment, string) {
	resolved, language := resolveTranscriptSegments(el, lookup)
	ts := secOf(edNum(el["trimStart"]))
	te := ts + secOf(edNum(el["duration"]))
	if el["trimEnd"] != nil {
		te = secOf(edNum(el["trimEnd"]))
	}
	span := te - ts
	out := []editorScriptSegment{}
	if span <= 0 {
		return out, language
	}
	for _, s := range resolved {
		if s.SrcEnd <= ts || s.SrcStart >= te {
			continue
		}
		cs := math.Max(s.SrcStart, ts)
		ce := math.Min(s.SrcEnd, te)
		if ce <= cs {
			continue
		}
		fs := (cs - ts) / span
		fe := (ce - ts) / span
		out = append(out, editorScriptSegment{
			Idx:      s.Idx,
			Text:     s.Text,
			SrcStart: cs,
			SrcEnd:   ce,
			TlStart:  secOf(edNum(el["startTime"])) + secOf(edNum(el["duration"]))*fs,
			TlDur:    secOf(edNum(el["duration"])) * (fe - fs),
		})
	}
	return out, language
}

func findSpeechRun(track map[string]any, startRef map[string]any) []map[string]any {
	els := []map[string]any{}
	for _, ev := range edSlice(track["elements"]) {
		if el := edMap(ev); el != nil {
			els = append(els, el)
		}
	}
	start := 0
	if startRef != nil && edStr(startRef["elementId"]) != "" {
		for i, el := range els {
			if edStr(el["id"]) == edStr(startRef["elementId"]) {
				start = i
				break
			}
		}
	}
	if start >= len(els) || !hasTranscript(els[start]) {
		return nil
	}
	run := []map[string]any{els[start]}
	lo, hi := start, start
	for hi+1 < len(els) && hasTranscript(els[hi+1]) && edNum(els[hi+1]["startTime"]) <= edNum(els[hi]["startTime"])+edNum(els[hi]["duration"])+1 {
		hi++
		run = append(run, els[hi])
	}
	for lo-1 >= 0 && hasTranscript(els[lo-1]) && edNum(els[lo]["startTime"]) <= edNum(els[lo-1]["startTime"])+edNum(els[lo-1]["duration"])+1 {
		lo--
		run = append([]map[string]any{els[lo]}, run...)
	}
	return run
}

type editorBaselineSegment struct {
	Addr      string
	TrackID   string
	ElementID string
	Idx       int
	Text      string
	SrcStart  float64
	SrcEnd    float64
	TlStart   float64
	TlDur     float64
	GapAfter  float64
}

func buildBaselineOrdered(track map[string]any, run []map[string]any, lookup editorTranscriptLookup) []editorBaselineSegment {
	out := []editorBaselineSegment{}
	prevEnd := math.NaN()
	for _, el := range run {
		segments, _ := scriptSegments(el, lookup)
		for _, seg := range segments {
			gap := float64(0)
			if !math.IsNaN(prevEnd) {
				gap = math.Max(0, seg.TlStart-prevEnd)
			}
			out = append(out, editorBaselineSegment{
				Addr:      edStr(track["id"]) + ":" + edStr(el["id"]) + ":" + strconv.Itoa(seg.Idx),
				TrackID:   edStr(track["id"]),
				ElementID: edStr(el["id"]),
				Idx:       seg.Idx,
				Text:      seg.Text,
				SrcStart:  seg.SrcStart,
				SrcEnd:    seg.SrcEnd,
				TlStart:   seg.TlStart,
				TlDur:     seg.TlDur,
				GapAfter:  gap,
			})
			prevEnd = seg.TlStart + seg.TlDur
		}
	}
	return out
}

type editorRenderedScript struct {
	Markdown string
	Count    int
	Language string
}

func renderRunMarkdown(locale Locale, track map[string]any, run []map[string]any, lookup editorTranscriptLookup, showSilence bool) editorRenderedScript {
	header := loc(locale, "# 文稿 · recut.editor script surface", "# Script · recut.editor script surface")
	body := []string{}
	n := 0
	language := ""
	prevEnd := math.NaN()
	for _, el := range run {
		segments, segLanguage := scriptSegments(el, lookup)
		if language == "" && segLanguage != "" {
			language = segLanguage
		}
		for _, seg := range segments {
			if !math.IsNaN(prevEnd) && showSilence {
				gap := seg.TlStart - prevEnd
				if gap > 0.05 {
					body = append(body, "[gap="+formatFixed(gap, 2)+"s]")
				}
			}
			body = append(body, "[seg-"+edStr(track["id"])+":"+edStr(el["id"])+":"+strconv.Itoa(seg.Idx)+"] "+seg.Text)
			prevEnd = seg.TlStart + seg.TlDur
			n++
		}
	}
	meta1 := loc(locale, "> 轨道 "+edStr(track["id"])+" · "+strconv.Itoa(n)+" 段", "> Track "+edStr(track["id"])+" · "+strconv.Itoa(n)+" segment(s)")
	if language != "" {
		meta1 += loc(locale, " · 语言 "+language, " · language "+language)
	}
	meta2 := loc(locale, "> 一行=一段；行内 ~~x~~=只删 x 的音频；整行删除=删整段；行移动=改顺序", "> One line = one segment; inline ~~x~~ = delete only x's audio; delete a whole line = delete that segment; move a line = reorder")
	if showSilence {
		meta2 += loc(locale, "；[gap=Xs→Ys]=压缩停顿", "; [gap=Xs→Ys] = compress pause")
	}
	md := header + "\n" + meta1 + "\n" + meta2 + "\n" + strings.Join(body, "\n") + "\n"
	return editorRenderedScript{Markdown: md, Count: n, Language: language}
}

var editorScriptSegRe = regexp.MustCompile(`^\[seg-([^:\]]+):([^:\]]+):(\d+)\]\s*(.*)$`)
var editorScriptGapRe = regexp.MustCompile(`^\[gap=([\d.]+)s(?:\s*(?:→|->)\s*([\d.]+)s)?\]$`)

type editorStrike struct {
	Start int
	End   int
	Text  string
}

type editorScriptUnit struct {
	Kind      string
	From      float64
	To        float64
	TrackID   string
	ElementID string
	Idx       int
	Text      string
	Strikes   []editorStrike
}

func parseStrikes(raw string) (string, []editorStrike) {
	chars := []rune(raw)
	clean := []rune{}
	strikes := []editorStrike{}
	i := 0
	for i < len(chars) {
		if chars[i] == '~' && i+1 < len(chars) && chars[i+1] == '~' {
			j := indexRunes(chars, i+2, "~~")
			if j < 0 {
				clean = append(clean, chars[i])
				i++
				continue
			}
			inner := string(chars[i+2 : j])
			if !strings.Contains(inner, "~~") {
				strikes = append(strikes, editorStrike{Start: len(clean), End: len(clean) + len([]rune(inner)), Text: inner})
				clean = append(clean, []rune(inner)...)
				i = j + 2
				continue
			}
			clean = append(clean, chars[i])
			i++
		} else {
			clean = append(clean, chars[i])
			i++
		}
	}
	return string(clean), strikes
}

func indexRunes(chars []rune, from int, needle string) int {
	n := []rune(needle)
	for i := from; i+len(n) <= len(chars); i++ {
		match := true
		for k := range n {
			if chars[i+k] != n[k] {
				match = false
				break
			}
		}
		if match {
			return i
		}
	}
	return -1
}

func parseScriptMarkdown(text string) []editorScriptUnit {
	units := []editorScriptUnit{}
	for _, rawLine := range strings.Split(text, "\n") {
		line := strings.TrimSpace(rawLine)
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, ">") {
			continue
		}
		if gm := editorScriptGapRe.FindStringSubmatch(line); gm != nil {
			from, _ := strconv.ParseFloat(gm[1], 64)
			to := from
			if gm[2] != "" {
				to, _ = strconv.ParseFloat(gm[2], 64)
			}
			units = append(units, editorScriptUnit{Kind: "gap", From: from, To: to})
			continue
		}
		if sm := editorScriptSegRe.FindStringSubmatch(line); sm != nil {
			clean, strikes := parseStrikes(sm[4])
			idx, _ := strconv.Atoi(sm[3])
			units = append(units, editorScriptUnit{Kind: "seg", TrackID: sm[1], ElementID: sm[2], Idx: idx, Text: clean, Strikes: strikes})
			continue
		}
	}
	return units
}

type editorScriptPiece struct {
	SrcStart float64
	SrcEnd   float64
	Text     string
	GapAfter float64
}

func applyStrikes(base editorBaselineSegment, strikes []editorStrike) []editorScriptPiece {
	chars := []rune(base.Text)
	if len(strikes) == 0 {
		return []editorScriptPiece{{SrcStart: base.SrcStart, SrcEnd: base.SrcEnd, Text: base.Text}}
	}
	span := base.SrcEnd - base.SrcStart
	length := len(chars)
	if length == 0 {
		length = 1
	}
	cuts := append([]editorStrike{}, strikes...)
	for i := 1; i < len(cuts); i++ {
		for j := i; j > 0 && cuts[j-1].Start > cuts[j].Start; j-- {
			cuts[j-1], cuts[j] = cuts[j], cuts[j-1]
		}
	}
	out := []editorScriptPiece{}
	curTextStart := 0
	for _, c := range cuts {
		if c.End <= c.Start || c.Start > len(chars) {
			continue
		}
		ce := c.End
		if ce > len(chars) {
			ce = len(chars)
		}
		if c.Start > curTextStart {
			out = append(out, editorScriptPiece{
				SrcStart: base.SrcStart + span*(float64(curTextStart)/float64(length)),
				SrcEnd:   base.SrcStart + span*(float64(c.Start)/float64(length)),
				Text:     string(chars[curTextStart:c.Start]),
			})
		}
		curTextStart = ce
	}
	if curTextStart < len(chars) {
		out = append(out, editorScriptPiece{
			SrcStart: base.SrcStart + span*(float64(curTextStart)/float64(length)),
			SrcEnd:   base.SrcEnd,
			Text:     string(chars[curTextStart:]),
		})
	}
	if len(out) == 0 {
		return []editorScriptPiece{{SrcStart: base.SrcStart, SrcEnd: base.SrcEnd, Text: base.Text}}
	}
	return out
}

type editorScriptLayout struct {
	OK      bool
	Error   string
	Pieces  []editorScriptPiece
	Deleted []string
}

func computeScriptLayout(baseline []editorBaselineSegment, units []editorScriptUnit, locale Locale) editorScriptLayout {
	pieces := []editorScriptPiece{}
	seen := map[string]bool{}
	baseByAddr := map[string]editorBaselineSegment{}
	for _, b := range baseline {
		baseByAddr[b.Addr] = b
	}
	for _, unit := range units {
		if unit.Kind == "gap" {
			if len(pieces) > 0 {
				pieces[len(pieces)-1].GapAfter = unit.To
			}
			continue
		}
		key := unit.TrackID + ":" + unit.ElementID + ":" + strconv.Itoa(unit.Idx)
		base, ok := baseByAddr[key]
		if !ok {
			return editorScriptLayout{OK: false, Error: loc(locale, "address not found in project: "+key+"（项目在 script.read 后已变更？请重新 script.read）", "address not found in project: "+key+" (project changed since script.read? Please run script.read again)")}
		}
		if seen[key] {
			return editorScriptLayout{OK: false, Error: "duplicate segment in script: " + key}
		}
		seen[key] = true
		sub := applyStrikes(base, unit.Strikes)
		for _, piece := range sub {
			pieces = append(pieces, piece)
		}
		pieces[len(pieces)-1].GapAfter = base.GapAfter
	}
	deleted := []string{}
	for key := range baseByAddr {
		if !seen[key] {
			deleted = append(deleted, key)
		}
	}
	sortStrings(deleted)
	return editorScriptLayout{OK: true, Pieces: pieces, Deleted: deleted}
}

func applySilenceRule(pieces []editorScriptPiece, rule string) {
	if rule == "" {
		return
	}
	reCompress := regexp.MustCompile(`^compress:(\d+)$`)
	reNormalize := regexp.MustCompile(`^normalize:(\d+)$`)
	reRestore := regexp.MustCompile(`^restore:(\d+)$`)
	reRange := regexp.MustCompile(`^range:(\d+)-(\d+)$`)
	for i := 0; i+1 < len(pieces); i++ {
		gap := pieces[i].GapAfter
		if gap <= 0 {
			continue
		}
		target := gap
		if m := reCompress.FindStringSubmatch(rule); m != nil {
			target = math.Min(gap, parseMs(m[1]))
		} else if m := reNormalize.FindStringSubmatch(rule); m != nil {
			target = math.Min(gap, parseMs(m[1]))
		} else if m := reRestore.FindStringSubmatch(rule); m != nil {
			target = math.Min(gap, parseMs(m[1]))
		} else if m := reRange.FindStringSubmatch(rule); m != nil {
			lo := parseMs(m[1])
			hi := parseMs(m[2])
			target = math.Max(math.Min(gap, hi), math.Min(gap, lo))
		}
		pieces[i].GapAfter = target
	}
}

func strikeFillers(text string) (string, []editorStrike) {
	chars := []rune(text)
	lower := []rune(strings.ToLower(text))
	clean := []rune{}
	strikes := []editorStrike{}
	i := 0
	for i < len(chars) {
		matched := false
		for _, filler := range editorScriptFillers {
			fr := []rune(strings.ToLower(filler))
			if i+len(fr) <= len(lower) && string(lower[i:i+len(fr)]) == string(fr) {
				original := string(chars[i : i+len(fr)])
				strikes = append(strikes, editorStrike{Start: len(clean), End: len(clean) + len(fr), Text: original})
				clean = append(clean, []rune(original)...)
				i += len(fr)
				matched = true
				break
			}
		}
		if !matched {
			clean = append(clean, chars[i])
			i++
		}
	}
	return string(clean), strikes
}

func transcriptSnapshot(template map[string]any, piece editorScriptPiece) map[string]any {
	t := edMap(template["transcript"])
	if t == nil {
		t = map[string]any{}
	}
	var assetID any
	if t["assetId"] != nil {
		assetID = t["assetId"]
	}
	var language any
	if t["language"] != nil {
		language = t["language"]
	}
	source := nonEmpty(edStr(t["source"]), "transcript")
	return map[string]any{
		"assetId":  assetID,
		"source":   source,
		"language": language,
		"segments": []any{map[string]any{"srcStart": piece.SrcStart, "srcEnd": piece.SrcEnd, "text": piece.Text}},
	}
}

type editorScriptOps struct {
	Ops           []map[string]any
	NewTotalTicks float64
	OldTotalTicks float64
}

func buildScriptOps(track map[string]any, run []map[string]any, pieces []editorScriptPiece) editorScriptOps {
	ops := []map[string]any{}
	template := run[0]
	runStart := edNum(template["startTime"])
	oldEnd := float64(0)
	for _, el := range run {
		end := edNum(el["startTime"]) + edNum(el["duration"])
		if end > oldEnd {
			oldEnd = end
		}
	}
	cursor := runStart
	paramsCopy := edCloneMap(template["params"])
	for p, piece := range pieces {
		durTicks := math.Max(tickOf(piece.SrcEnd)-tickOf(piece.SrcStart), 1)
		gapTicks := float64(0)
		if p < len(pieces)-1 {
			gapTicks = tickOf(piece.GapAfter)
		}
		element := map[string]any{
			"type":         template["type"],
			"name":         "Speech " + strconv.Itoa(p+1),
			"mediaId":      template["mediaId"],
			"sourceType":   template["sourceType"],
			"sourceUrl":    template["sourceUrl"],
			"startSec":     secOf(cursor),
			"durationSec":  secOf(durTicks),
			"trimStartSec": secOf(tickOf(piece.SrcStart)),
			"trimEndSec":   secOf(tickOf(piece.SrcEnd)),
			"params":       paramsCopy,
			"transcript":   transcriptSnapshot(template, piece),
		}
		ops = append(ops, map[string]any{"type": "insert", "payload": map[string]any{"trackId": track["id"], "element": element}})
		cursor = cursor + durTicks + gapTicks
	}
	delRefs := []any{}
	for _, el := range run {
		delRefs = append(delRefs, map[string]any{"trackId": track["id"], "elementId": el["id"]})
	}
	ops = append([]map[string]any{{"type": "delete", "payload": map[string]any{"refs": delRefs}}}, ops...)
	newEnd := cursor
	delta := newEnd - oldEnd
	runIDs := map[string]bool{}
	for _, el := range run {
		runIDs[edStr(el["id"])] = true
	}
	for _, laterValue := range edSlice(track["elements"]) {
		later := edMap(laterValue)
		if later == nil || runIDs[edStr(later["id"])] {
			continue
		}
		if edNum(later["startTime"]) >= oldEnd {
			ops = append(ops, map[string]any{"type": "trim", "payload": map[string]any{"ref": map[string]any{"trackId": track["id"], "elementId": later["id"]}, "startSec": secOf(edNum(later["startTime"]) + delta)}})
		}
	}
	return editorScriptOps{Ops: ops, NewTotalTicks: newEnd, OldTotalTicks: oldEnd}
}

func resolveSpeechTrackScene(project map[string]any, units []editorScriptUnit) (map[string]any, map[string]any, string) {
	for _, unit := range units {
		if unit.Kind != "seg" {
			continue
		}
		scene := findScene(project, project["currentSceneId"])
		var track map[string]any
		if scene != nil {
			track = findTrack(scene, unit.TrackID)
		}
		return scene, track, unit.ElementID
	}
	return nil, nil, ""
}

// ---- 小工具 -----------------------------------------------------------------
func formatFixed(v float64, digits int) string {
	return strconv.FormatFloat(v, 'f', digits, 64)
}

func parseMs(text string) float64 {
	v, _ := strconv.ParseFloat(text, 64)
	return v / 1000
}

func sortStrings(items []string) {
	for i := 1; i < len(items); i++ {
		for j := i; j > 0 && items[j-1] > items[j]; j-- {
			items[j-1], items[j] = items[j], items[j-1]
		}
	}
}
