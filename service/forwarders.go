/*
 * [INPUT]: 依赖 EventBus、Store 的 mediaEvents/apps 安装变化信号、MediaService 的 durable 事件账本
 * [OUTPUT]: 对外提供 media/app 两个后台 forwarder：把 Asset 更新或删除及安装增量经 EventBus 扇出到实时 WS，进程内即时、跨进程 1s ticker 兜底
 * [POS]: service 的实时通道后台转发层；让 DB 轮询与客户端数量解耦（每账本一条转发器，而非每连接每秒查库）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"context"
	"encoding/json"
	"time"
)

// StartRealtimeForwarders starts the background ledger forwarders that feed the
// realtime EventBus. Each forwarder polls one durable ledger at most once per
// second regardless of how many clients are connected.
func (s *Server) StartRealtimeForwarders(ctx context.Context) {
	go s.runMediaForwarder(ctx)
	go s.runAppInstallationForwarder(ctx)
}

// runMediaForwarder broadcasts media_asset_events deltas on the "media"
// channel. New subscribers fetch their snapshot over REST, so the forwarder
// starts from the current latest id and never replays history.
func (s *Server) runMediaForwarder(ctx context.Context) {
	if s.media == nil {
		return
	}
	last, err := s.media.LatestAssetEventID()
	if err != nil {
		last = 0
	}
	ticker := time.NewTicker(changeHubPollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-s.store.mediaEvents.wait():
		case <-ticker.C:
		}
		events, err := s.media.AssetEvents(last)
		if err != nil {
			continue
		}
		for _, event := range events {
			last = event.ID
			asset, err := s.media.GetAsset(event.AssetID)
			data := map[string]any{"id": event.ID}
			if err != nil || asset.Status == "deleted" {
				// 真删除（行丢失）或墓碑删除都广播 asset.deleted：客户端应移除该素材，
				// 而不是把状态为 deleted 的墓碑继续 upsert 回列表。
				data["event"] = "asset.deleted"
				data["assetId"] = event.AssetID
			} else {
				data["event"] = "asset.updated"
				data["asset"] = asset
			}
			frame, err := json.Marshal(map[string]any{
				"type":    "event",
				"channel": "media",
				"data":    data,
			})
			if err != nil {
				continue
			}
			s.bus.Publish("media", "", frame)
		}
	}
}

// runAppInstallationForwarder broadcasts catalog installation changes on the
// "app" channel. Clients treat the frame as a hint to re-read the workspace
// snapshot over REST (the channel carries no duplicated state).
func (s *Server) runAppInstallationForwarder(ctx context.Context) {
	if s.apps == nil {
		return
	}
	version, changes := s.apps.installationChangeSnapshot()
	for {
		select {
		case <-ctx.Done():
			return
		case <-changes:
			nextVersion, nextChanges := s.apps.installationChangeSnapshot()
			changes = nextChanges
			if nextVersion == version {
				continue
			}
			version = nextVersion
			frame, err := json.Marshal(map[string]any{
				"type":    "event",
				"channel": "app",
				"data":    map[string]any{"event": "app.installations.updated"},
			})
			if err != nil {
				continue
			}
			s.bus.Publish("app", "", frame)
		}
	}
}
