import React from "react";
import { useWindowDimensions } from "react-native";
import {
    Canvas,
    Fill,
    Vertices,
    useClock,
} from "@shopify/react-native-skia";
import { useDerivedValue } from "react-native-reanimated";

const COLS = 4;
const ROWS = 4;

const SEG = 32;

const SMOOTH = true;
const BACKGROUND = "#000000";

const BASE: number[] = [
    0.0, 0.0, 0.333, 0.0, 0.667, 0.0, 1.0, 0.0,
    0.0, 0.333, 0.333, 0.333, 0.667, 0.333, 1.0, 0.333,
    0.0, 0.667, 0.333, 0.667, 0.667, 0.667, 1.0, 0.667,
    0.0, 1.0, 0.333, 1.0, 0.667, 1.0, 1.0, 1.0,
];

const GRID_COLORS: string[] = [
    "#141415", "#ABAEB5", "#6C6E75", "#2E3034",
    "#696B74", "#2B2C32", "#C8C9CD", "#828694",
    "#C5C7CC", "#83868E", "#44464E", "#E4E4E6",
    "#42444C", "#E1E2E4", "#9C9FAA", "#5E6069",
];

const FREEDOM: number[] = [
    0.0, 0.0, 1.0, 0.0, 1.0, 0.0, 0.0, 0.0,
    0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.0, 1.0,
    0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.0, 1.0,
    0.0, 0.0, 1.0, 0.0, 1.0, 0.0, 0.0, 0.0,
];

const LIMITS: number[] = [
    0.142, 0.142, 0.142, 0.142, 0.142, 0.142, 0.142, 0.142,
    0.142, 0.142, 0.142, 0.142, 0.142, 0.142, 0.142, 0.142,
    0.142, 0.142, 0.142, 0.142, 0.142, 0.142, 0.142, 0.142,
    0.142, 0.142, 0.142, 0.142, 0.142, 0.142, 0.142, 0.142,
];

const SPEED = 1.0;
const DRIFT = 0.35;

function cr(p0: number, p1: number, p2: number, p3: number, t: number): number {
    "worklet";
    const t2 = t * t;
    const t3 = t2 * t;
    return 0.5 * (2 * p1 + (-p0 + p2) * t
        + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
        + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

function slot(r: number, c: number): number {
    "worklet";
    const rr = r < 0 ? 0 : r > ROWS - 1 ? ROWS - 1 : r;
    const cc = c < 0 ? 0 : c > COLS - 1 ? COLS - 1 : c;
    return rr * COLS + cc;
}

function surface(pts: number[], ix: number, iy: number, w: number, h: number) {
    "worklet";
    const fu = (ix / SEG) * (COLS - 1);
    const fv = (iy / SEG) * (ROWS - 1);
    const ci = Math.min(Math.max(Math.floor(fu), 0), COLS - 2);
    const ri = Math.min(Math.max(Math.floor(fv), 0), ROWS - 2);
    const tu = Math.min(Math.max(fu - ci, 0), 1);
    const tv = Math.min(Math.max(fv - ri, 0), 1);
    const xs: number[] = [];
    const ys: number[] = [];
    for (let j = 0; j < 4; j++) {
        const r = ri - 1 + j;
        const i0 = slot(r, ci - 1) * 2;
        const i1 = slot(r, ci) * 2;
        const i2 = slot(r, ci + 1) * 2;
        const i3 = slot(r, ci + 2) * 2;
        xs.push(cr(pts[i0], pts[i1], pts[i2], pts[i3], tu));
        ys.push(cr(pts[i0 + 1], pts[i1 + 1], pts[i2 + 1], pts[i3 + 1], tu));
    }
    return {
        x: cr(xs[0], xs[1], xs[2], xs[3], tv) * w,
        y: cr(ys[0], ys[1], ys[2], ys[3], tv) * h,
    };
}

function tessellate(pts: number[], w: number, h: number) {
    "worklet";
    const out = [];
    for (let iy = 0; iy <= SEG; iy++) {
        for (let ix = 0; ix <= SEG; ix++) {
            out.push(surface(pts, ix, iy, w, h));
        }
    }
    return out;
}

function pointsAt(t: number): number[] {
    "worklet";
    const s = t * SPEED;
    const out: number[] = [];
    for (let i = 0; i < BASE.length / 2; i++) {
        const ph = i * 2.39996323;
        const dx = 0.6 * Math.sin(0.9 * s + ph) + 0.4 * Math.sin(1.37 * s + ph * 1.7);
        const dy = 0.6 * Math.cos(1.13 * s + ph * 1.3) + 0.4 * Math.cos(0.71 * s + ph * 2.1);
        const x = BASE[i * 2] + FREEDOM[i * 2] * DRIFT * LIMITS[i * 2] * dx;
        const y = BASE[i * 2 + 1] + FREEDOM[i * 2 + 1] * DRIFT * LIMITS[i * 2 + 1] * dy;
        out.push(x < 0 ? 0 : x > 1 ? 1 : x, y < 0 ? 0 : y > 1 ? 1 : y);
    }
    return out;
}

function hexToRgb(hex: string): [number, number, number] {
    const raw = hex.replace("#", "");
    const comp = (i: number) => (parseInt(raw.slice(i, i + 2), 16) || 0) / 255;
    return [comp(0), comp(2), comp(4)];
}

function rgbToHex(r: number, g: number, b: number): string {
    const h = (v: number) =>
        Math.round(Math.min(255, Math.max(0, v * 255))).toString(16).padStart(2, "0");
    return `#${h(r)}${h(g)}${h(b)}`;
}

function channelAt(rgb: number[], k: number, ix: number, iy: number): number {
    const fu = (ix / SEG) * (COLS - 1);
    const fv = (iy / SEG) * (ROWS - 1);
    const ci = Math.min(Math.max(Math.floor(fu), 0), COLS - 2);
    const ri = Math.min(Math.max(Math.floor(fv), 0), ROWS - 2);
    const tu = Math.min(Math.max(fu - ci, 0), 1);
    const tv = Math.min(Math.max(fv - ri, 0), 1);
    if (!SMOOTH) {
        const at = (r: number, c: number) => rgb[slot(r, c) * 3 + k];
        const top = at(ri, ci) + (at(ri, ci + 1) - at(ri, ci)) * tu;
        const bot = at(ri + 1, ci) + (at(ri + 1, ci + 1) - at(ri + 1, ci)) * tu;
        return top + (bot - top) * tv;
    }
    const rows: number[] = [];
    for (let j = 0; j < 4; j++) {
        const r = ri - 1 + j;
        rows.push(cr(
            rgb[slot(r, ci - 1) * 3 + k],
            rgb[slot(r, ci) * 3 + k],
            rgb[slot(r, ci + 1) * 3 + k],
            rgb[slot(r, ci + 2) * 3 + k],
            tu,
        ));
    }
    return cr(rows[0], rows[1], rows[2], rows[3], tv);
}

function buildColors(): string[] {
    const rgb: number[] = [];
    for (const hex of GRID_COLORS) rgb.push(...hexToRgb(hex));
    const out: string[] = [];
    for (let iy = 0; iy <= SEG; iy++) {
        for (let ix = 0; ix <= SEG; ix++) {
            out.push(rgbToHex(
                channelAt(rgb, 0, ix, iy),
                channelAt(rgb, 1, ix, iy),
                channelAt(rgb, 2, ix, iy),
            ));
        }
    }
    return out;
}

function buildIndices(): number[] {
    const out: number[] = [];
    const stride = SEG + 1;
    for (let y = 0; y < SEG; y++) {
        for (let x = 0; x < SEG; x++) {
            const i = y * stride + x;
            out.push(i, i + 1, i + stride, i + 1, i + stride + 1, i + stride);
        }
    }
    return out;
}

const VERTEX_COLORS = buildColors();
const INDICES = buildIndices();

export default function MeshView() {
    const { width, height } = useWindowDimensions();
    const clock = useClock();
    const vertices = useDerivedValue(() =>
        tessellate(pointsAt(clock.value / 1000), width, height));

    return (
        <Canvas style={{ flex: 1 }}>
            <Fill color={BACKGROUND} />
            <Vertices vertices={vertices} colors={VERTEX_COLORS} indices={INDICES} />
        </Canvas>
    );
}
