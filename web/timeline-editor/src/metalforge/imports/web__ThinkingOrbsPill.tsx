"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

const WGSL = `struct Uniforms {
  canvasAndOrigin: vec4f,
  scale: vec4f,
};

struct Dot {
  geom: vec4f,
  color: vec4f,
};

@group(0) @binding(0) var<uniform> U: Uniforms;
@group(0) @binding(1) var<storage, read> dots: array<Dot>;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) offset: vec2f,
  @location(1) radius: f32,
  @location(2) color: vec4f,
  @location(3) covScale: f32,
};

fn coverageScale(r: f32) -> f32 {
  let a = r - 0.5;
  let b = r + 0.5;
  let core = a * a * (0.5 - r) + (b * b * b + 2.0 * a * a * a) / 3.0;
  let sub = (b * b * b) / 3.0;
  let integral = select(core, sub, r < 0.5);
  return (r * r) / max(integral, 1e-6);
}

@vertex
fn orb_vertex(
  @builtin(vertex_index) vi: u32,
  @builtin(instance_index) ii: u32,
) -> VSOut {
  let d = dots[ii];
  let canvas = U.canvasAndOrigin.xy;
  let origin = U.canvasAndOrigin.zw;
  let dpr = U.scale.x;

  let centre = origin + d.geom.xy * dpr;
  let radius = d.geom.z * dpr;
  let half = radius + 1.0;

  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  );
  let offset = corners[vi] * half;
  let device = centre + offset;

  var out: VSOut;
  out.pos = vec4f(
    (device.x / canvas.x) * 2.0 - 1.0,
    1.0 - (device.y / canvas.y) * 2.0,
    0.0,
    1.0,
  );
  out.offset = offset;
  out.radius = radius;
  out.color = vec4f(d.color.rgb, d.geom.w);
  out.covScale = coverageScale(radius);
  return out;
}

@fragment
fn orb_fragment(in: VSOut) -> @location(0) vec4f {
  let dist = length(in.offset);
  let coverage = min(1.0, clamp(in.radius - dist + 0.5, 0.0, 1.0) * in.covScale);
  let a = coverage * in.color.a;
  return vec4f(in.color.rgb * a, a);
}`;

const LOOP_INDEX = 0;
const LOOP_ID = "breathe";
const PERIOD = 3.6;
const LABEL = "Thinking...";
const SPEED = 1.0;
const REVERSE = false;
const START_AT = 0.0;
const DOT_SCALE = 1.0;
const SHOWS_PILL = true;
const SHOWS_LABEL = true;
const ACCENT_COLOR = "#E8853C";

const SCHEME = "auto";
const INK_DARK = { dot: "#F4F1EA", pill: "#1B1B1D", label: "#F4F1EA" };
const INK_LIGHT = { dot: "#25242A", pill: "#ECECEF", label: "#25242A" };

const KNOBS = {
    n: 1.0,
    sp: 1.0,
    pv: 1.0,
    dz: 1.0,
    df: 1.0,
    yw: 0.0,
    pc: 0.0,
    sn: 0.0,
    op: 1.0,
};

const BALL = 46.0;
const GAP = 9.0;
const PAD_TOP = 7.0;
const PAD_RIGHT = 22.0;
const PAD_BOTTOM = 7.0;
const PAD_LEFT = 8.0;
const FONT_SIZE = 14.0;
const LABEL_OPACITY = 0.74;
const FONT = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

const DOT_COL = '#F4F1EA'
const ACC_COL = '#E8853C'

const specs13 = (() => {
  const NC = (c: any, n: any) => { const v = Math.round(c * n); return v < 1 ? 1 : v };
  const VIEW = (p: any, K: any) => {
    const ay = K.yw + Math.PI * 2 * K.sn * K.t, ca = Math.cos(ay), sa = Math.sin(ay);
    const X = p[0] * ca - p[2] * sa; let Z = p[0] * sa + p[2] * ca;
    const cb = Math.cos(K.pc), sb = Math.sin(K.pc);
    const Y = p[1] * cb - Z * sb; Z = p[1] * sb + Z * cb;
    return [X, Y, Z, p[3], p[4], p[5]];
  };
  const TAU = Math.PI * 2, HP = Math.PI / 2;
  const cl = (u: any) => u < 0 ? 0 : u > 1 ? 1 : u;
  const ease = (u: any) => u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
  const bump = (u: any) => 0.5 - 0.5 * Math.cos(TAU * cl(u));
  const h1 = (i: any) => (i * 0.61803398875) % 1, h2 = (i: any) => (i * 0.7548776662) % 1, h3 = (i: any) => (i * 0.5698402909) % 1;
  const rot = (p: any, ay: any, ax: any) => {
    const ca = Math.cos(ay), sa = Math.sin(ay);
    const X = p[0] * ca - p[2] * sa; let Z = p[0] * sa + p[2] * ca;
    const cb = Math.cos(ax), sb = Math.sin(ax);
    const Y = p[1] * cb - Z * sb; Z = p[1] * sb + Z * cb;
    return [X, Y, Z, p[3], p[4], p[5]];
  };
  const P3 = (pts: any, c: any, S2: any, K: any, RF: any) => {
    const cx = S2 / 2, cy = S2 / 2, R = (S2 * (RF || 0.3)) * K.sp, f = 3.5 * K.pv, out: any[] = [];
    for (const p0 of pts) {
      const p = VIEW(p0, K);
      const z = p[2], per = f / (f - z), d = cl((z + 1.1) / 2.2);
      out.push([cx + p[0] * R * per, cy + p[1] * R * per, K.ds * (0.4 + 1.6 * K.dz * d) * per * (p[3] === undefined ? 1 : p[3]), (0.07 + 0.93 * Math.pow(d, 1.55 * K.df)) * (p[4] === undefined ? 1 : p[4]), p[5] || K.dot, z]);
    }
    out.sort((a: any, b: any) => a[5] - b[5]);
    for (const o of out) K.d(c, o[0], o[1], o[2], o[3], o[4]);
  };
  const fib = (i: any, N: any) => { const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(Math.max(0, 1 - y * y)), th = i * 2.399963; return [Math.cos(th) * r, y, Math.sin(th) * r]; };
  const sph = (p: any) => [Math.acos(Math.max(-1, Math.min(1, p[1]))), Math.atan2(p[2], p[0])];
  const SP = (name: any, label: any, period: any, motion: any, desc: any, draw: any) => ({ name: name, label: label, period: period, dots: 150, motion: motion, desc: desc, draw: draw });
  return {
    0: function (c: any, t: any, S2: any, K: any) { const pts: any[] = []; for (let i = 0; i < NC(150, K.n); i++) { const p = fib(i, NC(150, K.n)), m = 1 + 0.13 * Math.sin(TAU * (t - 0.22 * (p[1] + 1))); pts.push(rot([p[0] * m, p[1] * m, p[2] * m, 0.85, 0.9], TAU * t, 0.36)); } P3(pts, c, S2, K, 0.3); },
    1: function (c: any, t: any, S2: any, K: any) { const pts: any[] = []; for (let b = 0; b < 11; b++) { const lat = (b / 10) * Math.PI, y = Math.cos(lat), r = Math.sin(lat), n = Math.max(1, Math.round(NC(16, K.n) * r)), d = b % 2 ? 1 : -1; for (let i = 0; i < n; i++) { const th = (i / n) * TAU + d * TAU * t; pts.push(rot([Math.cos(th) * r, y, Math.sin(th) * r, 0.85, 1], 0, 0.4)); } } P3(pts, c, S2, K, 0.3); },
    2: function (c: any, t: any, S2: any, K: any) { const pts: any[] = []; for (let i = 0; i < NC(150, K.n); i++) { const p = fib(i, NC(150, K.n)), b = Math.pow(0.5 + 0.5 * Math.sin(TAU * (2 * t + h1(i))), 6); pts.push(rot([p[0], p[1], p[2], 0.55 + 1.5 * b, 0.2 + 0.8 * b], TAU * t, 0.36)); } P3(pts, c, S2, K, 0.3); },
    3: function (c: any, t: any, S2: any, K: any) { const pts: any[] = []; for (let i = 0; i < NC(150, K.n); i++) { const u = ((h1(i) + t) % 1), pol = Math.PI * u, r = Math.sin(pol), az = h2(i) * TAU + TAU * 2 * t, f = Math.pow(Math.sin(Math.PI * u), 0.4); pts.push(rot([Math.cos(az) * r, Math.cos(pol), Math.sin(az) * r, 0.8, f], -TAU * t, 0.36)); } P3(pts, c, S2, K, 0.3); },
    4: function (c: any, t: any, S2: any, K: any) { const pts: any[] = [], A = TAU * t, B = 0.9 * Math.sin(TAU * t), ax = [Math.cos(A) * Math.cos(B), Math.sin(B), Math.sin(A) * Math.cos(B)]; for (let i = 0; i < NC(150, K.n); i++) { const p = fib(i, NC(150, K.n)), d = Math.abs(p[0] * ax[0] + p[1] * ax[1] + p[2] * ax[2]), b = Math.exp(-Math.pow(d * 5, 2)); pts.push(rot([p[0], p[1], p[2], 0.5 + 1.5 * b, 0.22 + 0.78 * b, b > 0.7 ? K.acc : K.dot], 0, 0.36)); } P3(pts, c, S2, K, 0.3); },
    5: function (c: any, t: any, S2: any, K: any) { const pts: any[] = []; for (let i = 0; i < NC(150, K.n); i++) { const p = fib(i, NC(150, K.n)), j = Math.pow(bump(((t + h1(i)) % 1) / 0.22), 2), m = 1 + 0.3 * j; pts.push(rot([p[0] * m, p[1] * m, p[2] * m, 0.8 + 0.9 * j, 0.55 + 0.45 * j, j > 0.6 ? K.acc : K.dot], TAU * t, 0.36)); } P3(pts, c, S2, K, 0.28); },
    6: function (c: any, t: any, S2: any, K: any) { const pts: any[] = [], m = bump(t); for (let i = 0; i < NC(150, K.n); i++) { const p = fib(i, NC(150, K.n)), s = sph(p), pp = s[0] + (HP - s[0]) * m, r = Math.sin(pp); pts.push(rot([Math.cos(s[1]) * r, Math.cos(pp), Math.sin(s[1]) * r, 0.8 + 0.5 * m, 0.9], TAU * t, 0.4)); } P3(pts, c, S2, K, 0.3); },
    7: function (c: any, t: any, S2: any, K: any) { const pts: any[] = [], w = 0.5 - 0.5 * Math.cos(TAU * t); for (let i = 0; i < NC(90, K.n); i++) { const p = rot(fib(i, NC(90, K.n)), TAU * t, 0.36), s = 1 - 0.22 * w; pts.push([p[0] * s, p[1] * s, p[2] * s, 0.85, 0.85]); } for (let i = 0; i < NC(60, K.n); i++) { const p = rot(fib(i, NC(60, K.n)), -TAU * t, 0.36), s = 0.45 + 0.3 * w; pts.push([p[0] * s, p[1] * s, p[2] * s, 0.9, 1, K.acc]); } P3(pts, c, S2, K, 0.3); },
    8: function (c: any, t: any, S2: any, K: any) { const pts: any[] = [], g = 0.28 * Math.sin(TAU * t); for (let i = 0; i < NC(150, K.n); i++) { const p = fib(i, NC(150, K.n)), k = 1 - p[1] * p[1]; pts.push(rot([p[0], p[1] - g * k, p[2], 0.85, 0.9], TAU * t, 0.36)); } P3(pts, c, S2, K, 0.3); },
    9: function (c: any, t: any, S2: any, K: any) { const pts: any[] = [], A = TAU * t, ax = [Math.cos(A), 0.25, Math.sin(A)]; for (let i = 0; i < NC(150, K.n); i++) { const p = fib(i, NC(150, K.n)), d = p[0] * ax[0] + p[1] * ax[1] + p[2] * ax[2], lit = cl((d + 0.1) * 3), edge = Math.exp(-Math.pow(d * 6, 2)); pts.push(rot([p[0], p[1], p[2], 0.55 + 0.8 * lit + 1.1 * edge, 0.14 + 0.7 * lit + 0.3 * edge, edge > 0.65 ? K.acc : K.dot], 0, 0.36)); } P3(pts, c, S2, K, 0.3); },
    12: function (c: any, t: any, S2: any, K: any) { const pts: any[] = []; for (let i = 0; i < NC(160, K.n); i++) { const p = fib(i, NC(160, K.n)), s = sph(p), a = Math.sin(4 * s[1] + 6 * s[0] - TAU * 2 * t), b = Math.sin(4 * s[1] - 6 * s[0] + TAU * 2 * t), w = cl((a * b + 1) / 2); pts.push(rot([p[0], p[1], p[2], 0.5 + 1.3 * w, 0.2 + 0.8 * w, w > 0.9 ? K.acc : K.dot], TAU * t, 0.36)); } P3(pts, c, S2, K, 0.3); },
    13: function (c: any, t: any, S2: any, K: any) { const pts: any[] = [], k = 0.62 * bump(t); for (let i = 0; i < NC(150, K.n); i++) { const p = fib(i, NC(150, K.n)), s = 1 - k * (1 - p[1] * p[1]), yy = p[1] * (1 + 0.28 * k); pts.push(rot([p[0] * s, yy, p[2] * s, 0.85, 0.9], TAU * t, 0.36)); } P3(pts, c, S2, K, 0.28); },
    14: function (c: any, t: any, S2: any, K: any) { const pts: any[] = []; for (let i = 0; i < NC(150, K.n); i++) { const p = fib(i, NC(150, K.n)), lag = 0.55 * Math.sin(TAU * t - 0.5 * (p[1] + 1)), ca = Math.cos(lag), sa = Math.sin(lag); pts.push(rot([p[0] * ca - p[1] * sa, p[0] * sa + p[1] * ca, p[2], 0.85, 0.9], TAU * t, 0.34)); } P3(pts, c, S2, K, 0.3); },
    15: function (c: any, t: any, S2: any, K: any) { const pts: any[] = [], sp = Math.abs(Math.sin(Math.PI * t)); for (let i = 0; i < NC(150, K.n); i++) { const p = fib(i, NC(150, K.n)); pts.push(rot([p[0], p[1], p[2], 0.8 + 1.1 * sp * (1 - Math.abs(p[1])), 0.95 - 0.35 * sp], TAU * 2 * ease(t), 0.36)); } P3(pts, c, S2, K, 0.3); },
    17: function (c: any, t: any, S2: any, K: any) { const pts: any[] = [], A = TAU * t, B = 0.75 * Math.sin(TAU * 2 * t), d0 = [Math.cos(A) * Math.cos(B), Math.sin(B), Math.sin(A) * Math.cos(B)]; for (let i = 0; i < NC(150, K.n); i++) { const p = fib(i, NC(150, K.n)), dp = p[0] * d0[0] + p[1] * d0[1] + p[2] * d0[2], b = Math.pow(cl((dp + 0.2) / 1.2), 6); pts.push(rot([p[0], p[1], p[2], 0.55 + 1.6 * b, 0.25 + 0.75 * b, b > 0.72 ? K.acc : K.dot], 0, 0.36)); } P3(pts, c, S2, K, 0.3); },
    19: function (c: any, t: any, S2: any, K: any) { const pts: any[] = []; for (let i = 0; i < NC(150, K.n); i++) { const p = fib(i, NC(150, K.n)), s = sph(p), n = 0.5 * Math.sin(3 * s[1] + 2 * s[0] + TAU * t) + 0.5 * Math.sin(2 * s[1] - 3 * s[0] - TAU * 2 * t), m = 1 + 0.15 * n; pts.push(rot([p[0] * m, p[1] * m, p[2] * m, 0.7 + 0.6 * (n + 1) / 2, 0.55 + 0.45 * (n + 1) / 2], TAU * t, 0.36)); } P3(pts, c, S2, K, 0.29); },
  }
})()

const specs3d = (() => {
  const NC = (c: any, n: any) => { const v = Math.round(c * n); return v < 1 ? 1 : v };
  const VIEW = (p: any, K: any) => {
    const ay = K.yw + Math.PI * 2 * K.sn * K.t, ca = Math.cos(ay), sa = Math.sin(ay);
    const X = p[0] * ca - p[2] * sa; let Z = p[0] * sa + p[2] * ca;
    const cb = Math.cos(K.pc), sb = Math.sin(K.pc);
    const Y = p[1] * cb - Z * sb; Z = p[1] * sb + Z * cb;
    return [X, Y, Z, p[3], p[4], p[5]];
  };
  const TAU = Math.PI * 2;
  const rot = (p: any, ay: any, ax: any) => {
    const ca = Math.cos(ay), sa = Math.sin(ay);
    const X = p[0] * ca - p[2] * sa; let Z = p[0] * sa + p[2] * ca;
    const cb = Math.cos(ax), sb = Math.sin(ax);
    const Y = p[1] * cb - Z * sb; Z = p[1] * sb + Z * cb;
    return [X, Y, Z, p[3], p[4], p[5]];
  };
  const fib = (i: any, N: any) => { const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(Math.max(0, 1 - y * y)), th = i * 2.399963; return [Math.cos(th) * r, y, Math.sin(th) * r]; };
  const P3 = (pts: any, c: any, S: any, K: any, RF: any) => {
    const cx = S / 2, cy = S / 2, R = (S * (RF || 0.30)) * K.sp, f = 3.4 * K.pv, out: any[] = [];
    for (const p0 of pts) {
      const p = VIEW(p0, K);
      const z = p[2], per = f / (f - z), d = (z + 1) / 2;
      out.push([cx + p[0] * R * per, cy + p[1] * R * per, K.ds * (0.4 + 1.6 * K.dz * d) * per * (p[3] === undefined ? 1 : p[3]), (0.06 + 0.94 * Math.pow(d, 1.6 * K.df)) * (p[4] === undefined ? 1 : p[4]), p[5] || K.dot, z]);
    }
    out.sort((a: any, b: any) => a[5 + 1] - b[5 + 1]);
    for (const o of out) K.d(c, o[0], o[1], o[2], o[3], o[4]);
  };
  return {
    1: function (c: any, t: any, S: any, K: any) {
              const pts: any[] = [];
              for (let i = 0; i < NC(100, K.n); i++) { const p = fib(i, NC(100, K.n)); pts.push(rot([p[0], p[1], p[2], 0.85, 0.85], TAU * t, 0.3)); }
              for (let i = 0; i < NC(46, K.n); i++) { const p = fib(i, NC(46, K.n)); pts.push(rot([p[0] * 0.5, p[1] * 0.5, p[2] * 0.5, 1.15, 1, K.acc], -TAU * t * 2, -0.5)); }
              P3(pts, c, S, K, 0.30);
            },
  }
})()

const specs7 = (() => {
  const NC = (c: any, n: any) => { const v = Math.round(c * n); return v < 1 ? 1 : v };
  const VIEW = (p: any, K: any) => {
    const ay = K.yw + Math.PI * 2 * K.sn * K.t, ca = Math.cos(ay), sa = Math.sin(ay);
    const X = p[0] * ca - p[2] * sa; let Z = p[0] * sa + p[2] * ca;
    const cb = Math.cos(K.pc), sb = Math.sin(K.pc);
    const Y = p[1] * cb - Z * sb; Z = p[1] * sb + Z * cb;
    return [X, Y, Z, p[3], p[4], p[5]];
  };
  const TAU = Math.PI * 2;
  const rot = (p: any, ay: any, ax: any) => {
    const ca = Math.cos(ay), sa = Math.sin(ay);
    const X = p[0] * ca - p[2] * sa; let Z = p[0] * sa + p[2] * ca;
    const cb = Math.cos(ax), sb = Math.sin(ax);
    const Y = p[1] * cb - Z * sb; Z = p[1] * sb + Z * cb;
    return [X, Y, Z, p[3], p[4], p[5]];
  };
  const P3 = (pts: any, c: any, S: any, K: any, RF: any) => {
    const cx = S / 2, cy = S / 2, R = (S * (RF || 0.30)) * K.sp, f = 3.5 * K.pv, out: any[] = [];
    for (const p0 of pts) {
      const p = VIEW(p0, K);
      const z = p[2], per = f / (f - z), d = Math.max(0, Math.min(1, (z + 1.1) / 2.2));
      out.push([cx + p[0] * R * per, cy + p[1] * R * per, K.ds * (0.4 + 1.6 * K.dz * d) * per * (p[3] === undefined ? 1 : p[3]), (0.07 + 0.93 * Math.pow(d, 1.55 * K.df)) * (p[4] === undefined ? 1 : p[4]), p[5] || K.dot, z]);
    }
    out.sort((a: any, b: any) => a[6] - b[6]);
    for (const o of out) K.d(c, o[0], o[1], o[2], o[3], o[4]);
  };
  const fib = (i: any, N: any) => { const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(Math.max(0, 1 - y * y)), th = i * 2.399963; return [Math.cos(th) * r, y, Math.sin(th) * r]; };
  return {
    5: function (c: any, t: any, S: any, K: any) {
              const pts: any[] = [], N = NC(120, K.n);
              for (let i = 0; i < N; i++) {
                const seed = (i * 0.61803398875) % 1, u = (t + seed) % 1, e = Math.min(1, u / 0.72);
                const rr = 1 - Math.pow(2, -9 * e) * Math.cos(e * Math.PI * 4.5), p = fib(i, N);
                const a = Math.pow(Math.sin(Math.PI * u), 0.5);
                pts.push(rot([p[0] * rr, p[1] * rr, p[2] * rr, 0.5 + 1.3 * (1 - u), a, u < 0.12 ? K.acc : K.dot], TAU * t * 0.25, 0.35));
              }
              P3(pts, c, S, K, 0.29);
            },
  }
})()

const specs9 = (() => {
  const NC = (c: any, n: any) => { const v = Math.round(c * n); return v < 1 ? 1 : v };
  const VIEW = (p: any, K: any) => {
    const ay = K.yw + Math.PI * 2 * K.sn * K.t, ca = Math.cos(ay), sa = Math.sin(ay);
    const X = p[0] * ca - p[2] * sa; let Z = p[0] * sa + p[2] * ca;
    const cb = Math.cos(K.pc), sb = Math.sin(K.pc);
    const Y = p[1] * cb - Z * sb; Z = p[1] * sb + Z * cb;
    return [X, Y, Z, p[3], p[4], p[5]];
  };
  const TAU = Math.PI * 2, HP = Math.PI / 2;
  const cl = (u: any) => u < 0 ? 0 : u > 1 ? 1 : u;
  const ease = (u: any) => u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
  const step = (t: any, s: any, d: any) => ease(cl((t - s) / d));
  const rot = (p: any, ay: any, ax: any) => {
    const ca = Math.cos(ay), sa = Math.sin(ay);
    const X = p[0] * ca - p[2] * sa; let Z = p[0] * sa + p[2] * ca;
    const cb = Math.cos(ax), sb = Math.sin(ax);
    const Y = p[1] * cb - Z * sb; Z = p[1] * sb + Z * cb;
    return [X, Y, Z, p[3], p[4], p[5]];
  };
  const P3 = (pts: any, c: any, S: any, K: any, RF: any) => {
    const cx = S / 2, cy = S / 2, R = (S * (RF || 0.30)) * K.sp, f = 3.5 * K.pv, out: any[] = [];
    for (const p0 of pts) {
      const p = VIEW(p0, K);
      const z = p[2], per = f / (f - z), d = cl((z + 1.1) / 2.2);
      out.push([cx + p[0] * R * per, cy + p[1] * R * per, K.ds * (0.4 + 1.6 * K.dz * d) * per * (p[3] === undefined ? 1 : p[3]), (0.07 + 0.93 * Math.pow(d, 1.55 * K.df)) * (p[4] === undefined ? 1 : p[4]), p[5] || K.dot, z]);
    }
    out.sort((a: any, b: any) => a[5] - b[5]);
    for (const o of out) K.d(c, o[0], o[1], o[2], o[3], o[4]);
  };
  const fib = (i: any, N: any) => { const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(Math.max(0, 1 - y * y)), th = i * 2.399963; return [Math.cos(th) * r, y, Math.sin(th) * r]; };
  return {
    3: function (c: any, t: any, S: any, K: any) {
              const pts: any[] = [], N = NC(170, K.n);
              for (let i = 0; i < N; i++) {
                const p = fib(i, N), pol = Math.acos(Math.max(-1, Math.min(1, p[1])));
                let b = 0;
                for (const k of [-1, 0, 1]) b = Math.max(b, Math.exp(-Math.pow((pol - Math.PI * (t + k)) * 3.4, 2)));
                const m = 1 + 0.15 * b;
                pts.push(rot([p[0] * m, p[1] * m, p[2] * m, 0.6 + 1.5 * b, 0.32 + 0.68 * b, b > 0.6 ? K.acc : K.dot], TAU * t, 0.36));
              }
              P3(pts, c, S, K, 0.29);
            },
  }
})()

const specs10 = (() => {
  const NC = (c: any, n: any) => { const v = Math.round(c * n); return v < 1 ? 1 : v };
  const NC3 = (c: any, n: any) => { const v = Math.round(c * Math.pow(n, 1 / 3)); return v < 1 ? 1 : v };
  const VIEW = (p: any, K: any) => {
    const ay = K.yw + Math.PI * 2 * K.sn * K.t, ca = Math.cos(ay), sa = Math.sin(ay);
    const X = p[0] * ca - p[2] * sa; let Z = p[0] * sa + p[2] * ca;
    const cb = Math.cos(K.pc), sb = Math.sin(K.pc);
    const Y = p[1] * cb - Z * sb; Z = p[1] * sb + Z * cb;
    return [X, Y, Z, p[3], p[4], p[5]];
  };
  const TAU = Math.PI * 2, HP = Math.PI / 2;
  const cl = (u: any) => u < 0 ? 0 : u > 1 ? 1 : u;
  const ease = (u: any) => u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
  const step = (t: any, s: any, d: any) => ease(cl((t - s) / d));
  const bump = (u: any) => u <= 0 || u >= 1 ? 0 : 0.5 - 0.5 * Math.cos(TAU * u);
  const rot = (p: any, ay: any, ax: any) => {
    const ca = Math.cos(ay), sa = Math.sin(ay);
    const X = p[0] * ca - p[2] * sa; let Z = p[0] * sa + p[2] * ca;
    const cb = Math.cos(ax), sb = Math.sin(ax);
    const Y = p[1] * cb - Z * sb; Z = p[1] * sb + Z * cb;
    return [X, Y, Z, p[3], p[4], p[5]];
  };
  const rz = (p: any, a: any) => [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a), p[2], p[3], p[4], p[5]];
  const P3 = (pts: any, c: any, S: any, K: any, RF: any) => {
    const cx = S / 2, cy = S / 2, R = (S * (RF || 0.30)) * K.sp, f = 3.5 * K.pv, out: any[] = [];
    for (const p0 of pts) {
      const p = VIEW(p0, K);
      const z = p[2], per = f / (f - z), d = cl((z + 1.1) / 2.2);
      out.push([cx + p[0] * R * per, cy + p[1] * R * per, K.ds * (0.4 + 1.6 * K.dz * d) * per * (p[3] === undefined ? 1 : p[3]), (0.07 + 0.93 * Math.pow(d, 1.55 * K.df)) * (p[4] === undefined ? 1 : p[4]), p[5] || K.dot, z]);
    }
    out.sort((a: any, b: any) => a[5] - b[5]);
    for (const o of out) K.d(c, o[0], o[1], o[2], o[3], o[4]);
  };
  const fib = (i: any, N: any) => { const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(Math.max(0, 1 - y * y)), th = i * 2.399963; return [Math.cos(th) * r, y, Math.sin(th) * r]; };
  const sph = (p: any) => [Math.acos(Math.max(-1, Math.min(1, p[1]))), Math.atan2(p[2], p[0])];
  return {
    7: function (c: any, t: any, S: any, K: any) {
              const pts: any[] = [], N = NC(150, K.n), T = 2 + 6 * (0.5 - 0.5 * Math.cos(TAU * t));
              for (let i = 0; i < N; i++) {
                const u = ((i / N) + t) % 1, pol = Math.PI * u, r = Math.sin(pol);
                const az = u * TAU * T + TAU * t, f = Math.pow(Math.sin(Math.PI * u), 0.45);
                pts.push(rot([Math.cos(az) * r, Math.cos(pol), Math.sin(az) * r, 0.6 + 0.9 * f, f, i % 15 === 0 ? K.acc : K.dot], 0.3, 0.36));
              }
              P3(pts, c, S, K, 0.30);
            },
    9: function (c: any, t: any, S: any, K: any) {
              const pts: any[] = [], m = 0.5 - 0.5 * Math.cos(TAU * t);
              for (let ix = -NC3(2, K.n); ix <= NC3(2, K.n); ix++) for (let iy = -NC3(2, K.n); iy <= NC3(2, K.n); iy++) for (let iz = -NC3(2, K.n); iz <= NC3(2, K.n); iz++) {
                const g = [ix / NC3(2, K.n) * 0.62, iy / NC3(2, K.n) * 0.62, iz / NC3(2, K.n) * 0.62], L = Math.hypot(g[0], g[1], g[2]);
                const s = L < 1e-6 ? g : [g[0] / L, g[1] / L, g[2] / L];
                const corner = Math.abs(ix) === NC3(2, K.n) && Math.abs(iy) === NC3(2, K.n) && Math.abs(iz) === NC3(2, K.n);
                pts.push(rot([g[0] + (s[0] - g[0]) * m, g[1] + (s[1] - g[1]) * m, g[2] + (s[2] - g[2]) * m, corner ? 1.3 : 0.8, 0.9, corner ? K.acc : K.dot], TAU * t, 0.42));
              }
              P3(pts, c, S, K, 0.28);
            },
    13: function (c: any, t: any, S: any, K: any) {
              const pts: any[] = [];
              for (let k = 0; k < 3; k++) {
                const rad = [1.0, 0.78, 0.56][k];
                for (let i = 0; i < NC(40, K.n); i++) {
                  const th = (i / NC(40, K.n)) * TAU;
                  const p = rot(rot([Math.cos(th) * rad, Math.sin(th) * rad, 0, 0.8, 0.9, k === 1 ? K.acc : K.dot], 0, (k + 1) * TAU * t), k * 1.05, 0.3);
                  pts.push(p);
                }
              }
              for (let i = 0; i < NC(38, K.n); i++) { const p = rot(fib(i, NC(38, K.n)), -2 * TAU * t, 0.4); pts.push([p[0] * 0.3, p[1] * 0.3, p[2] * 0.3, 0.85, 0.9, K.dot]); }
              P3(pts, c, S, K, 0.29);
            },
    15: function (c: any, t: any, S: any, K: any) {
              const pts: any[] = [];
              for (const s of [1, -1]) for (let i = 0; i < NC(75, K.n); i++) {
                const u = ((i / NC(75, K.n)) + t) % 1, pol = HP * (1 - s * u * 0.96), r = Math.sin(pol);
                const az = i * 2.399963 + u * TAU * 4 * s, f = Math.pow(Math.sin(Math.PI * u), 0.5);
                pts.push(rot([Math.cos(az) * r, Math.cos(pol), Math.sin(az) * r, 0.6 + 1.0 * u, f, u > 0.86 ? K.acc : K.dot], 0, 0.38));
              }
              P3(pts, c, S, K, 0.31);
            },
    17: function (c: any, t: any, S: any, K: any) {
              const pts: any[] = [], N = NC(165, K.n);
              for (let i = 0; i < N; i++) {
                const p = fib(i, N), [pol, az] = sph(p);
                const m = 1 + 0.2 * Math.cos(2 * (az - TAU * t)) * Math.pow(Math.sin(pol), 2);
                pts.push(rot([p[0] * m, p[1] * m, p[2] * m, 0.55 + 1.1 * (m - 0.8), 0.5 + 0.5 * (m - 0.8), m > 1.14 ? K.acc : K.dot], 0, 0.38 + 0.15 * Math.sin(TAU * t)));
              }
              P3(pts, c, S, K, 0.29);
            },
  }
})()

const specs14 = (() => {
  const NC = (c: any, n: any) => { const v = Math.round(c * n); return v < 1 ? 1 : v };
  const VIEW = (p: any, K: any) => {
    const ay = K.yw + Math.PI * 2 * K.sn * K.t, ca = Math.cos(ay), sa = Math.sin(ay);
    const X = p[0] * ca - p[2] * sa; let Z = p[0] * sa + p[2] * ca;
    const cb = Math.cos(K.pc), sb = Math.sin(K.pc);
    const Y = p[1] * cb - Z * sb; Z = p[1] * sb + Z * cb;
    return [X, Y, Z, p[3], p[4], p[5]];
  };
  const TAU = Math.PI * 2, HP = Math.PI / 2;
  const cl = (u: any) => u < 0 ? 0 : u > 1 ? 1 : u;
  const ease = (u: any) => u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
  const bump = (u: any) => 0.5 - 0.5 * Math.cos(TAU * cl(u));
  const h1 = (i: any) => (i * 0.61803398875) % 1, h2 = (i: any) => (i * 0.7548776662) % 1, h3 = (i: any) => (i * 0.5698402909) % 1;
  const rot = (p: any, ay: any, ax: any) => {
    const ca = Math.cos(ay), sa = Math.sin(ay);
    const X = p[0] * ca - p[2] * sa; let Z = p[0] * sa + p[2] * ca;
    const cb = Math.cos(ax), sb = Math.sin(ax);
    const Y = p[1] * cb - Z * sb; Z = p[1] * sb + Z * cb;
    return [X, Y, Z, p[3], p[4], p[5]];
  };
  const rzz = (p: any, a: any) => [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a), p[2], p[3], p[4], p[5]];
  const rxx = (p: any, a: any) => [p[0], p[1] * Math.cos(a) - p[2] * Math.sin(a), p[1] * Math.sin(a) + p[2] * Math.cos(a), p[3], p[4], p[5]];
  const P3 = (pts: any, c: any, S2: any, K: any, RF: any) => {
    const cx = S2 / 2, cy = S2 / 2, R = (S2 * (RF || 0.3)) * K.sp, f = 3.5 * K.pv, out: any[] = [];
    for (const p0 of pts) {
      const p = VIEW(p0, K);
      const z = p[2], per = f / (f - z), d = cl((z + 1.1) / 2.2);
      out.push([cx + p[0] * R * per, cy + p[1] * R * per, K.ds * (0.4 + 1.6 * K.dz * d) * per * (p[3] === undefined ? 1 : p[3]), (0.07 + 0.93 * Math.pow(d, 1.55 * K.df)) * (p[4] === undefined ? 1 : p[4]), p[5] || K.dot, z]);
    }
    out.sort((a: any, b: any) => a[5] - b[5]);
    for (const o of out) K.d(c, o[0], o[1], o[2], o[3], o[4]);
  };
  const fib = (i: any, N: any) => { const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(Math.max(0, 1 - y * y)), th = i * 2.399963; return [Math.cos(th) * r, y, Math.sin(th) * r]; };
  const sph = (p: any) => [Math.acos(Math.max(-1, Math.min(1, p[1]))), Math.atan2(p[2], p[0])];
  const SP = (name: any, label: any, period: any, motion: any, desc: any, draw: any) => ({ name: name, label: label, period: period, dots: 150, motion: motion, desc: desc, draw: draw });
  return {
    0: function (c: any, t: any, S2: any, K: any) { const pts: any[] = [], m = bump(t); for (let i = 0; i < NC(150, K.n); i++) { const p = fib(i, NC(150, K.n)), mx = Math.max(Math.abs(p[0]), Math.abs(p[1]), Math.abs(p[2])), k = 1 / Math.max(1e-4, mx), s = 1 + (k - 1) * m * 0.62; pts.push(rot([p[0] * s, p[1] * s, p[2] * s, 0.85, 0.9], TAU * t, 0.42)); } P3(pts, c, S2, K, 0.26); },
    2: function (c: any, t: any, S2: any, K: any) { const pts: any[] = [], q = t * 12, fr = q - Math.floor(q), az = (TAU / 12) * (Math.floor(q) + ease(cl(fr / 0.45)) - 0.14 * Math.sin(Math.PI * cl((fr - 0.45) / 0.55))); for (let b = 0; b < 11; b++) { const lat = (b / 10) * Math.PI, y = Math.cos(lat), r = Math.sin(lat), n = Math.max(1, Math.round(NC(15, K.n) * r)); for (let i = 0; i < n; i++) { const th = (i / n) * TAU + az; pts.push(rot([Math.cos(th) * r, y, Math.sin(th) * r, i === 0 ? 1.5 : 0.85, 1, i === 0 ? K.acc : K.dot], 0, 0.4)); } } P3(pts, c, S2, K, 0.3); },
    3: function (c: any, t: any, S2: any, K: any) { const pts: any[] = [], m = bump(t); for (let i = 0; i < NC(150, K.n); i++) { const p = fib(i, NC(150, K.n)), u = (1 + p[1]) / 2, k = 1 + Math.floor(3 * (1 - u)), s = 1 - m * 0.75 * (1 - u), r0 = Math.sqrt(Math.max(0, 1 - p[1] * p[1])), az = Math.atan2(p[2], p[0]) + TAU * t * k; pts.push(rot([Math.cos(az) * r0 * s, p[1], Math.sin(az) * r0 * s, 0.85, 0.9], 0, 0.36)); } P3(pts, c, S2, K, 0.3); },
    4: function (c: any, t: any, S2: any, K: any) { const pts: any[] = [], m = bump(t), A = TAU * t, ax = [Math.cos(A), 0.2, Math.sin(A)]; for (let i = 0; i < NC(150, K.n); i++) { const p = fib(i, NC(150, K.n)), sg = (p[0] * ax[0] + p[1] * ax[1] + p[2] * ax[2]) >= 0 ? 1 : -1; const q = [p[0] + (sg * ax[0] - p[0]) * m * 0.8, p[1] + (sg * ax[1] - p[1]) * m * 0.8, p[2] + (sg * ax[2] - p[2]) * m * 0.8]; const L = Math.max(1e-4, Math.hypot(q[0], q[1], q[2])); pts.push(rot([q[0] / L, q[1] / L, q[2] / L, 0.8 + 0.5 * m, 0.9, m > 0.75 ? K.acc : K.dot], 0, 0.36)); } P3(pts, c, S2, K, 0.3); },
    5: function (c: any, t: any, S2: any, K: any) { const pts: any[] = []; for (let k = 0; k < 4; k++) { const b = Math.pow(0.5 + 0.5 * Math.cos(TAU * (t - k / 4)), 6), s = 0.34 + k * 0.22; for (let i = 0; i < NC(40, K.n); i++) { const p = rot(fib(i, NC(40, K.n)), TAU * t * (k % 2 ? 1 : -1), 0.36); pts.push([p[0] * s, p[1] * s, p[2] * s, 0.6 + 1.5 * b, 0.2 + 0.8 * b, b > 0.7 ? K.acc : K.dot]); } } P3(pts, c, S2, K, 0.3); },
    7: function (c: any, t: any, S2: any, K: any) { const pts: any[] = []; for (let s = 0; s < 4; s++) for (let i = 0; i < NC(40, K.n); i++) { const u = ((i / NC(40, K.n)) + t) % 1, pol = Math.PI * u + (s - 1.5) * 0.1, r = Math.sin(cl(pol / Math.PI) * Math.PI), az = u * TAU * 2 + TAU * t, f = Math.pow(Math.sin(Math.PI * u), 0.4); pts.push(rot([Math.cos(az) * r, Math.cos(pol), Math.sin(az) * r, 0.7 + 0.7 * f, f, s === 0 ? K.acc : K.dot], 0, 0.36)); } P3(pts, c, S2, K, 0.3); },
    8: function (c: any, t: any, S2: any, K: any) { const pts: any[] = []; for (let i = 0; i < NC(150, K.n); i++) { const a = h1(i) * TAU, d = 0.94 * Math.sqrt(h2(i)), lim = Math.sqrt(Math.max(0, 1 - d * d)), u = (h3(i) + t) % 1, y = lim - 2 * lim * u; pts.push(rot([Math.cos(a) * d, y, Math.sin(a) * d, 0.8, 0.35 + 0.6 * Math.sin(Math.PI * u)], TAU * t, 0.34)); } P3(pts, c, S2, K, 0.3); },
    9: function (c: any, t: any, S2: any, K: any) { const pts: any[] = [], target = Math.PI * (0.5 - 0.5 * Math.cos(TAU * t)); for (let i = 0; i < NC(150, K.n); i++) { const p = fib(i, NC(150, K.n)), ang = Math.acos(cl((p[0] + 1) / 2) * 2 - 1), b = Math.exp(-Math.pow((ang - target) * 3.4, 2)); pts.push(rot([p[0], p[1], p[2], 0.5 + 1.5 * b, 0.2 + 0.8 * b, b > 0.7 ? K.acc : K.dot], TAU * t, 0.36)); } P3(pts, c, S2, K, 0.3); },
    11: function (c: any, t: any, S2: any, K: any) { const pts: any[] = []; for (let i = 0; i < NC(160, K.n); i++) { const p = fib(i, NC(160, K.n)), s = sph(p), ph = ((s[1] / TAU) + 1.4 * (s[0] / Math.PI) - t) % 1, d = Math.min(Math.abs(((ph % 0.5) + 0.5) % 0.5), 0.5 - Math.abs(((ph % 0.5) + 0.5) % 0.5)), b = Math.exp(-Math.pow(d * 14, 2)); pts.push(rot([p[0], p[1], p[2], 0.5 + 1.4 * b, 0.2 + 0.8 * b, b > 0.75 ? K.acc : K.dot], 0, 0.36)); } P3(pts, c, S2, K, 0.3); },
    12: function (c: any, t: any, S2: any, K: any) { const pts: any[] = [], m = bump(t); let gi = 0; const grid: any[] = []; for (let b = 0; b < 11; b++) { const lat = (b / 10) * Math.PI, y = Math.cos(lat), r = Math.sin(lat), n = Math.max(1, Math.round(NC(15, K.n) * r)); for (let i = 0; i < n; i++) { const th = (i / n) * TAU; grid.push([Math.cos(th) * r, y, Math.sin(th) * r]); } } for (let i = 0; i < grid.length; i++) { const g = grid[i], p = fib(i % NC(150, K.n), NC(150, K.n)); pts.push(rot([p[0] + (g[0] - p[0]) * m, p[1] + (g[1] - p[1]) * m, p[2] + (g[2] - p[2]) * m, 0.8 + 0.4 * m, 0.9], TAU * t, 0.4)); } P3(pts, c, S2, K, 0.3); },
    13: function (c: any, t: any, S2: any, K: any) { const pts: any[] = [], w = TAU * bump(t) * 0.55, st = TAU * t * 2; for (let i = 0; i < NC(160, K.n); i++) { const p = fib(i, NC(160, K.n)), az = Math.atan2(p[2], p[0]), rel = (((az - st) % TAU) + TAU) % TAU, hid = rel < w; if (hid && rel > 0.12) continue; const edge = hid ? 1 : Math.exp(-Math.pow((rel - w) * 5, 2)); pts.push(rot([p[0], p[1], p[2], 0.8 + 1.1 * edge, 0.9, edge > 0.6 ? K.acc : K.dot], 0, 0.36)); } P3(pts, c, S2, K, 0.3); },
    14: function (c: any, t: any, S2: any, K: any) { const pts: any[] = []; const u = (t * 2) % 1, air = Math.abs(Math.sin(Math.PI * u)), hit = Math.pow(1 - air, 3), sy = 1 - 0.32 * hit, sx = 1 + 0.22 * hit, dy = 0.34 * (1 - air); for (let i = 0; i < NC(150, K.n); i++) { const p = fib(i, NC(150, K.n)); pts.push(rot([p[0] * sx, p[1] * sy + dy, p[2] * sx, 0.85, 0.9], TAU * t, 0.36)); } P3(pts, c, S2, K, 0.27); },
    15: function (c: any, t: any, S2: any, K: any) { const pts: any[] = [], st = t * 3, k = Math.floor(st), f = ease(cl(st - k)); for (let i = 0; i < NC(150, K.n); i++) { let p = fib(i, NC(150, K.n)).concat([0.85, 0.9]); if (k === 0) p = rot(p, TAU * f, 0); else if (k === 1) p = rxx(p, TAU * f); else p = rzz(p, TAU * f); pts.push(rot(p, 0, 0.36)); } P3(pts, c, S2, K, 0.3); },
    18: function (c: any, t: any, S2: any, K: any) { const pts: any[] = [], N = NC(150, K.n), head = t * N; for (let i = 0; i < N; i++) { const p = fib(i, N), d = ((head - i) % N + N) % N, b = Math.exp(-d / 14); pts.push(rot([p[0], p[1], p[2], 0.5 + 1.6 * b, 0.18 + 0.82 * b, b > 0.7 ? K.acc : K.dot], TAU * t, 0.36)); } P3(pts, c, S2, K, 0.3); },
  }
})()

const DRAWS = [
  specs13[0],
  specs13[1],
  specs13[2],
  specs13[3],
  specs13[4],
  specs13[5],
  specs13[6],
  specs13[7],
  specs13[8],
  specs13[9],
  specs13[12],
  specs13[13],
  specs13[14],
  specs13[15],
  specs13[17],
  specs13[19],
  specs3d[1],
  specs7[5],
  specs9[3],
  specs10[7],
  specs10[9],
  specs10[13],
  specs10[15],
  specs10[17],
  specs14[0],
  specs14[2],
  specs14[3],
  specs14[4],
  specs14[5],
  specs14[7],
  specs14[8],
  specs14[9],
  specs14[11],
  specs14[12],
  specs14[13],
  specs14[14],
  specs14[15],
  specs14[18],
]

const ORB_STYLES = [
  { id: "breathe", name: "Breathe", label: "Thinking...", period: 3.6, dots: 150, motion: "3D · peristaltic swell", desc: "The whole shell inflates and deflates, but each latitude lags the one above it, so the swell travels down the ball like a slow breath." },
  { id: "rings", name: "Rings", label: "Solving...", period: 4.2, dots: 150, motion: "3D · alternating latitudes", desc: "Eleven latitude rings, each turning against the one beside it, so neighbouring rows continually shear past each other." },
  { id: "twinkle", name: "Twinkle", label: "Listening...", period: 4.6, dots: 150, motion: "3D · random blink", desc: "A steady turning ball whose dots blink on private clocks, so the surface is always half-lit and never repeats within a turn." },
  { id: "vortex", name: "Vortex", label: "Working...", period: 4.4, dots: 150, motion: "3D · surface drain", desc: "Every dot slides along its meridian toward the north pole, fading out at the top and re-entering at the bottom, while the ball spins the other way." },
  { id: "band", name: "Band", label: "Searching...", period: 5.2, dots: 150, motion: "3D · precessing belt", desc: "One bright great-circle belt around a dim ball; the belt keeps its width while its axis tips and swings all the way around." },
  { id: "popcorn", name: "Popcorn", label: "Computing...", period: 4, dots: 150, motion: "3D · staggered jumps", desc: "Dots kick out along their own normals one at a time in a scattered order, each falling back before the next goes." },
  { id: "converge", name: "Converge", label: "Reasoning...", period: 4.8, dots: 150, motion: "3D · to the equator", desc: "All dots slide down their meridians into a single dense equatorial ring, hold, and spread back over the sphere." },
  { id: "nest", name: "Nest", label: "Reading...", period: 5, dots: 150, motion: "3D · counter shells", desc: "Two shells, one inside the other, turning opposite ways and trading size — the inner swelling as the outer contracts." },
  { id: "sag", name: "Sag", label: "Loading...", period: 3.8, dots: 150, motion: "3D · weight shift", desc: "The shell hangs heavier on one side and swings its mass slowly under itself, dots crowding wherever the weight settles." },
  { id: "terminator", name: "Terminator", label: "Scanning...", period: 4.4, dots: 150, motion: "3D · day and night", desc: "A lit hemisphere and a dark one, divided by a bright edge that travels once around the ball." },
  { id: "stripes", name: "Stripes", label: "Weaving...", period: 4.6, dots: 150, motion: "3D · crossed spirals", desc: "Two spiral families run opposite ways over a still shell; where they cross, dots brighten, so a moving plaid slides across the surface." },
  { id: "pinch", name: "Pinch", label: "Compressing...", period: 4.2, dots: 150, motion: "3D · dumbbell", desc: "The waist is squeezed until the ball becomes two lobes joined at a neck, then it fills back out to a sphere." },
  { id: "rock", name: "Rock", label: "Balancing...", period: 4, dots: 150, motion: "3D · inertial tilt", desc: "The ball rocks side to side and its lower dots lag behind the upper ones, so the shell twists slightly on every swing." },
  { id: "spinup", name: "Spinup", label: "Accelerating...", period: 4.4, dots: 150, motion: "3D · blur & snap", desc: "Two full turns squeezed into the middle of the loop: dots stretch and dim at speed, then settle sharp at rest." },
  { id: "spot", name: "Spot", label: "Tracking...", period: 4.8, dots: 150, motion: "3D · roaming light", desc: "A bright patch wanders the surface on a looping path, dragging a short fading trail of lit dots behind it." },
  { id: "noise", name: "Noise", label: "Tuning...", period: 5.4, dots: 150, motion: "3D · rolling surface", desc: "Two slow noise waves ride the shell at once, so the surface swells and dips unpredictably without ever leaving the sphere behind." },
  { id: "nested", name: "Nested", label: "Processing...", period: 4.8, dots: 146, motion: "3D · counter-spin", desc: "Two concentric shells turning against each other on different axes. The parallax between them is what sells the volume — no shading required." },
  { id: "burst", name: "Burst", label: "Generating...", period: 3.2, dots: 120, motion: "3D · elastic", desc: "Dots fire out from the centre on an elastic curve, overshoot the shell, settle, and fade. Staggered phases keep the burst continuous." },
  { id: "wave", name: "Wave", label: "Streaming...", period: 3.8, dots: 170, motion: "3D · pole to pole", desc: "A single crest travels over the surface from the north pole off the south, the next one entering as the last leaves. Dots lift along their own normals as it passes." },
  { id: "coil", name: "Coil", label: "Winding...", period: 6, dots: 150, motion: "3D · wind & relax", desc: "One strand of dots runs pole to pole while its winding tightens from two turns to eight and relaxes again — the flow and the coiling breathe on independent clocks." },
  { id: "grid", name: "Grid", label: "Mapping...", period: 5, dots: 125, motion: "3D · lattice morph", desc: "A five-by-five-by-five lattice blows outward onto its enclosing sphere and settles back into rows, corners marked, the whole structure turning as it trades order for curvature." },
  { id: "gyro", name: "Gyro", label: "Aligning...", period: 6.2, dots: 158, motion: "3D · gimbal + core", desc: "Three rings tumble about their own diameters at one, two and three turns per loop around a small counter-spinning core ball — four independent rotations that all close together." },
  { id: "drain", name: "Drain", label: "Filtering...", period: 4.8, dots: 150, motion: "3D · twin vortices", desc: "Two mirrored streams spiral out of the equator, one draining into each pole, tightening as they go. The ball is fed and emptied at the same time, forever." },
  { id: "tide", name: "Tide", label: "Syncing...", period: 4.6, dots: 165, motion: "3D · rotating bulge", desc: "A two-lobed tidal bulge sweeps around the equator while the spin axis itself nods — the ball is continuously re-shaped by something unseen orbiting it." },
  { id: "cube", name: "Cube", label: "Verifying...", period: 4.6, dots: 150, motion: "3D · sphere to cube", desc: "Every dot slides from the sphere onto the surface of a cube and back, so the ball grows six flat faces and loses them again." },
  { id: "ratchet", name: "Ratchet", label: "Refining...", period: 4.4, dots: 150, motion: "3D · snap & recoil", desc: "Twelve hard snaps per turn, each overshooting and kicking back a little, with one tooth marked so every click is countable." },
  { id: "funnel", name: "Funnel", label: "Checking...", period: 4.8, dots: 150, motion: "3D · conical spin", desc: "The lower half draws in to a point and spins three times for every one turn up top, so the ball tapers into a whirling cone." },
  { id: "magnet", name: "Magnet", label: "Merging...", period: 5.2, dots: 150, motion: "3D · bipolar pull", desc: "Two invisible poles pull the dots into a pair of tight clumps at opposite ends, then let the shell spring back to even." },
  { id: "layers", name: "Layers", label: "Sampling...", period: 4.8, dots: 150, motion: "3D · shell by shell", desc: "Four nested shells light up one after another from the core outward, each dimming as the next takes over." },
  { id: "ribbon", name: "Ribbon", label: "Routing...", period: 5.4, dots: 150, motion: "3D · winding band", desc: "A wide four-strand ribbon wraps the ball twice from pole to pole and slides along its own path without ever unwinding." },
  { id: "rain", name: "Rain", label: "Fetching...", period: 3.8, dots: 150, motion: "3D · falling through", desc: "Dots fall straight down through the inside of the ball, each on its own vertical line, entering at the top as others leave the bottom." },
  { id: "ping", name: "Ping", label: "Parsing...", period: 4.2, dots: 150, motion: "3D · out and back", desc: "A ring of light leaves one point, races over the surface to the far side, and comes straight back to where it started." },
  { id: "arms", name: "Arms", label: "Expanding...", period: 5, dots: 150, motion: "3D · spiral arms", desc: "Two bright spiral arms sweep over the shell like a galaxy seen from outside, dots lighting as an arm crosses them." },
  { id: "crystal", name: "Crystal", label: "Formatting...", period: 5.2, dots: 150, motion: "3D · order from chaos", desc: "A loose scatter of dots snaps into perfect latitude rows, holds its lattice, and dissolves back into disorder." },
  { id: "wedge", name: "Wedge", label: "Trimming...", period: 4.4, dots: 150, motion: "3D · sector eaten", desc: "A wedge opens from the axis and eats its way around the ball, the dots behind it reappearing as it goes." },
  { id: "bounce", name: "Bounce", label: "Retrying...", period: 3.6, dots: 150, motion: "3D · squash & rebound", desc: "The ball drops, flattens against an invisible floor, and springs back twice per loop, stretching as it rises." },
  { id: "gimbal", name: "Gimbal", label: "Adjusting...", period: 5.4, dots: 150, motion: "3D · three axes in turn", desc: "A full turn about the vertical axis, then one about the horizontal, then one in the picture plane — three rotations, taken strictly in sequence." },
  { id: "chase", name: "Chase", label: "Tracing...", period: 4.6, dots: 150, motion: "3D · lit trail", desc: "A bright head runs along the dots in spiral order, trailing a tail of still-glowing dots that fades behind it." },
]

const NOP = {
  globalAlpha: 1,
  fillStyle: '',
  beginPath() {},
  arc() {},
  fill() {},
  fillRect() {},
}

const ORB_KNOBS0 = { n: 1, sp: 1, pv: 1, dz: 1, df: 1, yw: 0, pc: 0, sn: 0, op: 1 }

const FIT_CACHE = new Map()

function fitFactor(style: any, S: any, Q: any) {
  const key = style + '@' + S + '@' + Q.n + '/' + Q.sp + '/' + Q.pv + '/' + Q.dz + '/' + Q.df + '/' + Q.yw + '/' + Q.pc + '/' + Q.sn
  const hit = FIT_CACHE.get(key)
  if (hit !== undefined) return hit
  const h = S / 2
  let ext = 0
  const probe = {
    ds: 1,
    dot: '#fff',
    acc: '#fff',
    n: Q.n,
    sp: Q.sp,
    pv: Q.pv,
    dz: Q.dz,
    df: Q.df,
    yw: Q.yw,
    pc: Q.pc,
    sn: Q.sn,
    t: 0,
    d: (_c: any, x: any, y: any, r: any, a: any) => {
      if (a <= 0.05 || r <= 0.15) return
      ext = Math.max(ext, Math.abs(x - h) + r * 0.5, Math.abs(y - h) + r * 0.5)
    },
  }
  const draw = DRAWS[style]
  for (let k = 0; k < 20; k++) {
    probe.t = k / 20
    try {
      draw(NOP, k / 20, S, probe)
    } catch {
      
    }
  }
  const f = ext > 1 ? Math.max(0.55, Math.min(1.7, (S * 0.415) / ext)) : 1
  FIT_CACHE.set(key, f)
  return f
}

function sizeDotScale(S: any) {
  if (S <= 46) return 0.4
  if (S <= 190) return 0.4 + ((S - 46) / 144) * 0.6
  if (S <= 340) return 1 + ((S - 190) / 150) * 0.55
  return 1.55
}

function orbDots(style: any, t01: any, S: any, dotScale: any, Q: any) {
  const q = Q || ORB_KNOBS0
  const out: any[] = []
  const f = fitFactor(style, S, q)
  const h = S / 2
  const K = {
    ds: dotScale,
    dot: DOT_COL,
    acc: ACC_COL,
    n: q.n,
    sp: q.sp,
    pv: q.pv,
    dz: q.dz,
    df: q.df,
    yw: q.yw,
    pc: q.pc,
    sn: q.sn,
    t: t01,
    d: (_c: any, x: any, y: any, r: any, a: any, col: any) => {
      const fx = h + (x - h) * f
      const fy = h + (y - h) * f
      const fr = r * (0.55 + 0.45 * f)
      const fa = a * q.op
      if (fr <= 0.05 || fa <= 0.004) return
      out.push({ x: fx, y: fy, r: fr, a: Math.min(1, fa), accent: col === ACC_COL })
    },
  }
  DRAWS[style](NOP, t01, S, K)
  return out
}

const G = (globalThis as any);
const SHADER_STAGE = G.GPUShaderStage;
const BUFFER_USAGE = G.GPUBufferUsage;

const MAX_DOTS = 1024;
const DOT_FLOATS = 8;
const MAX_DPR = 2;

function orbInk(hex : string) {
  const h = hex.replace("#", "");
  const s = h.length === 3 ? h.split("").map((c : string) => c + c).join("") : h;
  const n = parseInt(s, 16);
  if (!Number.isFinite(n)) return [1, 1, 1];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function orbPhase(period : number, speed : number, seconds : number, reverse ?: boolean, startAt ?: number) {
  const span = period / Math.max(0.0001, speed);
  let u = (Math.max(0, seconds) % span) / span;
  if (u < 0) u += 1;
  if (reverse) u = 1 - u;
  u = (u + (startAt === undefined ? 0 : startAt)) % 1;
  return u < 0 ? u + 1 : u;
}

function packDots(s : any, t01 : number, size : number, out : Float32Array, base ?: number, ox ?: number, oy ?: number) {
  const list = orbDots(s.index, t01, size, sizeDotScale(size) * s.dotScale, s.knobs);
  const n = Math.min(list.length, MAX_DOTS);
  const b = base === undefined ? 0 : base;
  const X = ox === undefined ? 0 : ox;
  const Y = oy === undefined ? 0 : oy;
  for (let i = 0; i < n; i++) {
    const d = list[i];
    const c = d.accent ? s.accent : s.dot;
    const o = (b + i) * DOT_FLOATS;
    out[o] = d.x + X; out[o + 1] = d.y + Y; out[o + 2] = d.r; out[o + 3] = d.a;
    out[o + 4] = c[0]; out[o + 5] = c[1]; out[o + 6] = c[2]; out[o + 7] = 0;
  }
  return n;
}

function start(canvas : HTMLCanvasElement, get : () => any, onError : (m: string) => void) {
  let raf = 0, stopped = false;
  let cleanup = () => {};
  const gpu = (navigator as any).gpu;
  if (!gpu) {
    onError("This browser doesn't support WebGPU. Try Chrome or Edge 113+, Safari 26+, or Firefox 141+ on Windows.");
    return () => {};
  }

  (async () => {
    const adapter = await gpu.requestAdapter();
    if (!adapter) { onError("No WebGPU adapter is available."); return; }
    const device = await adapter.requestDevice();
    if (stopped) { device.destroy && device.destroy(); return; }
    device.lost && device.lost.then(() => { stopped = true; if (raf) cancelAnimationFrame(raf); });

    const ctx = canvas.getContext("webgpu") as any;
    if (!ctx) { onError("This canvas can't provide a WebGPU context."); return; }
    const format = gpu.getPreferredCanvasFormat();
    ctx.configure({ device, format, alphaMode: "premultiplied" });

    const module = device.createShaderModule({ code: WGSL });
    const layout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: SHADER_STAGE.VERTEX | SHADER_STAGE.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 1, visibility: SHADER_STAGE.VERTEX, buffer: { type: "read-only-storage" } },
      ],
    });
    const pipeline = await device.createRenderPipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module, entryPoint: "orb_vertex" },
      fragment: {
        module,
        entryPoint: "orb_fragment",
        targets: [{
          format,
          blend: {
            color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
            alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
          },
        }],
      },
      primitive: { topology: "triangle-list" },
    });
    if (stopped) { device.destroy && device.destroy(); return; }

    const uniforms = new Float32Array(8);
    const ubo = device.createBuffer({ size: 32, usage: BUFFER_USAGE.UNIFORM | BUFFER_USAGE.COPY_DST });
    const dots = new Float32Array(MAX_DOTS * DOT_FLOATS);
    const dbo = device.createBuffer({
      size: MAX_DOTS * DOT_FLOATS * 4,
      usage: BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_DST,
    });
    const group = device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: { buffer: ubo } },
        { binding: 1, resource: { buffer: dbo } },
      ],
    });

    const t0 = performance.now();
    const frame = () => {
      if (stopped) return;
      raf = requestAnimationFrame(frame);
      const s = get();
      const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
      const rect = canvas.getBoundingClientRect();
      const dw = Math.max(1, Math.round(rect.width * dpr));
      const dh = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== dw || canvas.height !== dh) { canvas.width = dw; canvas.height = dh; }

      const box = Math.min(dw, dh);
      const count = packDots(s, orbPhase(s.period, s.speed, (performance.now() - t0) / 1000, s.reverse, s.startAt), box / dpr, dots);

      uniforms[0] = dw; uniforms[1] = dh;
      uniforms[2] = (dw - box) / 2; uniforms[3] = (dh - box) / 2;
      uniforms[4] = dpr;
      device.queue.writeBuffer(ubo, 0, uniforms);
      if (count > 0) device.queue.writeBuffer(dbo, 0, dots, 0, count * DOT_FLOATS);

      const enc = device.createCommandEncoder();
      const pass = enc.beginRenderPass({
        colorAttachments: [{
          view: ctx.getCurrentTexture().createView(),
          loadOp: "clear", storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        }],
      });
      if (count > 0) {
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, group);
        pass.draw(6, count);
      }
      pass.end();
      device.queue.submit([enc.finish()]);
    };

    cleanup = () => {
      ubo.destroy(); dbo.destroy();
      device.destroy && device.destroy();
    };
    frame();
  })();

  return () => { stopped = true; if (raf) cancelAnimationFrame(raf); cleanup(); };
}

function useOrbDark(scheme : string ) : boolean  {
    const [systemDark, setSystemDark] = useState(true);
    useEffect(() => {
        if (typeof window === "undefined" || !window.matchMedia) return;
        const mq = window.matchMedia("(prefers-color-scheme: dark)");
        const apply = () => setSystemDark(mq.matches);
        apply();
        mq.addEventListener("change", apply);
        return () => mq.removeEventListener("change", apply);
    }, []);
    return scheme === "auto" ? systemDark : scheme === "dark";
}

const STYLES = ORB_STYLES;

export type ThinkingOrbsPillProps = {
    label?: string;
    showsPill?: boolean;
    showsLabel?: boolean;
    speed?: number;
    reverse?: boolean;
    startAt?: number;
    dotScale?: number;
    dots?: number;
    spread?: number;
    perspective?: number;
    depthSize?: number;
    depthFade?: number;
    dotOpacity?: number;
    spin?: number;
    turn?: number;
    tilt?: number;
    scheme?: "auto" | "light" | "dark";
    accent?: string;
    dotColor?: string;
    pill?: string;
    labelColor?: string;
    dotColorLight?: string;
    pillLight?: string;
    labelColorLight?: string;
    className?: string;
    containerStyle?: CSSProperties;
};

export default function ThinkingOrbsPill({
    label,
    showsPill = SHOWS_PILL,
    showsLabel = SHOWS_LABEL,
    speed = SPEED,
    reverse = REVERSE,
    startAt = START_AT,
    dotScale = DOT_SCALE,
    dots = KNOBS.n,
    spread = KNOBS.sp,
    perspective = KNOBS.pv,
    depthSize = KNOBS.dz,
    depthFade = KNOBS.df,
    dotOpacity = KNOBS.op,
    spin = KNOBS.sn,
    turn = KNOBS.yw / (Math.PI / 180),
    tilt = KNOBS.pc / (Math.PI / 180),
    scheme = SCHEME,
    accent = ACCENT_COLOR,
    dotColor = INK_DARK.dot,
    pill: pillDark = INK_DARK.pill,
    labelColor = INK_DARK.label,
    dotColorLight = INK_LIGHT.dot,
    pillLight = INK_LIGHT.pill,
    labelColorLight = INK_LIGHT.label,
    className,
    containerStyle,
}: ThinkingOrbsPillProps) {
    const isDark = useOrbDark(scheme);
    const ink = isDark ? dotColor : dotColorLight;
    const pill = isDark ? pillDark : pillLight;
    const labelInk = isDark ? labelColor : labelColorLight;
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const [error, setError] = useState<string | null>(null);

    const index = LOOP_INDEX;
    const period = PERIOD;
    const word = label ?? LABEL;

    const settings = useRef<any>(null);
    settings.current = {
        index,
        period,
        speed,
        reverse,
        startAt,
        dotScale,
        knobs: {
            n: dots,
            sp: spread,
            pv: perspective,
            dz: depthSize,
            df: depthFade,
            yw: turn * (Math.PI / 180),
            pc: tilt * (Math.PI / 180),
            sn: spin,
            op: dotOpacity,
        },
        dot: useMemo(() => orbInk(ink), [ink]),
        accent: useMemo(() => orbInk(accent), [accent]),
    };

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        return start(canvas, () => settings.current, setError);
    }, []);

    const field: CSSProperties = {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        height: "100%",
        minHeight: BALL + PAD_TOP + PAD_BOTTOM,
        ...containerStyle,
    };

    if (error) {
        return (
            <div className={className} style={{ ...field, padding: 24, color: "#8f959c", font: "15px " + FONT, textAlign: "center" }}>
                {error}
            </div>
        );
    }

    return (
        <div className={className} style={field}>
            <div
                style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: GAP,
                    paddingTop: showsPill ? PAD_TOP : 0,
                    paddingBottom: showsPill ? PAD_BOTTOM : 0,
                    paddingLeft: showsPill ? (showsLabel ? PAD_LEFT : PAD_TOP) : 0,
                    paddingRight: showsPill ? (showsLabel ? PAD_RIGHT : PAD_TOP) : 0,
                    borderRadius: 999,
                    background: showsPill ? pill : "transparent",
                }}
            >
                <canvas
                    ref={canvasRef}
                    style={{ display: "block", width: BALL, height: BALL, background: "transparent" }}
                />
                {showsPill && showsLabel ? (
                    <span
                        style={{
                            fontFamily: FONT,
                            fontSize: FONT_SIZE,
                            lineHeight: 1,
                            color: labelInk,
                            opacity: LABEL_OPACITY,
                            whiteSpace: "nowrap",
                        }}
                    >
                        {word}
                    </span>
                ) : null}
            </div>
        </div>
    );
}
