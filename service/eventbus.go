/*
 * [INPUT]: 依赖标准库同步原语与 gorilla/websocket 的客户端写通道
 * [OUTPUT]: 对外提供 EventBus：持有所有实时 WS 客户端，按 channel(+key) 订阅并把后台账本/写路径的增量扇出给匹配客户端
 * [POS]: service 的实时通道 hub；realtimeWS 与各 forwarder 共享，取代分散的每连接 SSE 轮询
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import "sync"

// wsClient is one live WebSocket connection. Its send channel is drained by
// the connection's single writer goroutine.
type wsClient struct {
	send chan []byte
	mu   sync.Mutex
	subs map[string]bool // "channel\x00key" for cleanup on disconnect
}

func newWSClient() *wsClient {
	return &wsClient{send: make(chan []byte, 64), subs: map[string]bool{}}
}

// EventBus fans out channel events to subscribed clients. A subscription key
// of "" means "all keys for this channel"; a publish key of "" means "any
// subscriber on this channel". Matching is channel equality plus
// (subKey=="" || pubKey=="" || subKey==pubKey).
type EventBus struct {
	mu      sync.RWMutex
	clients map[*wsClient]struct{}
	wild    map[string]map[*wsClient]struct{}      // channel -> clients subscribed with key ""
	keyed   map[string]map[*wsClient]struct{}      // "channel\x00key" -> clients
}

func newEventBus() *EventBus {
	return &EventBus{
		clients: map[*wsClient]struct{}{},
		wild:    map[string]map[*wsClient]struct{}{},
		keyed:   map[string]map[*wsClient]struct{}{},
	}
}

func subKey(channel, key string) string { return channel + "\x00" + key }

func (b *EventBus) Register(c *wsClient) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.clients[c] = struct{}{}
}

func (b *EventBus) Unregister(c *wsClient) {
	b.mu.Lock()
	defer b.mu.Unlock()
	delete(b.clients, c)
	c.mu.Lock()
	subs := c.subs
	c.subs = map[string]bool{}
	c.mu.Unlock()
	for key := range subs {
		channel, k, _ := stringsCutKey(key)
		if k == "" {
			if set := b.wild[channel]; set != nil {
				delete(set, c)
				if len(set) == 0 {
					delete(b.wild, channel)
				}
			}
		} else {
			if set := b.keyed[key]; set != nil {
				delete(set, c)
				if len(set) == 0 {
					delete(b.keyed, key)
				}
			}
		}
	}
}

func (b *EventBus) Subscribe(c *wsClient, channel, key string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	c.mu.Lock()
	if c.subs[subKey(channel, key)] {
		c.mu.Unlock()
		return
	}
	c.subs[subKey(channel, key)] = true
	c.mu.Unlock()
	if key == "" {
		if b.wild[channel] == nil {
			b.wild[channel] = map[*wsClient]struct{}{}
		}
		b.wild[channel][c] = struct{}{}
	} else {
		sk := subKey(channel, key)
		if b.keyed[sk] == nil {
			b.keyed[sk] = map[*wsClient]struct{}{}
		}
		b.keyed[sk][c] = struct{}{}
	}
}

func (b *EventBus) Unsubscribe(c *wsClient, channel, key string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	c.mu.Lock()
	delete(c.subs, subKey(channel, key))
	c.mu.Unlock()
	if key == "" {
		if set := b.wild[channel]; set != nil {
			delete(set, c)
			if len(set) == 0 {
				delete(b.wild, channel)
			}
		}
	} else {
		if set := b.keyed[subKey(channel, key)]; set != nil {
			delete(set, c)
			if len(set) == 0 {
				delete(b.keyed, subKey(channel, key))
			}
		}
	}
}

// Publish delivers a marshaled frame to every client subscribed to the channel
// with a matching key. The frame is dropped (non-blocking) if a client's send
// buffer is full so one slow consumer cannot stall the hub.
func (b *EventBus) Publish(channel, key string, frame []byte) {
	b.mu.RLock()
	recipients := make(map[*wsClient]struct{})
	for c := range b.wild[channel] {
		recipients[c] = struct{}{}
	}
	if key != "" {
		for c := range b.keyed[subKey(channel, key)] {
			recipients[c] = struct{}{}
		}
	}
	b.mu.RUnlock()
	for c := range recipients {
		select {
		case c.send <- frame:
		default:
		}
	}
}

func stringsCutKey(key string) (string, string, bool) {
	for i := 0; i < len(key); i++ {
		if key[i] == 0 {
			return key[:i], key[i+1:], true
		}
	}
	return key, "", false
}
