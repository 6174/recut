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
//!                      f32 embolden; f32 glyph_scale; u32 text_len; utf8[text_len]
//! ```
use std::collections::HashMap;

use skrifa::instance::{LocationRef, Size};
use skrifa::{FontRef, GlyphId, MetadataProvider};
use vello::kurbo::{Affine, BezPath, Diagonal2, Rect, RoundedRect, Stroke};
use vello::peniko::{Brush, Color, Fill, FontData, ImageData};
use vello::{FontEmbolden, Glyph, Scene};

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
        embolden: f32,
        glyph_scale: f32,
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
                let embolden = cursor.f32()?;
                let glyph_scale = cursor.f32()?;
                let text_len = cursor.u32()? as usize;
                let text = String::from_utf8_lossy(cursor.take(text_len)?).into_owned();
                DrawOp::Text { font_id, x, y, size, max_width, line_height, align, embolden, glyph_scale, fill, text }
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
    draw_ops(ops, transform, fonts, fallbacks, images, scene);
    scene.pop_layer();
}

/// 录制 chunk Scene：不做瓦片裁剪、以给定变换（通常 IDENTITY，世界坐标）绘制。
/// 用于 chunk 级 Scene 缓存（open-pencil layer-1），合成时再用 `Scene::append` 施加视口/瓦片变换。
/// 注意：不能用 `build_scene`，其 (0,0,w,h) 裁剪会把负坐标内容裁掉。
pub fn build_chunk_scene(
    ops: &[DrawOp],
    fonts: &HashMap<u32, FontData>,
    fallbacks: &HashMap<u32, u32>,
    images: &HashMap<u32, ImageData>,
    scene: &mut Scene,
) {
    draw_ops(ops, Affine::IDENTITY, fonts, fallbacks, images, scene);
}

fn draw_ops(
    ops: &[DrawOp],
    transform: Affine,
    fonts: &HashMap<u32, FontData>,
    fallbacks: &HashMap<u32, u32>,
    images: &HashMap<u32, ImageData>,
    scene: &mut Scene,
) {
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
            DrawOp::Text { font_id, x, y, size, max_width, line_height, align, embolden, glyph_scale, fill, text } => {
                if fill[3] == 0 || text.is_empty() {
                    continue;
                }
                let Some(font) = fonts.get(font_id) else { continue };
                let fallback_id = fallbacks.get(font_id).copied();
                let fallback = fallback_id.and_then(|id| fonts.get(&id));
                draw_text(*font_id, fallback_id, font, fallback, *x, *y, *size, *max_width, *line_height, *align, *embolden, *glyph_scale, color(*fill), text, transform, scene);
            }
        }
    }
}

#[derive(Clone)]
struct LaidGlyph {
    fallback: bool,
    gid: u32,
    advance: f32,
}

/// 一次文本 shaping 的完整缓存：行内字形（按字符排布）+ 字体度量（ascent/leading）。
/// 命中时完全跳过字体表解析（FontRef/charmap/metrics）与 shaping——这是文本热路径的关键缓存。
#[derive(Clone)]
struct TextLayout {
    lines: Vec<Vec<LaidGlyph>>,
    ascent: f32,
    leading: f32,
    /// 原文（仅用于哈希碰撞时校验，避免 String 作为每个查询的分配键）。
    text: String,
}

/// FNV-1a 64：文本内容哈希（快速、无分配；用于文本布局缓存键）。
fn text_hash(text: &str) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325u64;
    for &byte in text.as_bytes() {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

thread_local! {
    /// key = (font_id, fallback_id, size bits, max_width bits, text hash) → TextLayout。
    /// Copy 键避免每帧为查询分配/哈希 String；同一文本在多个 chunk/瓦片/帧渲染时复用。
    static TEXT_LAYOUT: std::cell::RefCell<std::collections::HashMap<(u32, u32, u32, u32, u64), TextLayout>> =
        std::cell::RefCell::new(std::collections::HashMap::new());
}

/// 解析字体表并 shaping（仅在缓存 miss 时调用）。max_width > 0 时按宽度贪心换行（CJK 逐字符，对齐 pixi breakWords）。
fn build_text_layout(
    primary: &FontData,
    fallback: Option<&FontData>,
    size: f32,
    line_height: f32,
    max_width: f32,
    text: &str,
) -> Option<TextLayout> {
    let primary_ref = FontRef::from_index(primary.data.as_ref(), primary.index).ok()?;
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

    let fallback_data = fallback.and_then(|data| {
        let font_ref = FontRef::from_index(data.data.as_ref(), data.index).ok()?;
        let charmap = font_ref.charmap();
        let metrics = font_ref.glyph_metrics(s, LocationRef::default());
        Some((charmap, metrics))
    });
    let fallback_avg = fallback_data
        .as_ref()
        .and_then(|(_, metrics)| metrics.advance_width(GlyphId::NOTDEF))
        .unwrap_or(primary_fallback_advance);

    let mut lines: Vec<Vec<LaidGlyph>> = Vec::new();
    for raw_line in text.split('\n') {
        let mut current: Vec<LaidGlyph> = Vec::new();
        let mut current_width = 0.0f32;
        for ch in raw_line.chars() {
            let glyph = match primary_charmap.map(ch) {
                Some(glyph_id) => LaidGlyph {
                    fallback: false,
                    gid: glyph_id.to_u32(),
                    advance: primary_glyph_metrics.advance_width(glyph_id).unwrap_or(primary_fallback_advance),
                },
                None => match &fallback_data {
                    Some((charmap, metrics)) => {
                        let glyph_id = charmap.map(ch).unwrap_or(GlyphId::NOTDEF);
                        LaidGlyph {
                            fallback: true,
                            gid: glyph_id.to_u32(),
                            advance: metrics.advance_width(glyph_id).unwrap_or(fallback_avg),
                        }
                    }
                    None => LaidGlyph { fallback: false, gid: GlyphId::NOTDEF.to_u32(), advance: primary_fallback_advance },
                },
            };
            // 贪心换行（CJK 逐字符，对齐 pixi breakWords）；max_width <= 0 不换行
            if max_width > 0.0 && !current.is_empty() && current_width + glyph.advance > max_width {
                lines.push(std::mem::take(&mut current));
                current_width = 0.0;
            }
            current_width += glyph.advance;
            current.push(glyph);
        }
        lines.push(current);
    }
    Some(TextLayout { lines, ascent, leading, text: text.to_string() })
}

/// 由缓存布局计算每个字形的世界坐标（位置依赖 x/y/max_width/align，故不入缓存）。
fn emit_glyphs(
    layout: &TextLayout,
    x: f32,
    y: f32,
    max_width: f32,
    align: u8,
    primary_glyphs: &mut Vec<Glyph>,
    fallback_glyphs: &mut Vec<Glyph>,
) {
    let mut cursor_y = 0.0f32;
    for entries in &layout.lines {
        let line_width: f32 = entries.iter().map(|e| e.advance).sum();
        let offset_x = match align {
            1 => (max_width - line_width) * 0.5,
            2 => max_width - line_width,
            _ => 0.0,
        };
        let mut cursor_x = x + offset_x;
        for entry in entries {
            let glyph = Glyph { id: entry.gid, x: cursor_x, y: y + layout.ascent + cursor_y };
            if entry.fallback {
                fallback_glyphs.push(glyph);
            } else {
                primary_glyphs.push(glyph);
            }
            cursor_x += entry.advance;
        }
        cursor_y += layout.leading;
    }
}

#[allow(clippy::too_many_arguments)]
fn draw_text(
    font_id: u32,
    fallback_id: Option<u32>,
    primary: &FontData,
    fallback: Option<&FontData>,
    x: f32,
    y: f32,
    size: f32,
    max_width: f32,
    line_height: f32,
    align: u8,
    embolden: f32,
    glyph_scale: f32,
    fill: Color,
    text: &str,
    transform: Affine,
    scene: &mut Scene,
) {
    if text.is_empty() {
        return;
    }
    let cache_key = (font_id, fallback_id.unwrap_or(0), size.to_bits(), max_width.to_bits(), text_hash(text));
    let mut primary_glyphs: Vec<Glyph> = Vec::new();
    let mut fallback_glyphs: Vec<Glyph> = Vec::new();
    let mut done = false;
    TEXT_LAYOUT.with(|cell| {
        let mut map = cell.borrow_mut();
        // 命中：Copy 键 + 原文校验（防哈希碰撞），零分配、零字体解析
        if let Some(layout) = map.get(&cache_key) {
            if layout.text == text {
                emit_glyphs(layout, x, y, max_width, align, &mut primary_glyphs, &mut fallback_glyphs);
                done = true;
            }
        }
        if !done {
            // 简单有界：满则整体清空，避免无界增长
            if map.len() >= 1024 {
                map.clear();
            }
            if let Some(layout) = build_text_layout(primary, fallback, size, line_height, max_width, text) {
                emit_glyphs(&layout, x, y, max_width, align, &mut primary_glyphs, &mut fallback_glyphs);
                map.insert(cache_key, layout);
            }
        }
    });

    // 合成加粗（em 比例 → px）：让无粗体字重的标题接近 semibold 观感
    let embolden = if embolden > 0.0 {
        Some(FontEmbolden::new(Diagonal2::new((size * embolden) as f64, (size * embolden) as f64)))
    } else {
        None
    };
    // run 级附加缩放：屏幕恒定文本用 font_size=屏幕 ppem（轮廓高精度）再乘 1/scale 抵消视口缩放
    let run_transform = if (glyph_scale - 1.0).abs() > 1e-6 { transform * Affine::scale(glyph_scale as f64) } else { transform };
    if !primary_glyphs.is_empty() {
        let run = scene.draw_glyphs(primary).font_size(size).transform(run_transform);
        let run = if let Some(embolden) = embolden { run.font_embolden(embolden) } else { run };
        run.brush(&Brush::Solid(fill)).draw(Fill::NonZero, primary_glyphs.into_iter());
    }
    if let Some(font) = fallback {
        if !fallback_glyphs.is_empty() {
            let run = scene.draw_glyphs(font).font_size(size).transform(run_transform);
            let run = if let Some(embolden) = embolden { run.font_embolden(embolden) } else { run };
            run.brush(&Brush::Solid(fill)).draw(Fill::NonZero, fallback_glyphs.into_iter());
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
            b.extend_from_slice(&f32b(0.035)); // embolden (em ratio)
            b.extend_from_slice(&f32b(1.0)); // glyph_scale
            let text = "Entity 1".as_bytes();
            b.extend_from_slice(&(text.len() as u32).to_le_bytes());
            b.extend_from_slice(text);
        });
        let ops = decode_ops(&bytes).expect("decode");
        match &ops[0] {
            DrawOp::Text { font_id, x, y, size, align, embolden, glyph_scale, fill, text, .. } => {
                assert_eq!(*font_id, 7);
                assert_eq!((*x, *y, *size, *align), (3.0, 4.0, 16.0, 1));
                assert_eq!(*embolden, 0.035);
                assert_eq!(*glyph_scale, 1.0);
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
