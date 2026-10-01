/*
 * [INPUT]: 依赖 standard library 的 image/png、image/jpeg 与 testing
 * [OUTPUT]: 锁定参考图归一层的单边上限、去 alpha、无法解码时回退，以及 referenceImagePolicy 的
 *           「图片默认全局 1024、{raw:true} 退出」语义
 * [POS]: service 的参考图处理层单测；不依赖 AppHost/文件系统以外的宿主状态
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"testing"
)

func encodePNG(t *testing.T, img image.Image) []byte {
	t.Helper()
	var buffer bytes.Buffer
	if err := png.Encode(&buffer, img); err != nil {
		t.Fatalf("encode png: %v", err)
	}
	return buffer.Bytes()
}

func TestNormalizeReferenceImageDownscalesToMaxEdge(t *testing.T) {
	source := image.NewRGBA(image.Rect(0, 0, 2816, 1584))
	for i := range source.Pix {
		source.Pix[i] = 0x40
	}
	normalized, extension, ok := normalizeReferenceImage(encodePNG(t, source), 1024)
	if !ok {
		t.Fatal("expected an oversized reference image to be normalized")
	}
	if extension != ".jpg" {
		t.Fatalf("extension = %q, want .jpg", extension)
	}
	decoded, format, err := image.Decode(bytes.NewReader(normalized))
	if err != nil {
		t.Fatalf("decode normalized: %v", err)
	}
	if format != "jpeg" {
		t.Fatalf("format = %q, want jpeg", format)
	}
	if got := decoded.Bounds().Dx(); got != 1024 {
		t.Fatalf("width = %d, want 1024", got)
	}
	if got := decoded.Bounds().Dy(); got != 576 {
		t.Fatalf("height = %d, want 576", got)
	}
}

func TestNormalizeReferenceImageFlattensAlpha(t *testing.T) {
	source := image.NewRGBA(image.Rect(0, 0, 341, 341))
	for y := 0; y < 341; y++ {
		for x := 0; x < 341; x++ {
			source.SetRGBA(x, y, color.RGBA{R: 200, G: 100, B: 50, A: 0})
		}
	}
	normalized, extension, ok := normalizeReferenceImage(encodePNG(t, source), 1024)
	if !ok {
		t.Fatal("an RGBA image within the cap still needs normalization (alpha drop)")
	}
	if extension != ".jpg" {
		t.Fatalf("extension = %q, want .jpg", extension)
	}
	decoded, _, err := image.Decode(bytes.NewReader(normalized))
	if err != nil {
		t.Fatalf("decode normalized: %v", err)
	}
	if _, _, _, alpha := decoded.At(0, 0).RGBA(); alpha != 0xffff {
		t.Fatalf("alpha at origin = %d, want opaque", alpha)
	}
	red, _, _, _ := decoded.At(0, 0).RGBA()
	// 透明像素合成到白底 → 接近白色而不是源图的 (200,100,50)。
	if red < 0x8000 {
		t.Fatalf("red channel = %d, want composited over white", red)
	}
}

func TestNormalizeReferenceImageLeavesSmallJPEGUntouched(t *testing.T) {
	source := image.NewRGBA(image.Rect(0, 0, 200, 100))
	var buffer bytes.Buffer
	if err := jpeg.Encode(&buffer, source, nil); err != nil {
		t.Fatalf("encode jpeg: %v", err)
	}
	if _, _, ok := normalizeReferenceImage(buffer.Bytes(), 1024); ok {
		t.Fatal("a JPEG within the cap must not be re-encoded")
	}
}

func TestNormalizeReferenceImageFallsBackOnUndecodable(t *testing.T) {
	if _, _, ok := normalizeReferenceImage([]byte("<svg></svg>"), 1024); ok {
		t.Fatal("an undecodable reference must fall back to a verbatim copy")
	}
}

func TestScaleToMaxEdgeNeverEnlarges(t *testing.T) {
	if width, height := scaleToMaxEdge(300, 200, 1024); width != 300 || height != 200 {
		t.Fatalf("scaleToMaxEdge(300,200,1024) = %dx%d, want 300x200", width, height)
	}
	if width, height := scaleToMaxEdge(2048, 512, 1024); width != 1024 || height != 256 {
		t.Fatalf("scaleToMaxEdge(2048,512,1024) = %dx%d, want 1024x256", width, height)
	}
	if width, height := scaleToMaxEdge(2048, 512, 0); width != 2048 || height != 512 {
		t.Fatalf("maxEdge 0 must disable the cap, got %dx%d", width, height)
	}
}

func TestReferenceImagePolicyIsGlobalAndOptOut(t *testing.T) {
	imageAsset := MediaAsset{Kind: "image", MimeType: "image/png"}
	videoAsset := MediaAsset{Kind: "video", MimeType: "video/mp4"}

	// 图片默认归一，上限是全局常量——App / 模型都不需要声明。
	if maxEdge, normalize := referenceImagePolicy(imageAsset, nil); !normalize || maxEdge != maxReferenceImageEdge {
		t.Fatalf("default image policy = (%d, %v), want (%d, true)", maxEdge, normalize, maxReferenceImageEdge)
	}
	// 非图片素材不经过图片层。
	if _, normalize := referenceImagePolicy(videoAsset, nil); normalize {
		t.Fatal("video assets must not go through the image layer")
	}
	// 渲染/合成类消费方显式退出，拿回原图。
	if _, normalize := referenceImagePolicy(imageAsset, map[string]any{"raw": true}); normalize {
		t.Fatal("raw:true must opt out of normalization")
	}
}
