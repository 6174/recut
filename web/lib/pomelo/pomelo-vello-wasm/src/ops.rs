//! 绘制 op 解码与 vello Scene 构建。
//!
//! JS 侧（`web/lib/pomelo/pomelo-vello/op-bridge.ts`）把每个 chunk 的绘制编码成
//! 小端字节流；本模块解码为 `DrawOp` 并构建 `vello::Scene`。格式固定、无 serde 依赖。
//!
//! 字节布局（小端）：
//! ```text
//! 每条 op（顺序记录，无总数头，便于拼接）:
//!   u8 kind
//!   kind=1 ROUND_RECT:   f32 x,y,w,h,radius; u8[4] fill; u8[4] stroke; f32 stroke_width
//!   kind=2 QUAD_STROKE:  f32 p0x,p0y,cpx,cpy,p1x,p1y; u8[4] stroke; f32 stroke_width
//!   kind=3 TRIANGLE_FILL: f32 x0,y0,x1,y1,x2,y2; u8[4] fill
//!   kind=4 RECT_FILL:    f32 x,y,w,h; u8[4] fill
//! ```
use vello::kurbo::{Affine, BezPath, Rect, RoundedRect, Stroke};
use vello::peniko::{Brush, Color, Fill};
use vello::Scene;

pub const KIND_ROUND_RECT: u8 = 1;
pub const KIND_QUAD_STROKE: u8 = 2;
pub const KIND_TRIANGLE_FILL: u8 = 3;
pub const KIND_RECT_FILL: u8 = 4;

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
pub fn build_scene(ops: &[DrawOp], transform: Affine, clip_size: f32, scene: &mut Scene) {
    scene.push_clip_layer(Fill::NonZero, Affine::IDENTITY, &Rect::new(0.0, 0.0, clip_size as f64, clip_size as f64));
    for op in ops {
        match op {
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
        }
    }
    scene.pop_layer();
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
    fn decode_mixed_and_build_scene() {
        let bytes = enc(|b| {
            // quad stroke
            b.push(KIND_QUAD_STROKE);
            for v in [0.0f32, 0.0, 50.0, -40.0, 100.0, 0.0] {
                b.extend_from_slice(&f32b(v));
            }
            b.extend_from_slice(&[139, 147, 167, 255]);
            b.extend_from_slice(&f32b(2.0));
            // triangle fill
            b.push(KIND_TRIANGLE_FILL);
            for v in [100.0f32, 0.0, 90.0, 10.0, 110.0, 10.0] {
                b.extend_from_slice(&f32b(v));
            }
            b.extend_from_slice(&[139, 147, 167, 255]);
            // rect fill
            b.push(KIND_RECT_FILL);
            for v in [0.0f32, 3200.0, 1400.0, 700.0] {
                b.extend_from_slice(&f32b(v));
            }
            b.extend_from_slice(&[34, 197, 94, 255]);
        });
        let ops = decode_ops(&bytes).expect("decode");
        assert_eq!(ops.len(), 3);
        let transform = tile_transform(1.0, 0.0, 0.0, 2.0);
        assert_eq!(transform, Affine::translate((2.0, 2.0)) * Affine::scale(1.0));
        let mut scene = Scene::new();
        build_scene(&ops, transform, 260.0, &mut scene);
        // Scene 是编码命令流；构建成功即代表 op → 绘制命令路径可用
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
