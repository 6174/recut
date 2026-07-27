/*
 * [INPUT]: 依赖 Store 的工作区数据库、项目校验与数据目录
 * [OUTPUT]: 对外提供 media 包的根服务兼容类型和构造入口
 * [POS]: service 的组合适配层；媒体领域实现完全位于 media/
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"database/sql"

	media "recut-service/media"
)

type MediaService = media.MediaService
type MediaCapability = media.MediaCapability
type MediaModel = media.MediaModel
type MediaProvider = media.MediaProvider
type MediaConfiguration = media.MediaConfiguration
type MediaVoice = media.MediaVoice
type MediaCredential = media.MediaCredential
type MediaRoute = media.MediaRoute
type MediaAsset = media.MediaAsset
type MediaJob = media.MediaJob
type GenerateMediaInput = media.GenerateMediaInput

const (
	ImageGenerate  = media.ImageGenerate
	VideoGenerate  = media.VideoGenerate
	SpeechGenerate = media.SpeechGenerate
)

const interruptedMediaJobMessage = media.InterruptedMediaJobMessage
const maxMediaUploadBytes = media.MaxMediaUploadBytes

type mediaStoreAdapter struct{ store *Store }

func (a mediaStoreAdapter) WorkspaceDatabase() (*sql.DB, error) {
	return a.store.WorkspaceDatabase()
}
func (a mediaStoreAdapter) MediaRoot() string { return a.store.root }
func (a mediaStoreAdapter) ProjectExists(id string) error {
	_, err := a.store.Get(id)
	return err
}

func NewMediaService(store *Store) *MediaService {
	return media.NewMediaService(mediaStoreAdapter{store: store})
}

func providerByID(id string) (MediaProvider, bool) { return media.ProviderByID(id) }
func modelByID(id string) (MediaModel, bool)       { return media.ModelByID(id) }
func validateModelReferences(model MediaModel, images, videos, audios int) error {
	return media.ValidateModelReferences(model, images, videos, audios)
}
func referenceKindsFor(capability MediaCapability) map[string]bool {
	return media.ReferenceKindsFor(capability)
}
