/*
 * [INPUT]: 依赖目录（providerByID）的 MaxConcurrent/MaxStartsPerMinute 与 sync 原语
 * [OUTPUT]: 按 provider ID 的提交门控：Acquire 同时校验并发槽（满则立即可重试）与每分钟
 *          启动速率（滚动窗口，超速则不占用），超上限的提交不消耗远端配额；Release 归还槽位
 * [POS]: media 的提交并发/速率控制边界；只约束“同时在建 / 每分钟新建”的 provider 调用，
 *        不串行化远端排队，上限由目录的 MediaProvider.MaxConcurrent/MaxStartsPerMinute 决定（0 = 不限）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package media

import (
	"sync"
	"time"
)

// providerGateRegistry hands out a bounded number of concurrent submission
// slots and a per-minute start budget per provider ID. A provider whose catalog
// limits are 0 is unlimited on that dimension (Acquire always succeeds). The
// gate bounds local submissions to match the provider's advertised per-account
// limits (e.g. WaveSpeed Bronze: 2 concurrent, 5 starts/min), so a burst of
// queued jobs backs off locally instead of tripping the upstream 429 — which
// would otherwise waste a paid submission attempt.
type providerGateRegistry struct {
	mu    sync.Mutex
	gates map[string]*providerGate
}

type providerGate struct {
	concurrency int
	perMinute   int
	slots       chan struct{}
	starts      []time.Time
}

// acquire reserves one submission slot for providerID, checking both the
// concurrent ceiling and the per-minute start budget. When either is exceeded
// it returns ok=false (with a nil release) so the caller defers the job to the
// next scheduler tick instead of blocking a durable task lease.
func (r *providerGateRegistry) acquire(providerID string, concurrency, perMinute int) (release func(), ok bool) {
	if concurrency <= 0 && perMinute <= 0 {
		return func() {}, true
	}
	gate := r.gateFor(providerID, concurrency, perMinute)
	if !gate.reserveStart(time.Now()) {
		return nil, false
	}
	if concurrency > 0 {
		select {
		case gate.slots <- struct{}{}:
		default:
			gate.refundStart()
			return nil, false
		}
	}
	return func() {
		if concurrency > 0 {
			<-gate.slots
		}
	}, true
}

// reserveStart records a start timestamp if the rolling one-minute window has
// room; refundStart rolls it back when the concurrent slot turns out to be
// unavailable.
func (g *providerGate) reserveStart(now time.Time) bool {
	if g.perMinute <= 0 {
		return true
	}
	cutoff := now.Add(-time.Minute)
	kept := g.starts[:0]
	for _, at := range g.starts {
		if at.After(cutoff) {
			kept = append(kept, at)
		}
	}
	g.starts = kept
	if len(g.starts) >= g.perMinute {
		return false
	}
	g.starts = append(g.starts, now)
	return true
}

func (g *providerGate) refundStart() {
	if g.perMinute > 0 && len(g.starts) > 0 {
		g.starts = g.starts[:len(g.starts)-1]
	}
}

// gateFor returns the gate for providerID, rebuilding it when either limit
// changes (e.g. the CDN catalog refreshed). Rebuilding only resets the channel
// and window; in-flight holders of the old gate release into the old channel
// and their slots simply retire with it.
func (r *providerGateRegistry) gateFor(providerID string, concurrency, perMinute int) *providerGate {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.gates == nil {
		r.gates = map[string]*providerGate{}
	}
	gate, ok := r.gates[providerID]
	if !ok || gate.concurrency != concurrency || gate.perMinute != perMinute {
		gate = &providerGate{concurrency: concurrency, perMinute: perMinute}
		if concurrency > 0 {
			gate.slots = make(chan struct{}, concurrency)
		}
		r.gates[providerID] = gate
	}
	return gate
}

// providerGateLimits returns the catalog-declared concurrency ceiling and
// per-minute start budget for a provider (0 = unlimited on that dimension).
func providerGateLimits(providerID string) (concurrency, perMinute int) {
	if provider, ok := providerByID(providerID); ok {
		return provider.MaxConcurrent, provider.MaxStartsPerMinute
	}
	return 0, 0
}
