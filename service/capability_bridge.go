/*
 * [INPUT]: 依赖 AppHost.catalog（能力发现）、AppHost.invoke/InvokeMCP（既有通用执行原语）、
 *          Store.AppendEvent（审计账本）与 mcpError 业务错误信封。
 * [OUTPUT]: 对外提供 ctx.capabilities.invoke / inspect 的通用跨 App 能力桥：invoke 复用既有
 *          AppHost.invoke 执行目标 App 的 capability op（在其自己的 appstate 命名空间运行），
 *          带同步超时与统一错误信封；inspect 返回能力清单、就绪态与未安装时的安装引导信息。
 * [POS]: service 的平台通用桥接层；不含任何具体业务（转写/TTS/字幕）知识，只做发现/执行/容错/审计。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

// capabilityInvokeTimeout 是跨 App 能力调用的同步段超时：覆盖目标 App 的 goja 加载与 handler 执行。
// 目标 App 返回 shell/media job（异步）不受此窗口限制——job 生命周期由统一观察层继续跟踪。
// 声明为 var 以便测试降窗速测超时路径。
var capabilityInvokeTimeout = 30 * time.Second

// operationIsCapability 判断某 operation 是否可作为跨 App 能力被 invoke：
// manifest 显式声明 capability:true，或兼容地暴露 mcp surface（recutIntegrationContext 亦以 mcp 作就绪代理）。
func operationIsCapability(manifest Manifest, name string) bool {
	for _, op := range manifest.Operations {
		if op.Name != name {
			continue
		}
		if op.Capability {
			return true
		}
		for _, surface := range op.Surfaces {
			if surface == "mcp" {
				return true
			}
		}
	}
	return false
}

// capabilityOperations 返回某 App 的 capability 清单（仅显式 capability:true 的 op）。
func capabilityOperations(manifest Manifest) []map[string]any {
	ops := []map[string]any{}
	for _, op := range manifest.Operations {
		if !op.Capability {
			continue
		}
		ops = append(ops, map[string]any{
			"name":        op.Name,
			"description": op.Description,
			"surface":     op.Surfaces,
			"inputSchema": op.InputSchema,
		})
	}
	return ops
}

// capabilityEnvelope 把 invoke 错误翻译成统一错误信封。业务/校验错误（mcpError）原样透传，
// 其余归类为 transport，并都标记调用阶段 phase="sync"（异步段终止由调用方按 job 观察）。
func capabilityEnvelope(err error) map[string]any {
	envelope := map[string]any{
		"kind":      "transport",
		"code":      "provider.error",
		"message":   toString(err),
		"retryable": true,
		"phase":     "sync",
	}
	var biz *mcpError
	if errors.As(err, &biz) {
		envelope["kind"] = biz.Kind
		envelope["code"] = biz.Code
		envelope["message"] = biz.Message
		envelope["hint"] = biz.Hint
		envelope["retryable"] = biz.Retryable
		if biz.Data != nil {
			envelope["data"] = biz.Data
		}
	}
	return envelope
}

// capabilityInspect 返回一个 App 的能力面：是否安装、是否就绪、capability 清单，
// 以及未安装时可直接用于安装引导的 repository/action 提示。
func (h *AppHost) capabilityInspect(appID string, locale Locale) map[string]any {
	if appID == "" {
		return map[string]any{"ready": false, "code": "capability.input", "message": "capabilities.inspect: appId required"}
	}
	app, ok := h.catalog.Get(appID)
	if !ok {
		result := map[string]any{
			"ready":  false,
			"status": "not-installed",
			"code":   "app.not-installed",
			"action": "Use the Install button to install this App, then reopen it.",
		}
		if h.store != nil {
			if storeApps, err := h.store.AppStoreFor(locale); err == nil {
				for _, item := range storeApps {
					if item.AppID != appID {
						continue
					}
					result["install"] = map[string]any{"appId": item.AppID, "name": item.Name, "repository": item.Repository}
					result["action"] = "Install the App, then try again."
					break
				}
			}
		}
		return result
	}
	ops := capabilityOperations(app.Manifest)
	// 就绪 = 已安装且暴露至少一个 capability（或 mcp 面）——recutIntegrationContext 语义一致。
	ready := len(ops) > 0 || exposesMCPSurface(app.Manifest)
	status := "ready"
	if !ready {
		status = "installed-no-capability"
	}
	return map[string]any{
		"appId":      app.Manifest.ID,
		"ready":      ready,
		"status":     status,
		"appName":    localizedManifestName(app.Manifest, locale),
		"operations": ops,
	}
}

// capabilityInvoke 执行一次跨 App 能力调用：目标 App 的 op 在其自身 appstate 命名空间运行
// （Target.AppID=目标、ProjectID 为空），调用方项目只用于审计归属。结果或统一错误信封成对返回。
// authorization 非空时（如用户点「生成字幕」= 许可入库），平台用持久化密钥为其签名并注入
// input._authorization（HMAC），提供方可经 ctx.platform.verifyCapabilityGrant 校验；授权声明
// 同时进审计账本，消费方不能自封任意授权。
func (h *AppHost) capabilityInvoke(callerTarget Target, appID, name string, input map[string]any, authorization string, locale Locale) (map[string]any, error) {
	if appID == "" || name == "" {
		return nil, fmt.Errorf("capabilities.invoke: appId and name required")
	}
	targetApp, ok := h.catalog.Get(appID)
	if !ok {
		return map[string]any{
			"ok":    false,
			"error": map[string]any{"kind": "provider", "code": "app.not-installed", "message": fmt.Sprintf("App %q is not installed", appID), "retryable": false, "phase": "sync"},
		}, nil
	}
	if !operationIsCapability(targetApp.Manifest, name) {
		return map[string]any{
			"ok":    false,
			"error": map[string]any{"kind": "provider", "code": "op.not-exposed", "message": fmt.Sprintf("App %q does not expose capability %q", appID, name), "retryable": false, "phase": "sync"},
		}, nil
	}

	// 授权声明签名注入（防自封）：消费方断言授权来源，平台签名后放入目标 op 输入。
	var signedGrant map[string]any
	if authorization != "" {
		if input == nil {
			input = map[string]any{}
		}
		grant := map[string]any{
			"v":         1,
			"appId":     appID,
			"op":        name,
			"grant":     authorization,
			"projectId": callerTarget.ProjectID,
			"ts":        time.Now().UTC().Format(time.RFC3339Nano),
		}
		payload, err := json.Marshal(grant)
		if err != nil {
			return nil, err
		}
		sig := signCapabilityPayload(payload, h.capabilityKey())
		token := map[string]any{"grant": grant, "sig": hex.EncodeToString(sig)}
		input["_authorization"] = token
		signedGrant = grant
	}

	// 目标 op 在目标 App 自己的 appstate 命名空间运行；调用方 target 只决定审计归属。
	target := Target{AppID: appID}

	type outcome struct {
		value any
		err   error
	}
	ch := make(chan outcome, 1)
	go func() {
		defer func() {
			if recovered := recover(); recovered != nil {
				ch <- outcome{err: fmt.Errorf("capability %s.%s panicked inside the provider runtime: %v", appID, name, recovered)}
			}
		}()
		value, err := h.invoke(target, targetApp, "operation", name, input, locale)
		ch <- outcome{value: value, err: err}
	}()
	select {
	case o := <-ch:
		if o.err != nil {
			envelope := capabilityEnvelope(o.err)
			h.recordCapabilityEvent(callerTarget, targetApp.Manifest.ID, name, "failed", envelope, signedGrant)
			return map[string]any{"ok": false, "error": envelope}, nil
		}
		h.recordCapabilityEvent(callerTarget, targetApp.Manifest.ID, name, "completed", nil, signedGrant)
		return map[string]any{"ok": true, "result": o.value}, nil
	case <-time.After(capabilityInvokeTimeout):
		envelope := map[string]any{"kind": "transport", "code": "invoke.timeout", "message": fmt.Sprintf("capability %s.%s exceeded the %s sync window", appID, name, capabilityInvokeTimeout), "retryable": true, "phase": "sync"}
		h.recordCapabilityEvent(callerTarget, targetApp.Manifest.ID, name, "failed", envelope, signedGrant)
		return map[string]any{"ok": false, "error": envelope}, nil
	}
}

// capabilityKey 返回能力授权签名密钥：有媒体服务时用持久化 media.key（跨进程稳定），否则用主机级随机密钥。
func (h *AppHost) capabilityKey() []byte {
	h.capMu.Lock()
	defer h.capMu.Unlock()
	if h.capKey == nil {
		if h.media != nil {
			if key, err := h.media.SigningKey(); err == nil && len(key) == 32 {
				h.capKey = key
			}
		}
		if h.capKey == nil {
			h.capKey = make([]byte, 32)
			if _, err := rand.Read(h.capKey); err != nil {
				// 极推进退：不可随机时退回固定派生，仅影响签名强度不影响功能。
				copy(h.capKey, []byte("recut-capability-grant-fallback-key"))
			}
		}
	}
	return h.capKey
}

func signCapabilityPayload(payload []byte, key []byte) []byte {
	mac := hmac.New(sha256.New, key)
	mac.Write(payload)
	return mac.Sum(nil)
}

// verifyCapabilityToken 供能力提供方校验平台注入的授权签名（ctx.platform.verifyCapabilityGrant）。
// token 为 invoke 注入 input._authorization 的对象；appID/op 提供方声明自己的身份/操作约束。
func (h *AppHost) verifyCapabilityToken(token map[string]any, appID, op string) (map[string]any, bool) {
	grantRaw, _ := token["grant"].(map[string]any)
	sig, _ := token["sig"].(string)
	if grantRaw == nil || sig == "" {
		return nil, false
	}
	payload, err := json.Marshal(grantRaw)
	if err != nil {
		return nil, false
	}
	if hex.EncodeToString(signCapabilityPayload(payload, h.capabilityKey())) != sig {
		return nil, false
	}
	if gApp, _ := grantRaw["appId"].(string); gApp != appID {
		return nil, false
	}
	if op != "" {
		if gOp, _ := grantRaw["op"].(string); gOp != op {
			return nil, false
		}
	}
	return grantRaw, true
}

// recordCapabilityEvent 记录一次能力调用的审计事件到调用方项目账本（调用方非项目命名空间时跳过）。
func (h *AppHost) recordCapabilityEvent(callerTarget Target, appID, name, outcome string, envelope map[string]any, grant map[string]any) {
	if !callerTarget.IsProject() || h.store == nil {
		return
	}
	eventType := "app.capability." + outcome
	event := map[string]any{"type": eventType, "appId": appID, "name": name, "at": time.Now().UTC()}
	if envelope != nil {
		event["error"] = envelope
	}
	if grant != nil {
		event["authorization"] = grant
	}
	h.store.AppendEvent(callerTarget.ProjectID, event)
}

// exposesMCPSurface 判断 App 是否暴露任一 mcp surface（用于 inspect 兼容就绪判定）。
func exposesMCPSurface(manifest Manifest) bool {
	for _, op := range manifest.Operations {
		for _, surface := range op.Surfaces {
			if surface == "mcp" {
				return true
			}
		}
	}
	return false
}

// localizedManifestName 返回按 locale 本地化的 App 名称，缺失时回退顶层名称。
func localizedManifestName(manifest Manifest, locale Locale) string {
	if localized, ok := manifest.Localized[string(locale)]; ok && localized.Name != "" {
		return localized.Name
	}
	return manifest.Name
}