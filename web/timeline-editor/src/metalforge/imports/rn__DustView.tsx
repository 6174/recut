import { useMemo, useState } from "react";
import { View, type LayoutChangeEvent, type ViewStyle } from "react-native";
import {
    Canvas,
    Circle,
    Fill,
    Path,
    RadialGradient,
    Rect,
    Skia,
    useClock,
    vec,
} from "@shopify/react-native-skia";
import { useDerivedValue } from "react-native-reanimated";

const STYLE = 0;
const RINGS = 46;
const SHELLS = 1;
const SEGMENTS = 130;
const TWIST = 7.0;
const SQUASH = 0.25;
const SPEED = 1.0;
const SIZE = 1.0;
const DASH = 1.0;
const BRIGHTNESS = 1.0;
const GLOW = 0.0;
const VIGNETTE = 0.5;
const LOOP = 12.0;

const TIERS = [
    { width: 0.65, color: "rgba(236, 240, 246, 0.16)" },
    { width: 0.95, color: "rgba(236, 240, 246, 0.42)" },
    { width: 1.4, color: "rgba(236, 240, 246, 0.92)" },
];
const BACKGROUND = "#000000";
const GLOW_TINT = [255, 255, 255];
const VIGNETTE_TINT = [0, 0, 0];

const TABLE_LEN = 3600;

function dustTable() {
  "worklet";
  let a = 5150607 | 0;
  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const out = new Float64Array(TABLE_LEN * 4);
  for (let i = 0; i < TABLE_LEN; i++) {
    out[i * 4] = next();
    out[i * 4 + 1] = next();
    next(); next(); next();
    out[i * 4 + 2] = next();
  }
  return out;
}

function dustDashes(P, w, h, ph) {
  "worklet";
  const out = [];
  const cx = w * 0.5;
  const cy = h * 0.47;
  const radius = Math.min(w * 0.62, h * 0.3) * SIZE;
  const seg = SEGMENTS;
  const sq = SQUASH;

  const push = (x, y, dx, dy, al) => {
    "worklet";
    if (al < 0.05) return;
    out.push(x, y, dx, dy, al > 0.62 ? 2 : al > 0.28 ? 1 : 0);
  };

  if (STYLE === 0) {
    for (let j = 0; j < RINGS; j++) {
      const fj = j / (RINGS - 1);
      const ringR = radius * (0.95 + 0.35 * Math.sin(fj * 5 - ph));
      if (ringR <= 0.5) continue;
      const ry = h * 0.06 + fj * h * 0.88;
      const tw = fj * TWIST + ph;
      const band = 0.5 + 0.5 * Math.sin(fj * 9 - ph * 2);
      const amp = 0.35 + 0.85 * band;
      for (let k = 0; k < seg; k++) {
        const p = ((j * seg + k * 7 + j) % TABLE_LEN) * 4;
        const a = (k / seg) * Math.PI * 2 + tw;
        const sa = Math.sin(a);
        const ca = Math.cos(a);
        const rr = ringR * (1 + (P[p] - 0.5) * 0.05);
        const x = cx + ca * rr;
        const y = ry + sa * rr * sq + (P[p + 1] - 0.5) * 3.2;
        if (x < -30 || x > w + 30 || y < -30 || y > h + 30) continue;
        const front = 0.4 + 0.6 * (0.5 + 0.5 * sa);
        const al = (0.06 + 0.9 * P[p + 2]) * front * amp * BRIGHTNESS;
        const len = (1.1 + 2.6 * P[p + 1]) * DASH;
        push(x, y, -sa * len, ca * len * (sq + 0.35), al);
      }
    }
    return out;
  }

  for (let sh = 0; sh < SHELLS; sh++) {
    const pulse = 1 + 0.12 * Math.sin(ph * 2 - sh * 1.1);
    const RS = radius * (0.42 + 0.33 * sh) * pulse;
    for (let j = 0; j < RINGS; j++) {
      const th = ((j + 0.5) / RINGS) * Math.PI;
      const rr = Math.sin(th) * RS;
      const yy = -Math.cos(th) * RS;
      for (let k = 0; k < seg; k++) {
        const p = ((sh * 1500 + j * 100 + k * 3) % TABLE_LEN) * 4;
        const a = (k / seg) * Math.PI * 2 + ph * (1 + sh);
        const sa = Math.sin(a);
        const ca = Math.cos(a);
        const x = cx + ca * rr;
        const y = cy + yy * 0.92 + sa * rr * sq;
        const front = 0.4 + 0.6 * (0.5 + 0.5 * sa);
        const al = (0.05 + 0.8 * P[p + 2]) * front * (1 - sh * 0.13) * BRIGHTNESS;
        push(x, y, -sa * 2.2 * DASH, ca * 0.8 * DASH, al);
      }
    }
  }
  return out;
}
const TABLE = dustTable();

export type DustViewProps = {
    style?: ViewStyle;
};

export default function DustView({ style }: DustViewProps) {
    const [size, setSize] = useState({ w: 0, h: 0 });
    const onLayout = (e: LayoutChangeEvent) => {
        const { width, height } = e.nativeEvent.layout;
        setSize((s) => (s.w === width && s.h === height ? s : { w: width, h: height }));
    };

    const clock = useClock();
    const { w, h } = size;

    const cx = w * 0.5;
    const cy = h * 0.47;
    const radius = Math.min(w * 0.62, h * 0.3) * SIZE;
    const diagonal = Math.sqrt(w * w + h * h);

    const paths = useDerivedValue(() => {
        "worklet";
        const empty = Skia.PathBuilder.Make().build();
        if (w < 1 || h < 1) return [empty, empty, empty];

        let t = ((clock.value / 1000) * SPEED) % LOOP;
        if (t < 0) t += LOOP;
        const d = dustDashes(TABLE, w, h, (Math.PI * 2 * t) / LOOP);

        const builders = [
            Skia.PathBuilder.Make(),
            Skia.PathBuilder.Make(),
            Skia.PathBuilder.Make(),
        ];
        for (let i = 0; i < d.length; i += 5) {
            const b = builders[d[i + 4]];
            b.moveTo(d[i], d[i + 1]);
            b.lineTo(d[i] + d[i + 2], d[i + 1] + d[i + 3]);
        }
        return [builders[0].build(), builders[1].build(), builders[2].build()];
    });
    const tier0 = useDerivedValue(() => paths.value[0]);
    const tier1 = useDerivedValue(() => paths.value[1]);
    const tier2 = useDerivedValue(() => paths.value[2]);

    return (
        <View style={[{ flex: 1, backgroundColor: BACKGROUND }, style]} onLayout={onLayout}>
            <Canvas style={{ flex: 1 }}>
                <Fill color={BACKGROUND} />
                {[tier0, tier1, tier2].map((path, i) => (
                    <Path
                        key={i}
                        path={path}
                        style="stroke"
                        strokeWidth={TIERS[i].width}
                        strokeCap="round"
                        color={TIERS[i].color}
                        blendMode="plus"
                    />
                ))}
                {
}
                <Rect x={0} y={0} width={w} height={h}>
                    <RadialGradient
                        c={vec(cx, cy)}
                        r={diagonal * 0.66}
                        positions={[0.4545, 1]}
                        colors={[
                            `rgba(${VIGNETTE_TINT[0]}, ${VIGNETTE_TINT[1]}, ${VIGNETTE_TINT[2]}, 0)`,
                            `rgba(${VIGNETTE_TINT[0]}, ${VIGNETTE_TINT[1]}, ${VIGNETTE_TINT[2]}, ${VIGNETTE})`,
                        ]}
                    />
                </Rect>
            </Canvas>
        </View>
    );
}
