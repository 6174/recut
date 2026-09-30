/*
 * [INPUT]: 依赖 references.go 的 MediaReference 与标准库 regexp/strings
 * [OUTPUT]: 对外提供 ResolvePromptReferences：把提示词正文里的 <reference id … /> 与 <media assetid … />
 *   改写成模型侧别名（参考图N / 参考视频N / 音频N，带文件名），未绑定的 id 一律 fail closed
 * [POS]: media 包的提交串边界；资产侧 metadata.prompt 保留作者原文（含标签，供编辑器渲染 chip），
 *   只有真正发给模型的 job prompt 经这里改写——模型只看到编号与名称，不看到裸 assetId
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package media

import (
	"fmt"
	"net/url"
	"path"
	"regexp"
	"strconv"
	"strings"
)

// referenceTagPattern matches the two inline reference tags the prompt protocol produces:
// `<reference id="…" … />` (agent-authored) and `<media assetid="…" … />` (@ panel-authored).
// The word boundary after the tag name keeps `<media_attr …>` and friends out of the match.
var referenceTagPattern = regexp.MustCompile(`<(reference|media)\b([^>]*?)/>`)

// referenceAttrPattern extracts one double-quoted attribute from a tag's attribute segment.
var referenceAttrPattern = regexp.MustCompile(`([A-Za-z_][\w-]*)\s*=\s*"([^"]*)"`)

// referenceAliasPrefix is the model-facing alias per reference kind. Kinds outside the
// generation set (validateReferences rejects them earlier) fall back to a neutral prefix.
var referenceAliasPrefix = map[string]string{"image": "参考图", "video": "参考视频", "audio": "音频"}

// ResolvePromptReferences rewrites prompt reference tags into model-facing aliases so the
// submitted string never carries a bare assetId. Numbering follows the reference order per
// kind — exactly the order the provider receives the media in — so 「参考图1」 always points
// at the first attached image. nameOf resolves a reference's display name lazily and may be
// nil. A tag whose id is not bound to any reference fails closed; a prompt with no reference
// tags (plain text, legacy `{{Mixed N}}`) passes through untouched.
func ResolvePromptReferences(prompt string, refs []MediaReference, nameOf func(value string) string) (string, error) {
	if !strings.Contains(prompt, "<reference") && !strings.Contains(prompt, "<media") {
		return prompt, nil
	}
	aliases := referenceAliases(refs)
	var failure error
	resolved := referenceTagPattern.ReplaceAllStringFunc(prompt, func(tag string) string {
		if failure != nil {
			return tag
		}
		match := referenceTagPattern.FindStringSubmatch(tag)
		attrs := parseReferenceAttributes(match[2])
		id, declared := attrs["id"], attrs["label"]
		if match[1] == "media" {
			id, declared = attrs["assetid"], attrs["name"]
		}
		// A tag without an id carries nothing to bind; leave it as the author wrote it.
		if id == "" {
			return tag
		}
		alias, bound := aliases[id]
		if !bound {
			failure = fmt.Errorf("prompt reference %q is not bound to any reference asset", id)
			return tag
		}
		name := strings.TrimSpace(declared)
		if name == "" && nameOf != nil {
			name = strings.TrimSpace(nameOf(id))
		}
		if name == "" {
			return alias
		}
		return alias + "「" + name + "」"
	})
	if failure != nil {
		return "", failure
	}
	return resolved, nil
}

// referenceAliases numbers the references per kind (image/video/audio) in attachment order.
// A value referenced more than once keeps its first number.
func referenceAliases(refs []MediaReference) map[string]string {
	aliases := make(map[string]string, len(refs))
	counts := map[string]int{}
	for _, ref := range refs {
		value := strings.TrimSpace(ref.Value)
		if value == "" {
			continue
		}
		if _, seen := aliases[value]; seen {
			continue
		}
		counts[ref.Kind]++
		prefix, ok := referenceAliasPrefix[ref.Kind]
		if !ok {
			prefix = "参考"
		}
		aliases[value] = prefix + strconv.Itoa(counts[ref.Kind])
	}
	return aliases
}

// parseReferenceAttributes reads the attribute segment of a reference tag; keys are lowercased.
func parseReferenceAttributes(source string) map[string]string {
	attrs := map[string]string{}
	for _, match := range referenceAttrPattern.FindAllStringSubmatch(source, -1) {
		attrs[strings.ToLower(match[1])] = match[2]
	}
	return attrs
}

// referenceName is the display name used when a tag declares none: the asset's library name,
// or the URL's basename for remote references. Missing lookups degrade to no name.
func (m *MediaService) referenceName(value string) string {
	if IsRemoteReference(value) {
		if parsed, err := url.Parse(value); err == nil {
			if base := path.Base(parsed.Path); base != "." && base != "/" && base != "" {
				return base
			}
		}
		return ""
	}
	asset, err := m.GetAsset(value)
	if err != nil {
		return ""
	}
	return asset.Name
}
