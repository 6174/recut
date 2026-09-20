/*
 * [INPUT]: 依赖 Go testing、understand.GridRegions（纯函数）与可注入 Runner 的 ImageSize
 * [OUTPUT]: 覆盖网格切分：等分铺满无缝隙、坐标命名、缝隙裁剪与越界钳制、非法参数报错；以及 ImageSize 在无时长静帧上可用
 * [POS]: media/understand 的网格纯函数与静帧尺寸探测门禁；不依赖 ffmpeg
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package understand

import (
	"context"
	"testing"
)

func TestGridRegionsTilesImageExactly(t *testing.T) {
	regions, err := GridRegions(1000, 500, 5, 5, 0)
	if err != nil {
		t.Fatalf("GridRegions: %v", err)
	}
	if len(regions) != 25 {
		t.Fatalf("expected 25 cells, got %d", len(regions))
	}
	// first and last cells cover the full extent with no overlap
	first, last := regions[0], regions[24]
	if first.X != 0 || first.Y != 0 || first.Width != 200 || first.Height != 100 {
		t.Fatalf("unexpected first cell: %+v", first)
	}
	if last.X != 800 || last.Y != 400 || last.X+last.Width != 1000 || last.Y+last.Height != 500 {
		t.Fatalf("last cell does not reach the edge: %+v", last)
	}
	if first.Coord() != "R1C1" || last.Coord() != "R5C5" {
		t.Fatalf("coords wrong: %s / %s", first.Coord(), last.Coord())
	}
}

func TestGridRegionsTrimsGutterAndClamps(t *testing.T) {
	regions, err := GridRegions(100, 100, 2, 2, 5)
	if err != nil {
		t.Fatalf("GridRegions: %v", err)
	}
	if regions[0].X != 5 || regions[0].Y != 5 || regions[0].Width != 40 || regions[0].Height != 40 {
		t.Fatalf("gutter not applied: %+v", regions[0])
	}
	// gutter larger than the cell keeps at least the full cell (never negative)
	tiny, err := GridRegions(20, 20, 2, 2, 50)
	if err != nil {
		t.Fatalf("GridRegions: %v", err)
	}
	for _, region := range tiny {
		if region.Width < 1 || region.Height < 1 {
			t.Fatalf("cell collapsed: %+v", region)
		}
	}
}

func TestGridRegionsRejectsBadInput(t *testing.T) {
	if _, err := GridRegions(0, 100, 2, 2, 0); err == nil {
		t.Fatal("expected error for zero width")
	}
	if _, err := GridRegions(100, 100, 0, 2, 0); err == nil {
		t.Fatal("expected error for zero rows")
	}
}

func TestImageSizeAcceptsStillImageWithoutDuration(t *testing.T) {
	runner := &fakeRunner{outputs: map[string][]byte{
		"/usr/bin/ffprobe": []byte(`{"streams":[{"codec_type":"video","width":1024,"height":1024}],"format":{}}`),
	}}
	toolkit := &Toolkit{Runner: runner, FFprobe: "/usr/bin/ffprobe"}
	width, height, err := toolkit.ImageSize(context.Background(), "/tmp/sheet.png")
	if err != nil {
		t.Fatalf("ImageSize: %v", err)
	}
	if width != 1024 || height != 1024 {
		t.Fatalf("size = %dx%d", width, height)
	}
}

func TestImageSizeRequiresFFprobe(t *testing.T) {
	toolkit := &Toolkit{Runner: &fakeRunner{}}
	if _, _, err := toolkit.ImageSize(context.Background(), "/tmp/x.png"); err == nil || !IsMissingDependency(err) {
		t.Fatalf("expected structured readiness error, got %v", err)
	}
}
