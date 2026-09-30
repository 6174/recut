/*
 * [INPUT]: 依赖标准库 image/jpeg、image/png、image/gif（解码）与 image/draw；ctx.media.materialize 的 options
 * [OUTPUT]: 参考图归一层：把参考图等比缩到声明的单边上限、压成去 alpha 的 RGB JPEG；解析逻辑
 *           declaredReferenceImageSpec（manifest contributes.media.models[].referenceImage）
 * [POS]: service 的通用参考图处理层；只认像素与 manifest 声明，不认识任何具体 App/模型
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"bytes"
	"image"
	"image/color"
	"image/draw"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"
)

// defaultReferenceImageMaxEdge 是参考图的默认单边像素上限。参考图的意义是「参考」，不是把原始大图
// 塞给模型：超过这个尺寸的参考图一律等比缩小（只缩不放），既省上传/显存，也避开大图触发的管线异常。
const defaultReferenceImageMaxEdge = 1024

// referenceJPEGQuality 是归一后 JPEG 的质量。参考图会被模型再次下采样，92 足够且体积远小于 PNG。
const referenceJPEGQuality = 92

// normalizeReferenceImage 把一张参考图归一为「长边 <= maxEdge 的 RGB JPEG」。
//
// 返回 (bytes, 扩展名, true) 表示已归一；返回 (nil, "", false) 表示无需或无法处理，调用方应原样落盘：
// 图片本来就小于上限且已是 JPEG、或无法解码（SVG/HEIC/损坏文件）时都走这条路，归一层永远不阻断既有链路。
func normalizeReferenceImage(raw []byte, maxEdge int) ([]byte, string, bool) {
	source, format, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return nil, "", false
	}
	width, height := source.Bounds().Dx(), source.Bounds().Dy()
	if width <= 0 || height <= 0 {
		return nil, "", false
	}
	targetWidth, targetHeight := scaleToMaxEdge(width, height, maxEdge)
	resize := targetWidth != width || targetHeight != height
	// 已是不带 alpha 的 JPEG 且无需缩放：原样返回，避免无谓的有损重编码。
	if !resize && format == "jpeg" {
		return nil, "", false
	}
	opaque := flattenToRGB(source)
	if resize {
		opaque = resizeBox(opaque, targetWidth, targetHeight)
	}
	var buffer bytes.Buffer
	if err := jpeg.Encode(&buffer, opaque, &jpeg.Options{Quality: referenceJPEGQuality}); err != nil {
		return nil, "", false
	}
	return buffer.Bytes(), ".jpg", true
}

// scaleToMaxEdge 等比缩放 (width, height) 使长边不超过 maxEdge；maxEdge <= 0 或本来就够小则原样返回。
func scaleToMaxEdge(width, height, maxEdge int) (int, int) {
	if maxEdge <= 0 || (width <= maxEdge && height <= maxEdge) {
		return width, height
	}
	scale := float64(maxEdge) / float64(max(width, height))
	scaledWidth := int(float64(width)*scale + 0.5)
	scaledHeight := int(float64(height)*scale + 0.5)
	return max(1, scaledWidth), max(1, scaledHeight)
}

// flattenToRGB 把任意解码结果压成不透明 RGBA：透明像素合成到白底，多数扩散管线按 RGB 读参考图，
// RGBA（如带透明通道的 PNG）直接喂进去会踩到通道数/尺寸假设。
func flattenToRGB(source image.Image) *image.RGBA {
	bounds := source.Bounds()
	target := image.NewRGBA(image.Rect(0, 0, bounds.Dx(), bounds.Dy()))
	draw.Draw(target, target.Bounds(), image.NewUniform(color.White), image.Point{}, draw.Src)
	draw.Draw(target, target.Bounds(), source, bounds.Min, draw.Over)
	return target
}

// resizeBox 是面积平均（box filter）降采样：每个目标像素取源图对应矩形的均值。缩小时比最近邻干净得多，
// 且不引入第三方依赖（golang.org/x/image/draw 会带进新的 module）。
func resizeBox(source *image.RGBA, width, height int) *image.RGBA {
	sourceWidth, sourceHeight := source.Bounds().Dx(), source.Bounds().Dy()
	target := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		y0 := y * sourceHeight / height
		y1 := (y + 1) * sourceHeight / height
		if y1 <= y0 {
			y1 = y0 + 1
		}
		for x := 0; x < width; x++ {
			x0 := x * sourceWidth / width
			x1 := (x + 1) * sourceWidth / width
			if x1 <= x0 {
				x1 = x0 + 1
			}
			var red, green, blue, count uint64
			for sy := y0; sy < y1; sy++ {
				row := sy * source.Stride
				for sx := x0; sx < x1; sx++ {
					offset := row + sx*4
					red += uint64(source.Pix[offset])
					green += uint64(source.Pix[offset+1])
					blue += uint64(source.Pix[offset+2])
					count++
				}
			}
			targetOffset := y*target.Stride + x*4
			target.Pix[targetOffset] = uint8(red / count)
			target.Pix[targetOffset+1] = uint8(green / count)
			target.Pix[targetOffset+2] = uint8(blue / count)
			target.Pix[targetOffset+3] = 255
		}
	}
	return target
}

// referenceImagePolicy 判断一次 materialize 是否要把图片当参考图归一，并给出策略。
//
// 只有调用方显式声明这是参考图才处理（options.reference / options.model / options.image 任一）：
// 合成/渲染类素材（如 remotion 把 composition 素材物化去渲染）不带 options，必须保持原图不动。
func referenceImagePolicy(manifest Manifest, asset MediaAsset, options map[string]any) (ReferenceImageSpec, bool) {
	if asset.Kind != "image" {
		return ReferenceImageSpec{}, false
	}
	if explicit, ok := options["image"].(map[string]any); ok {
		return ReferenceImageSpec{MaxEdge: int(numericValue(explicit["maxEdge"]))}, true
	}
	model := stringValue(options["model"])
	if model == "" && !boolValue(options["reference"]) {
		return ReferenceImageSpec{}, false
	}
	return declaredReferenceImageSpec(manifest, model), true
}

// declaredReferenceImageSpec 取某个模型的参考图策略；模型没声明或名字对不上时回落默认单边上限。
// MaxEdge <= 0 是「显式不限制」，故只有完全不声明才回落默认值；多处声明时取最严（最小正值）保证确定性。
func declaredReferenceImageSpec(manifest Manifest, model string) ReferenceImageSpec {
	declared := contributedReferenceImageSpecs(manifest)
	if spec, ok := declared[model]; ok && model != "" {
		return spec
	}
	strictest := 0
	for _, spec := range declared {
		if spec.MaxEdge <= 0 {
			continue
		}
		if strictest == 0 || spec.MaxEdge < strictest {
			strictest = spec.MaxEdge
		}
	}
	if strictest > 0 {
		return ReferenceImageSpec{MaxEdge: strictest}
	}
	return ReferenceImageSpec{MaxEdge: defaultReferenceImageMaxEdge}
}

// contributedReferenceImageSpecs 汇总 App manifest 里 contributes.media 各模型声明的参考图策略。
func contributedReferenceImageSpecs(manifest Manifest) map[string]ReferenceImageSpec {
	specs := map[string]ReferenceImageSpec{}
	if manifest.Contributes == nil || manifest.Contributes.Media == nil {
		return specs
	}
	for _, provider := range manifest.Contributes.Media.Providers {
		for _, model := range provider.Models {
			if model.ReferenceImage == nil {
				continue
			}
			specs[model.ID] = *model.ReferenceImage
		}
	}
	return specs
}
