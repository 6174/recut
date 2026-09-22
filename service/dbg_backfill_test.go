package main

import (
	"fmt"
	"testing"

	"recut-service/media"
	"recut-service/motion_graphic"
)

func TestDbgBackfill(t *testing.T) {
	apps, store, _, _ := setupEditorTestApp(t)
	host := NewAppHost(apps, store, NewMediaService(store))
	host.motionGraphicExec(Target{}, motion_graphic.OpDefine, map[string]any{"name": "Legacy MG", "surface": "react", "source": platformComponentSource}, DefaultLocale)
	c, err := host.motionGraphicContext(Target{}, DefaultLocale)
	db, _ := store.WorkspaceDatabase()
	fmt.Println("ctx err:", err, "media nil:", c == nil || c.host.media == nil)
	materials := motion_graphic.ListAll(db)
	fmt.Println("materials:", len(materials))
	host.projectComponentAsset(materials[0].ID, materials[0].VersionID())
	page, err := NewMediaService(store).ListAssetsFiltered("", media.MediaAssetFilter{Kind: "component"})
	fmt.Println("total:", page.Total, "err:", err)
	for _, a := range page.Items {
		fmt.Printf("asset %s kind=%s origin=%s meta=%v\n", a.ID, a.Kind, a.Origin, a.Metadata["component"])
	}
}
