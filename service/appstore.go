/*
 * [INPUT]: 依赖内嵌的默认 App Store 清单与用户可覆盖的 <data-dir>/appstore.json
 * [OUTPUT]: 对外提供 StoreApp 目录（名称、类型、GitHub repository），供 Agent 经 recut.apps.store 发现可安装 App
 * [POS]: service 的应用分发发现边界；商店清单可被本地文件覆盖，使社区/用户能扩展可安装目录而不改代码
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

//go:embed appstore/apps.json
var embeddedAppStore []byte

// StoreApp is one installable App advertised by the store.
type StoreApp struct {
	AppID       string `json:"appId"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Kind        string `json:"kind"`
	Repository  string `json:"repository"`
}

// AppStore returns the store catalog: the user-provided <data-dir>/appstore.json
// when present, otherwise the embedded default. A store entry's repository is
// what recut.apps.install consumes.
func (s *Store) AppStore() ([]StoreApp, error) {
	data := embeddedAppStore
	if override, err := os.ReadFile(filepath.Join(s.root, "appstore.json")); err == nil {
		data = override
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	apps := []StoreApp{}
	if err := json.Unmarshal(data, &apps); err != nil {
		return nil, fmt.Errorf("parse app store catalog: %w", err)
	}
	for index := range apps {
		if apps[index].AppID == "" || apps[index].Name == "" || apps[index].Repository == "" {
			return nil, fmt.Errorf("app store entry %d is missing appId, name, or repository", index)
		}
	}
	return apps, nil
}
