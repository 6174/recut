/*
 * [INPUT]: 依赖标准库 crypto/rand、sync 与 time
 * [OUTPUT]: 对外提供 worldLockManager：World Canvas 的 AI 会话 advisory lock（上锁/解锁/状态/续期），
 *           按 worldId 维度持有 owner/token/since/lastOpAt，空闲超时自动释放
 * [POS]: service 的 World Canvas AI 锁；挂在 Store 上跨 WorldStore 实例共享（HTTP 与 MCP 都经同一 Store），
 *        进程内非持久（daemon 重启即清空，与短命 MCP 会话一致），只作提示不替代服务端写校验
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"crypto/rand"
	"encoding/hex"
	"sync"
	"time"
)

// worldCanvasLockIdle 是 AI 画布锁的空闲上限：超过即视为会话结束，下次读取时释放。
const worldCanvasLockIdle = 5 * time.Minute

type worldCanvasLock struct {
	Owner    string
	Token    string
	Since    time.Time
	LastOpAt time.Time
}

type worldLockManager struct {
	mu    sync.Mutex
	locks map[string]*worldCanvasLock
}

func newWorldLockManager() *worldLockManager {
	return &worldLockManager{locks: map[string]*worldCanvasLock{}}
}

// lock 建立或刷新一个世界的 AI 锁。已持锁（未过期）时返回既有 token 且
// acquired=false，保证同一会话重复调用幂等。
func (m *worldLockManager) lock(worldID, owner string) (token string, acquired bool) {
	if m == nil {
		return "", false
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now().UTC()
	if existing, ok := m.locks[worldID]; ok && now.Sub(existing.LastOpAt) < worldCanvasLockIdle {
		existing.LastOpAt = now
		if owner != "" {
			existing.Owner = owner
		}
		return existing.Token, false
	}
	token = newLockToken()
	m.locks[worldID] = &worldCanvasLock{Owner: owner, Token: token, Since: now, LastOpAt: now}
	return token, true
}

// unlock 释放一个世界的 AI 锁；token 非空时必须匹配，避免误释放他人会话。
func (m *worldLockManager) unlock(worldID, token string) bool {
	if m == nil {
		return false
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	existing, ok := m.locks[worldID]
	if !ok {
		return false
	}
	if token != "" && existing.Token != token {
		return false
	}
	delete(m.locks, worldID)
	return true
}

// status 返回当前锁状态；过期的锁在读取时顺带清理。
func (m *worldLockManager) status(worldID string) (owner string, since time.Time, locked bool) {
	if m == nil {
		return "", time.Time{}, false
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	existing, ok := m.locks[worldID]
	if !ok {
		return "", time.Time{}, false
	}
	if time.Since(existing.LastOpAt) >= worldCanvasLockIdle {
		delete(m.locks, worldID)
		return "", time.Time{}, false
	}
	return existing.Owner, existing.Since, true
}

// touch 续期当前世界的锁（AI 每完成一次写操作时调用）。
func (m *worldLockManager) touch(worldID string) {
	if m == nil {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if existing, ok := m.locks[worldID]; ok {
		existing.LastOpAt = time.Now().UTC()
	}
}

func newLockToken() string {
	buf := make([]byte, 12)
	if _, err := rand.Read(buf); err != nil {
		return ""
	}
	return hex.EncodeToString(buf)
}

// ---- WorldStore 适配层 ----

func (w *WorldStore) canvasLock(worldID, owner string) (string, bool) {
	if w == nil || w.store == nil {
		return "", false
	}
	return w.store.worldLocks.lock(worldID, owner)
}

func (w *WorldStore) releaseCanvasLock(worldID, token string) bool {
	if w == nil || w.store == nil {
		return false
	}
	return w.store.worldLocks.unlock(worldID, token)
}

func (w *WorldStore) canvasLockStatus(worldID string) (owner string, since time.Time, locked bool) {
	if w == nil || w.store == nil {
		return "", time.Time{}, false
	}
	return w.store.worldLocks.status(worldID)
}

func (w *WorldStore) touchCanvasLock(worldID string) {
	if w == nil || w.store == nil {
		return
	}
	w.store.worldLocks.touch(worldID)
}
