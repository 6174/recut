/*
 * [INPUT]: 依赖媒体 DTO（MediaModel/MediaParameter）与标准库
 * [OUTPUT]: per-model 输出参数的规范化与校验（应用默认值、类型/enum/范围检查、拒绝未知键），
 *          以及把用户面 Output 映射为 Provider 线上字段的 providerOutput（Name→ProviderKey）
 * [POS]: media 的参数契约层；让目录 schema 成为参数唯一真相，图片/视频 adapter 只被动转发
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package media

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
)

// reservedOutputKeys are accepted even when a model declares no matching
// parameter: speech routes carry voice/codec knobs through Output, and the
// platform injects a few internal keys. They pass through untouched.
var reservedOutputKeys = map[string]bool{
	"voiceId": true, "language": true, "codec": true, "sampleRate": true,
	"bitRate": true, "speed": true, "format": true, "emotion": true,
	"stability": true, "similarityBoost": true, "style": true,
	"volume": true, "pitch": true,
}

func modelParameter(model MediaModel, name string) (MediaParameter, bool) {
	for _, parameter := range model.Parameters {
		if parameter.Name == name {
			return parameter, true
		}
	}
	return MediaParameter{}, false
}

// normalizeModelOutput applies catalog defaults and validates every key against
// the model's parameter schema. A model without Parameters keeps the legacy
// pass-through contract (speech and pre-schema routes).
func normalizeModelOutput(model MediaModel, output map[string]any) (map[string]any, error) {
	normalized := make(map[string]any, len(output)+len(model.Parameters))
	// nil = 无 schema 的 legacy 模型（Output 透传）；非 nil 空切片 = 显式声明「无可调项」，
	// 必须拒绝任何参数。二者不能混为一谈。
	if model.Parameters == nil {
		for key, value := range output {
			normalized[key] = value
		}
		return normalized, nil
	}
	for key, value := range output {
		if _, ok := modelParameter(model, key); ok || reservedOutputKeys[key] {
			normalized[key] = value
			continue
		}
		return nil, fmt.Errorf("model %s does not accept parameter %q", model.ID, key)
	}
	for _, parameter := range model.Parameters {
		if _, present := normalized[parameter.Name]; present || parameter.Default == nil {
			continue
		}
		normalized[parameter.Name] = parameter.Default
	}
	for _, parameter := range model.Parameters {
		value, present := normalized[parameter.Name]
		if !present {
			continue
		}
		checked, err := validateParameterValue(parameter, value)
		if err != nil {
			return nil, fmt.Errorf("parameter %s: %w", parameter.Name, err)
		}
		normalized[parameter.Name] = checked
	}
	return normalized, nil
}

func validateParameterValue(parameter MediaParameter, value any) (any, error) {
	switch strings.ToLower(parameter.Type) {
	case "integer":
		number, ok := numericValue(value)
		if !ok || math.Trunc(number) != number {
			return nil, fmt.Errorf("must be an integer")
		}
		if err := checkRange(parameter, number); err != nil {
			return nil, err
		}
		if err := checkNumericEnum(parameter, number); err != nil {
			return nil, err
		}
		return value, nil
	case "number":
		number, ok := numericValue(value)
		if !ok {
			return nil, fmt.Errorf("must be a number")
		}
		if err := checkRange(parameter, number); err != nil {
			return nil, err
		}
		if err := checkNumericEnum(parameter, number); err != nil {
			return nil, err
		}
		return value, nil
	case "boolean":
		if _, ok := value.(bool); !ok {
			return nil, fmt.Errorf("must be a boolean")
		}
		return value, nil
	case "array":
		switch value.(type) {
		case []any, []string:
			return value, nil
		default:
			return nil, fmt.Errorf("must be an array")
		}
	default: // string
		text, ok := value.(string)
		if !ok {
			return nil, fmt.Errorf("must be a string")
		}
		if len(parameter.Enum) > 0 && !containsString(parameter.Enum, text) {
			return nil, fmt.Errorf("must be one of %s", strings.Join(parameter.Enum, ", "))
		}
		return value, nil
	}
}

// checkNumericEnum enforces integer/number enums. Some upstream schemas express
// numeric enums as strings (wan duration: ["5","10"]), so entries are compared
// by parsed value rather than raw string.
func checkNumericEnum(parameter MediaParameter, number float64) error {
	if len(parameter.Enum) == 0 {
		return nil
	}
	for _, option := range parameter.Enum {
		if parsed, err := strconv.ParseFloat(strings.TrimSpace(option), 64); err == nil && parsed == number {
			return nil
		}
	}
	return fmt.Errorf("must be one of %s", strings.Join(parameter.Enum, ", "))
}

func checkRange(parameter MediaParameter, number float64) error {
	if parameter.Minimum != nil && number < *parameter.Minimum {
		return fmt.Errorf("must be >= %v", *parameter.Minimum)
	}
	if parameter.Maximum != nil && number > *parameter.Maximum {
		return fmt.Errorf("must be <= %v", *parameter.Maximum)
	}
	return nil
}

func numericValue(value any) (float64, bool) {
	switch typed := value.(type) {
	case float64:
		return typed, true
	case float32:
		return float64(typed), true
	case int:
		return float64(typed), true
	case int64:
		return float64(typed), true
	case json.Number:
		number, err := typed.Float64()
		return number, err == nil
	default:
		return 0, false
	}
}

func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

// splitMetadataParams splits provider params by dotted providerKey: "metadata.x"
// sinks into the metadata sub-object, everything else stays top level. It lets
// catalog data (not adapter code) decide which provider fields nest.
func splitMetadataParams(params map[string]any) (top, metadata map[string]any) {
	top = map[string]any{}
	metadata = map[string]any{}
	for key, value := range params {
		if nested, ok := strings.CutPrefix(key, "metadata."); ok {
			metadata[nested] = value
			continue
		}
		top[key] = value
	}
	return top, metadata
}

// providerOutput maps validated user-facing Output keys onto the exact upstream
// wire fields. Reserved/internal keys pass through unchanged; a model without
// Parameters keeps Output as-is.
func providerOutput(model MediaModel, output map[string]any) map[string]any {
	params := make(map[string]any, len(output))
	if model.Parameters == nil {
		for key, value := range output {
			params[key] = value
		}
		return params
	}
	for key, value := range output {
		if parameter, ok := modelParameter(model, key); ok {
			params[parameter.providerKey()] = value
			continue
		}
		if reservedOutputKeys[key] {
			params[key] = value
		}
	}
	return params
}
