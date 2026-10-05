/*
 * [INPUT]: 依赖 references.go 的 MediaReference 与标准库 regexp/strings
 * [OUTPUT]: 对外提供 ResolvePromptReferences（正文标签 → 模型侧别名，未绑定 id fail closed）、
 *   UnboundPromptReferenceIDs（未绑定 id 清单）与 ValidatePromptReferences（提案创建/更新期的早期门禁，
 *   以 ValidationError 报告全部未绑定 id）
 * [POS]: media 包的提交串边界；资产侧 metadata.prompt 保留作者原文（含标签，供编辑器渲染 chip），
 *   只有真正发给模型的 job prompt 经这里改写——模型只看到「编号 + role 短标签 + 名称」
 *   （如 参考图1（分镜）「G1 分镜表」），不看到裸 assetId；编号位次即 provider 数组下标
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

// referenceRoleLabels maps the controlled role token to the model-facing short label
// (mirrors web/lib/media/proposal.ts PROPOSAL_ROLES). The label is injected next to the
// numbered alias so the model can semantically bind each submitted media item to its role
// by position — the provider API only receives an ordered array with no per-item names.
var referenceRoleLabels = map[string]string{
	"pov":         "视角",
	"color-card":  "色卡",
	"environment": "环境",
	"character":   "角色",
	"prop":        "道具",
	"style-ref":   "风格",
	"motion-ref":  "运动",
	"voice":       "音色",
	"sfx":         "音效",
	"music":       "音乐",
}

// ResolvePromptReferences rewrites prompt reference tags into model-facing aliases so the
// submitted string never carries a bare assetId. Numbering follows the reference order per
// kind — exactly the order the provider receives the media in — so 「参考图1」 always points
// at the first attached image. A tag's controlled role is injected as a short label next to
// the number (「参考图1（分镜）」) so the model can bind each anonymously-submitted item to its
// semantic role by position. nameOf resolves a reference's display name lazily and may be
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
			failure = &ValidationError{
				Code:    "unbound_prompt_reference",
				Message: fmt.Sprintf("prompt reference %q is not bound to any reference asset", id),
				Data:    map[string]any{"unboundReferenceIds": []string{id}},
			}
			return tag
		}
		replacement := alias
		// The provider only receives an ordered array, so the alias number is the sole
		// positional anchor. Emitting the controlled role next to it lets the model map
		// each submitted media item to its semantic role (分镜/角色/环境/…) by position.
		if roleLabel := referenceRoleLabels[strings.TrimSpace(attrs["role"])]; roleLabel != "" {
			replacement += "（" + roleLabel + "）"
		}
		name := strings.TrimSpace(declared)
		if name == "" && nameOf != nil {
			name = strings.TrimSpace(nameOf(id))
		}
		if name != "" {
			replacement += "「" + name + "」"
		}
		return replacement
	})
	if failure != nil {
		return "", failure
	}
	return resolved, nil
}

// UnboundPromptReferenceIDs lists, in first-appearance order and deduplicated,
// every prompt tag whose id is not bound to any attached reference. The
// submit-time rewrite (ResolvePromptReferences) fails on the first one; this
// lets the propose/update path report them all at once so an agent can fix its
// prompt in a single pass.
func UnboundPromptReferenceIDs(prompt string, refs []MediaReference) []string {
	if !strings.Contains(prompt, "<reference") && !strings.Contains(prompt, "<media") {
		return nil
	}
	aliases := referenceAliases(refs)
	var unbound []string
	seen := map[string]struct{}{}
	for _, match := range referenceTagPattern.FindAllStringSubmatch(prompt, -1) {
		attrs := parseReferenceAttributes(match[2])
		id := attrs["id"]
		if match[1] == "media" {
			id = attrs["assetid"]
		}
		// A tag without an id carries nothing to bind.
		if id == "" {
			continue
		}
		if _, bound := aliases[id]; bound {
			continue
		}
		if _, dup := seen[id]; dup {
			continue
		}
		seen[id] = struct{}{}
		unbound = append(unbound, id)
	}
	return unbound
}

// ValidatePromptReferences fails closed when the authored prompt references an
// id that is not bound to any attached reference. The submit rewrite would leak
// a bare assetId to the model, so the proposal is rejected at creation/update
// time (with an actionable ValidationError) rather than at confirmation.
func ValidatePromptReferences(prompt string, refs []MediaReference) error {
	ids := UnboundPromptReferenceIDs(prompt, refs)
	if len(ids) == 0 {
		return nil
	}
	quoted := make([]string, 0, len(ids))
	for _, id := range ids {
		quoted = append(quoted, strconv.Quote(id))
	}
	noun, verb := "prompt reference", "is"
	if len(ids) > 1 {
		noun, verb = "prompt references", "are"
	}
	return &ValidationError{
		Code:    "unbound_prompt_reference",
		Message: fmt.Sprintf("%s %s %s not bound to any reference asset", noun, strings.Join(quoted, ", "), verb),
		Data:    map[string]any{"unboundReferenceIds": ids},
	}
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
