//! 绘制 op 解码与 vello Scene 构建。
//!
//! JS 侧（`web/lib/pomelo/pomelo-vello/op-bridge.ts`）把每个 chunk 的绘制编码成
//! 小端字节流；本模块解码为 `DrawOp` 并构建 `vello::Scene`。格式固定、无 serde 依赖。
//!
//! 字节布局（小端，记录流，无总数头）：
//! ```text
//! u8 kind
//! kind=1 ROUND_RECT:   f32 x,y,w,h,radius; u8[4] fill; u8[4] stroke; f32 stroke_width
//! kind=2 QUAD_STROKE:  f32 p0x,p0y,cpx,cpy,p1x,p1y; u8[4] stroke; f32 stroke_width
//! kind=3 TRIANGLE_FILL: f32 x0,y0,x1,y1,x2,y2; u8[4] fill
//! kind=4 RECT_FILL:    f32 x,y,w,h; u8[4] fill
//! kind=5 TEXT:         u32 font_id; f32 x,y,size,max_width,line_height; u8 align; u8[4] fill;
//!                      u32 text_len; utf8[text_len]
//! ```
use std::collections::HashMap;

use skrifa::instance::{LocationRef, Size};
use skrifa::{FontRef, GlyphId, MetadataProvider};
use vello::kurbo::{Affine, BezPath, Rect, RoundedRect, Stroke};
use vello::peniko::{Brush, Color, Fill, FontData, ImageData};
use vello::{Glyph, Scene};

pub const KIND_ROUND_RECT: u8 = 1;
pub const KIND_QUAD_STROKE: u8 = 2;
pub const KIND_TRIANGLE_FILL: u8 = 3;
pub const KIND_RECT_FILL: u8 = 4;
pub const KIND_TEXT: u8 = 5;
pub const KIND_IMAGE: u8 = 6;
pub const KIND_BLUR_RECT: u8 = 7;
pub const KIND_PUSH_CLIP_ROUND_RECT: u8 = 8;
pub const KIND_POP_CLIP: u8 = 9;

#[derive(Debug, Clone, PartialEq)]
pub enum DrawOp {
    RoundRect {
        x: f32,
        y: f32,
        w: f32,
        h: f32,
        radius: f32,
        fill: [u8; 4],
        stroke: [u8; 4],
        stroke_width: f32,
    },
    QuadStroke {
        p0: [f32; 2],
        cp: [f32; 2],
        p1: [f32; 2],
        stroke: [u8; 4],
        stroke_width: f32,
    },
    TriangleFill {
        points: [[f32; 2]; 3],
        fill: [u8; 4],
    },
    RectFill {
        x: f32,
        y: f32,
        w: f32,
        h: f32,
        fill: [u8; 4],
    },
    Text {
        font_id: u32,
        x: f32,
        y: f32,
        size: f32,
        max_width: f32,
        line_height: f32,
        align: u8,
        fill: [u8; 4],
        text: String,
    },
    Image {
        image_id: u32,
        x: f32,
        y: f32,
        w: f32,
        h: f32,
    },
    BlurRect {
        x: f32,
        y: f32,
        w: f32,
        h: f32,
        radius: f32,
        std_dev: f32,
        fill: [u8; 4],
    },
    PushClipRoundRect { x: f32, y: f32, w: f32, h: f32, radius: f32 },
    PopClip,
}

struct Cursor<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> Cursor<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }

    fn remaining(&self) -> usize {
        self.bytes.len().saturating_sub(self.offset)
    }

    fn take(&mut self, n: usize) -> Result<&'a [u8], String> {
        if self.offset + n > self.bytes.len() {
            return Err(format!("op buffer truncated at {} (need {n})", self.offset));
        }
        let slice = &self.bytes[self.offset..self.offset + n];
        self.offset += n;
        Ok(slice)
    }

    fn u8(&mut self) -> Result<u8, String> {
        Ok(self.take(1)?[0])
    }

    fn u32(&mut self) -> Result<u32, String> {
        let b = self.take(4)?;
        Ok(u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }

    fn f32(&mut self) -> Result<f32, String> {
        let b = self.take(4)?;
        Ok(f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }

    fn pair(&mut self) -> Result<[f32; 2], String> {
        Ok([self.f32()?, self.f32()?])
    }

    fn rgba(&mut self) -> Result<[u8; 4], String> {
        let b = self.take(4)?;
        Ok([b[0], b[1], b[2], b[3]])
    }
}

pub fn decode_ops(bytes: &[u8]) -> Result<Vec<DrawOp>, String> {
    let mut cursor = Cursor::new(bytes);
    let mut ops = Vec::new();
    while cursor.remaining() > 0 {
        let kind = cursor.u8()?;
        let op = match kind {
            KIND_ROUND_RECT => DrawOp::RoundRect {
                x: cursor.f32()?,
                y: cursor.f32()?,
                w: cursor.f32()?,
                h: cursor.f32()?,
                radius: cursor.f32()?,
                fill: cursor.rgba()?,
                stroke: cursor.rgba()?,
                stroke_width: cursor.f32()?,
            },
            KIND_QUAD_STROKE => DrawOp::QuadStroke {
                p0: cursor.pair()?,
                cp: cursor.pair()?,
                p1: cursor.pair()?,
                stroke: cursor.rgba()?,
                stroke_width: cursor.f32()?,
            },
            KIND_TRIANGLE_FILL => DrawOp::TriangleFill {
                points: [cursor.pair()?, cursor.pair()?, cursor.pair()?],
                fill: cursor.rgba()?,
            },
            KIND_RECT_FILL => DrawOp::RectFill {
                x: cursor.f32()?,
                y: cursor.f32()?,
                w: cursor.f32()?,
                h: cursor.f32()?,
                fill: cursor.rgba()?,
            },
            KIND_TEXT => {
                let font_id = cursor.u32()?;
                let x = cursor.f32()?;
                let y = cursor.f32()?;
                let size = cursor.f32()?;
                let max_width = cursor.f32()?;
                let line_height = cursor.f32()?;
                let align = cursor.u8()?;
                let fill = cursor.rgba()?;
                let text_len = cursor.u32()? as usize;
                let text = String::from_utf8_lossy(cursor.take(text_len)?).into_owned();
                DrawOp::Text { font_id, x, y, size, max_width, line_height, align, fill, text }
            }
            KIND_IMAGE => DrawOp::Image {
                image_id: cursor.u32()?,
                x: cursor.f32()?,
                y: cursor.f32()?,
                w: cursor.f32()?,
                h: cursor.f32()?,
            },
            KIND_BLUR_RECT => DrawOp::BlurRect {
                x: cursor.f32()?,
                y: cursor.f32()?,
                w: cursor.f32()?,
                h: cursor.f32()?,
                radius: cursor.f32()?,
                std_dev: cursor.f32()?,
                fill: cursor.rgba()?,
            },
            KIND_PUSH_CLIP_ROUND_RECT => DrawOp::PushClipRoundRect {
                x: cursor.f32()?,
                y: cursor.f32()?,
                w: cursor.f32()?,
                h: cursor.f32()?,
                radius: cursor.f32()?,
            },
            KIND_POP_CLIP => DrawOp::PopClip,
            other => return Err(format!("unknown op kind {other}")),
        };
        ops.push(op);
    }
    Ok(ops)
}

fn color(rgba: [u8; 4]) -> Color {
    Color::from_rgba8(rgba[0], rgba[1], rgba[2], rgba[3])
}

/// 世界坐标 → 瓦片设备像素的仿射：scale(level) 后平移到 (bleed, bleed)。
/// level 已由 JS 侧按 `tileLevel(zoom*dpr)` 计算（世界→设备像素），此处不再乘 dpr。
pub fn tile_transform(level: f32, tile_min_x: f32, tile_min_y: f32, bleed: f32) -> Affine {
    let scale = level as f64;
    Affine::translate((
        (-tile_min_x as f64) * scale + bleed as f64,
        (-tile_min_y as f64) * scale + bleed as f64,
    )) * Affine::scale(scale)
}

/// 把 op 构建进 scene；所有绘制使用 `transform`（世界坐标 → 设备像素）。
/// `clip_size` 为设备像素的裁剪正方形边长（含 bleed），在设备空间裁剪。
/// `fonts` 为已注册字体（font_id → FontData），供 TEXT op 使用；`images` 为已注册图像（image_id → ImageData）。
pub fn build_scene(
    ops: &[DrawOp],
    transform: Affine,
    clip_width: f32,
    clip_height: f32,
    fonts: &HashMap<u32, FontData>,
    fallbacks: &HashMap<u32, u32>,
    images: &HashMap<u32, ImageData>,
    scene: &mut Scene,
) {
    scene.push_clip_layer(Fill::NonZero, Affine::IDENTITY, &Rect::new(0.0, 0.0, clip_width as f64, clip_height as f64));
    for op in ops {
        match op {
            DrawOp::PushClipRoundRect { x, y, w, h, radius } => {
                let rect = Rect::new(*x as f64, *y as f64, (*x + *w) as f64, (*y + *h) as f64);
                let shape = RoundedRect::from_rect(rect, *radius as f64);
                scene.push_clip_layer(Fill::NonZero, transform, &shape);
            }
            DrawOp::PopClip => {
                scene.pop_layer();
            }
            DrawOp::RoundRect { x, y, w, h, radius, fill, stroke, stroke_width } => {
                let rect = Rect::new(*x as f64, *y as f64, (*x + *w) as f64, (*y + *h) as f64);
                let shape = RoundedRect::from_rect(rect, *radius as f64);
                if fill[3] > 0 {
                    scene.fill(Fill::NonZero, transform, &Brush::Solid(color(*fill)), None, &shape);
                }
                if stroke[3] > 0 && *stroke_width > 0.0 {
                    scene.stroke(
                        &Stroke::new(*stroke_width as f64),
                        transform,
                        &Brush::Solid(color(*stroke)),
                        None,
                        &shape,
                    );
                }
            }
            DrawOp::QuadStroke { p0, cp, p1, stroke, stroke_width } => {
                if stroke[3] == 0 || *stroke_width <= 0.0 {
                    continue;
                }
                let mut path = BezPath::new();
                path.move_to((p0[0] as f64, p0[1] as f64));
                path.quad_to((cp[0] as f64, cp[1] as f64), (p1[0] as f64, p1[1] as f64));
                scene.stroke(&Stroke::new(*stroke_width as f64), transform, &Brush::Solid(color(*stroke)), None, &path);
            }
            DrawOp::TriangleFill { points, fill } => {
                if fill[3] == 0 {
                    continue;
                }
                let mut path = BezPath::new();
                path.move_to((points[0][0] as f64, points[0][1] as f64));
                path.line_to((points[1][0] as f64, points[1][1] as f64));
                path.line_to((points[2][0] as f64, points[2][1] as f64));
                path.close_path();
                scene.fill(Fill::NonZero, transform, &Brush::Solid(color(*fill)), None, &path);
            }
            DrawOp::RectFill { x, y, w, h, fill } => {
                if fill[3] == 0 {
                    continue;
                }
                let rect = Rect::new(*x as f64, *y as f64, (*x + *w) as f64, (*y + *h) as f64);
                scene.fill(Fill::NonZero, transform, &Brush::Solid(color(*fill)), None, &rect);
            }
            DrawOp::BlurRect { x, y, w, h, radius, std_dev, fill } => {
                if fill[3] == 0 {
                    continue;
                }
                let rect = Rect::new(*x as f64, *y as f64, (*x + *w) as f64, (*y + *h) as f64);
                scene.draw_blurred_rounded_rect(transform, rect, color(*fill), *radius as f64, *std_dev as f64);
            }
            DrawOp::Image { image_id, x, y, w, h } => {
                let Some(image) = images.get(image_id) else { continue };
                if image.width == 0 || image.height == 0 || *w <= 0.0 || *h <= 0.0 {
                    continue;
                }
                let local = Affine::translate((*x as f64, *y as f64))
                    * Affine::scale_non_uniform(*w as f64 / image.width as f64, *h as f64 / image.height as f64);
                scene.draw_image(image, transform * local);
            }
            DrawOp::Text { font_id, x, y, size, max_width, line_height, align, fill, text } => {
                if fill[3] == 0 || text.is_empty() {
                    continue;
                }
                let Some(font) = fonts.get(font_id) else { continue };
                let fallback = fallbacks.get(font_id).and_then(|id| fonts.get(id));
                draw_text(font, fallback, *x, *y, *size, *max_width, *line_height, *align, color(*fill), text, transform, scene);
            }
        }
    }
    scene.pop_layer();
}

#[allow(clippy::too_many_arguments)]
fn draw_text(
    primary: &FontData,
    fallback: Option<&FontData>,
    x: f32,
    y: f32,
    size: f32,
    max_width: f32,
    line_height: f32,
    align: u8,
    fill: Color,
    text: &str,
    transform: Affine,
    scene: &mut Scene,
) {
    let Ok(primary_ref) = FontRef::from_index(primary.data.as_ref(), primary.index) else {
        return;
    };
    let primary_charmap = primary_ref.charmap();
    let s = Size::new(if size > 0.0 { size } else { 16.0 });
    let primary_metrics = primary_ref.metrics(s, LocationRef::default());
    let primary_glyph_metrics = primary_ref.glyph_metrics(s, LocationRef::default());
    let ascent = if primary_metrics.ascent.is_finite() { primary_metrics.ascent } else { size * 0.8 };
    let leading = if line_height.is_finite() && line_height > 0.0 {
        line_height
    } else if primary_metrics.ascent.is_finite() && primary_metrics.descent.is_finite() && primary_metrics.leading.is_finite() {
        (primary_metrics.ascent - primary_metrics.descent + primary_metrics.leading).max(size * 1.2)
    } else {
        size * 1.2
    };
    let primary_fallback_advance = primary_metrics
        .average_width
        .filter(|w| w.is_finite() && *w > 0.0)
        .unwrap_or(size * 0.5);

    // fallback 字体（可选）：主字体缺字时回退
    let fallback_data = fallback.and_then(|data| {
        let font_ref = FontRef::from_index(data.data.as_ref(), data.index).ok()?;
        let charmap = font_ref.charmap();
        let metrics = font_ref.glyph_metrics(s, LocationRef::default());
        let average = font_ref
            .metrics(s, LocationRef::default())
            .average_width
            .filter(|w| w.is_finite() && *w > 0.0)
            .unwrap_or(size * 0.5);
        let font: &FontData = data;
        Some((font, charmap, metrics, average))
    });

    let mut primary_glyphs: Vec<Glyph> = Vec::new();
    let mut fallback_glyphs: Vec<Glyph> = Vec::new();
    let mut cursor_y = 0.0f32;
    for line in text.split('\n') {
        let mut entries: Vec<(bool, Glyph)> = Vec::new();
        let mut line_width = 0.0f32;
        for ch in line.chars() {
            let (is_fallback, glyph, advance) = match primary_charmap.map(ch) {
                Some(glyph_id) => (
                    false,
                    Glyph { id: glyph_id.to_u32(), x: 0.0, y: 0.0 },
                    primary_glyph_metrics.advance_width(glyph_id).unwrap_or(primary_fallback_advance),
                ),
                None => match &fallback_data {
                    Some((_, charmap, metrics, average)) => {
                        let glyph_id = charmap.map(ch).unwrap_or(GlyphId::NOTDEF);
                        (true, Glyph { id: glyph_id.to_u32(), x: 0.0, y: 0.0 }, metrics.advance_width(glyph_id).unwrap_or(*average))
                    }
                    None => {
                        let glyph_id = GlyphId::NOTDEF;
                        (false, Glyph { id: glyph_id.to_u32(), x: 0.0, y: 0.0 }, primary_fallback_advance)
                    }
                },
            };
            entries.push((is_fallback, glyph));
            line_width += advance;
        }
        let offset_x = match align {
            1 => (max_width - line_width) * 0.5,
            2 => max_width - line_width,
            _ => 0.0,
        };
        let mut cursor_x = x + offset_x;
        for (is_fallback, glyph) in entries {
            let mut placed = glyph;
            placed.x = cursor_x;
            placed.y = y + ascent + cursor_y;
            let advance = if is_fallback {
                fallback_data
                    .as_ref()
                    .and_then(|(_, _, metrics, average)| metrics.advance_width(GlyphId::new(placed.id)).or(Some(*average)))
                    .unwrap_or(primary_fallback_advance)
            } else {
                primary_glyph_metrics.advance_width(GlyphId::new(placed.id)).unwrap_or(primary_fallback_advance)
            };
            if is_fallback {
                fallback_glyphs.push(placed);
            } else {
                primary_glyphs.push(placed);
            }
            cursor_x += advance;
        }
        cursor_y += leading;
    }

    if !primary_glyphs.is_empty() {
        scene.draw_glyphs(primary).font_size(size).transform(transform).brush(&Brush::Solid(fill)).draw(Fill::NonZero, primary_glyphs.into_iter());
    }
    if let Some((font, _, _, _)) = &fallback_data {
        if !fallback_glyphs.is_empty() {
            scene.draw_glyphs(font).font_size(size).transform(transform).brush(&Brush::Solid(fill)).draw(Fill::NonZero, fallback_glyphs.into_iter());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use vello::kurbo::Rect;

    fn enc(push: impl FnOnce(&mut Vec<u8>)) -> Vec<u8> {
        let mut bytes = Vec::new();
        push(&mut bytes);
        bytes
    }

    fn f32b(v: f32) -> [u8; 4] {
        v.to_le_bytes()
    }

    fn no_fonts() -> HashMap<u32, FontData> {
        HashMap::new()
    }

    fn no_fallbacks() -> HashMap<u32, u32> {
        HashMap::new()
    }

    fn no_images() -> HashMap<u32, ImageData> {
        HashMap::new()
    }

    #[test]
    fn decode_round_rect_roundtrip() {
        let bytes = enc(|b| {
            b.push(KIND_ROUND_RECT);
            for v in [10.0f32, 20.0, 220.0, 120.0, 14.0] {
                b.extend_from_slice(&f32b(v));
            }
            b.extend_from_slice(&[20, 21, 26, 255]);
            b.extend_from_slice(&[59, 130, 246, 217]);
            b.extend_from_slice(&f32b(2.0));
        });
        let ops = decode_ops(&bytes).expect("decode");
        assert_eq!(ops.len(), 1);
        match &ops[0] {
            DrawOp::RoundRect { x, y, w, h, radius, fill, stroke, stroke_width } => {
                assert_eq!((*x, *y, *w, *h, *radius), (10.0, 20.0, 220.0, 120.0, 14.0));
                assert_eq!(*fill, [20, 21, 26, 255]);
                assert_eq!(*stroke, [59, 130, 246, 217]);
                assert_eq!(*stroke_width, 2.0);
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn decode_text_roundtrip() {
        let bytes = enc(|b| {
            b.push(KIND_TEXT);
            b.extend_from_slice(&7u32.to_le_bytes());
            for v in [3.0f32, 4.0, 16.0, 100.0, 20.0] {
                b.extend_from_slice(&f32b(v));
            }
            b.push(1); // align center
            b.extend_from_slice(&[229, 231, 235, 255]);
            let text = "Entity 1".as_bytes();
            b.extend_from_slice(&(text.len() as u32).to_le_bytes());
            b.extend_from_slice(text);
        });
        let ops = decode_ops(&bytes).expect("decode");
        match &ops[0] {
            DrawOp::Text { font_id, x, y, size, align, fill, text, .. } => {
                assert_eq!(*font_id, 7);
                assert_eq!((*x, *y, *size, *align), (3.0, 4.0, 16.0, 1));
                assert_eq!(*fill, [229, 231, 235, 255]);
                assert_eq!(text, "Entity 1");
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn decode_mixed_and_build_scene() {
        let bytes = enc(|b| {
            b.push(KIND_QUAD_STROKE);
            for v in [0.0f32, 0.0, 50.0, -40.0, 100.0, 0.0] {
                b.extend_from_slice(&f32b(v));
            }
            b.extend_from_slice(&[139, 147, 167, 255]);
            b.extend_from_slice(&f32b(2.0));
            b.push(KIND_RECT_FILL);
            for v in [0.0f32, 3200.0, 1400.0, 700.0] {
                b.extend_from_slice(&f32b(v));
            }
            b.extend_from_slice(&[34, 197, 94, 255]);
        });
        let ops = decode_ops(&bytes).expect("decode");
        assert_eq!(ops.len(), 2);
        let transform = tile_transform(1.0, 0.0, 0.0, 2.0);
        assert_eq!(transform, Affine::translate((2.0, 2.0)) * Affine::scale(1.0));
        let mut scene = Scene::new();
        build_scene(&ops, transform, 260.0, 260.0, &no_fonts(), &no_fallbacks(), &no_images(), &mut scene);
        let _ = Rect::new(0.0, 0.0, 1.0, 1.0);
    }

    #[test]
    fn decode_rejects_truncated_and_unknown() {
        let truncated = enc(|b| {
            b.push(KIND_RECT_FILL);
            b.extend_from_slice(&f32b(0.0));
        });
        assert!(decode_ops(&truncated).is_err());

        let unknown = enc(|b| {
            b.push(99);
        });
        assert!(decode_ops(&unknown).is_err());
    }
}
