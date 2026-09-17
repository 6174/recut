"use client";

import { useEffect, useRef, useState } from "react";
import { ClothSim as ClothSimJS } from "./cloth-runtime.js";

type ClothSimLike = {
    frame(
        values: Record<string, unknown>,
        time: number,
        width: number,
        height: number,
        targetView: unknown,
    ): void;
    pointer(x: number, y: number): void;
    endStroke(): void;
    dispose(): void;
};

const ClothSim = ClothSimJS as unknown as {
    new (device: unknown, canvasFormat: string, wgsl: string): ClothSimLike;
};

const WGSL = `
const PI: f32 = 3.141592653589793;
const RECIP_PI: f32 = 0.3183098861837907;

struct U {
  model: mat4x4<f32>,
  viewProj: mat4x4<f32>,
  camera: vec4<f32>,
  base: vec4<f32>,
  sheenC: vec4<f32>,
  tint: vec4<f32>,
  pointC: vec4<f32>,
  m0: vec4<f32>,
  m1: vec4<f32>,
  m2: vec4<f32>,
  tiles: vec4<f32>,
  env: vec4<f32>,
  view: vec4<f32>,
  grain: vec4<f32>,
  bg0: vec4<f32>,
  bg1: vec4<f32>,
  bg2: vec4<f32>,
  bgP: vec4<f32>,
  bgM: vec4<f32>,
};

@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var fillTex: texture_2d<f32>;
@group(0) @binding(2) var fillSmp: sampler;
@group(0) @binding(3) var weaveTex: texture_2d<f32>;
@group(0) @binding(4) var weaveSmp: sampler;
@group(0) @binding(5) var sceneTex: texture_2d<f32>;
@group(0) @binding(6) var sceneSmp: sampler;

fn pow2f(x: f32) -> f32 { return x * x; }
fn pow2v(x: vec3<f32>) -> vec3<f32> { return x * x; }
fn max3(v: vec3<f32>) -> f32 { return max(max(v.x, v.y), v.z); }
fn sat(x: f32) -> f32 { return clamp(x, 0.0, 1.0); }

fn F_Schlick3(f0: vec3<f32>, f90: f32, dotVH: f32) -> vec3<f32> {
  let f = pow(1.0 - dotVH, 5.0);
  return f0 * (1.0 - f) + vec3<f32>(f90 * f);
}
fn F_Schlick1(f0: f32, f90: f32, dotVH: f32) -> f32 {
  let f = pow(1.0 - dotVH, 5.0);
  return f0 * (1.0 - f) + (f90 * f);
}
fn V_GGX_SmithCorrelated(alpha: f32, dotNL: f32, dotNV: f32) -> f32 {
  let a2 = pow2f(alpha);
  let gv = dotNL * sqrt(a2 + (1.0 - a2) * pow2f(dotNV));
  let gl = dotNV * sqrt(a2 + (1.0 - a2) * pow2f(dotNL));
  return 0.5 / max(gv + gl, 1e-6);
}
fn D_GGX(alpha: f32, dotNH: f32) -> f32 {
  let a2 = pow2f(alpha);
  let d = (dotNH * a2 - dotNH) * dotNH + 1.0;
  return RECIP_PI * a2 / pow2f(d);
}
fn DFGApprox(dotNV: f32, roughness: f32) -> vec2<f32> {
  let c0 = vec4<f32>(-1.0, -0.0275, -0.572, 0.022);
  let c1 = vec4<f32>(1.0, 0.0425, 1.04, -0.04);
  let r = roughness * c0 + c1;
  let a004 = min(r.x * r.x, exp2(-9.28 * dotNV)) * r.x + r.y;
  return vec2<f32>(-1.04, 1.04) * a004 + r.zw;
}
fn D_Charlie(roughness: f32, dotNH: f32) -> f32 {
  let alpha = pow2f(roughness);
  let invAlpha = 1.0 / max(alpha, 1e-4);
  let cos2h = dotNH * dotNH;
  let sin2h = max(1.0 - cos2h, 0.0078125);
  return (2.0 + invAlpha) * pow(sin2h, invAlpha * 0.5) / (2.0 * PI);
}
fn V_Neubelt(dotNV: f32, dotNL: f32) -> f32 {
  return sat(1.0 / (4.0 * (dotNL + dotNV - dotNL * dotNV)));
}
fn BRDF_Sheen(n: vec3<f32>, v: vec3<f32>, l: vec3<f32>, sheenColor: vec3<f32>, sheenRoughness: f32) -> vec3<f32> {
  let h = normalize(l + v);
  let dotNL = sat(dot(n, l));
  let dotNV = sat(dot(n, v));
  let dotNH = sat(dot(n, h));
  return sheenColor * (D_Charlie(sheenRoughness, dotNH) * V_Neubelt(dotNV, dotNL));
}
fn IBLSheenBRDF(dotNV: f32, roughness: f32) -> f32 {
  let r2 = roughness * roughness;
  var a: f32;
  var b: f32;
  if (roughness < 0.25) {
    a = -339.2 * r2 + 474.7 * roughness - 163.7;
    b = 44.0 * r2 - 61.5 * roughness + 24.2;
  } else {
    a = -8.48 * r2 + 14.3 * roughness - 9.95;
    b = 1.97 * r2 - 3.27 * roughness + 0.72;
  }
  return sat(exp(a * dotNV + b) * RECIP_PI);
}

fn Fresnel0ToIor(f0: vec3<f32>) -> vec3<f32> {
  let s = sqrt(f0);
  return (vec3<f32>(1.0) + s) / max(vec3<f32>(1.0) - s, vec3<f32>(1e-4));
}
fn IorToFresnel0v(transmitted: vec3<f32>, incident: f32) -> vec3<f32> {
  return pow2v((transmitted - vec3<f32>(incident)) / (transmitted + vec3<f32>(incident)));
}
fn IorToFresnel0f(transmitted: f32, incident: f32) -> f32 {
  return pow2f((transmitted - incident) / (transmitted + incident));
}
fn evalSensitivity(opd: f32, shift: vec3<f32>) -> vec3<f32> {
  let phase = 2.0 * PI * opd * 1.0e-9;
  let val = vec3<f32>(5.4856e-13, 4.4201e-13, 5.2481e-13);
  let pos = vec3<f32>(1.6810e+06, 1.7953e+06, 2.2084e+06);
  let var_ = vec3<f32>(4.3278e+09, 9.3046e+09, 6.6121e+09);
  var xyz = val * sqrt(2.0 * PI * var_) * cos(pos * phase + shift) * exp(-pow2f(phase) * var_);
  xyz.x += 9.7470e-14 * sqrt(2.0 * PI * 4.5282e+09)
         * cos(2.2399e+06 * phase + shift.x) * exp(-4.5282e+09 * pow2f(phase));
  xyz /= vec3<f32>(1.0685e-7);
  let XYZ_TO_REC709 = mat3x3<f32>(vec3<f32>( 3.2404542, -0.9692660,  0.0556434),
                                  vec3<f32>(-1.5371385,  1.8760108, -0.2040259),
                                  vec3<f32>(-0.4985314,  0.0415560,  1.0572252));
  return XYZ_TO_REC709 * xyz;
}
fn evalIridescence(outsideIOR: f32, eta2: f32, cosTheta1: f32,
                   thickness: f32, baseF0: vec3<f32>) -> vec3<f32> {
  let iridescenceIOR = mix(outsideIOR, eta2, smoothstep(0.0, 0.03, thickness));
  let sinTheta2Sq = pow2f(outsideIOR / iridescenceIOR) * (1.0 - pow2f(cosTheta1));
  let cosTheta2Sq = 1.0 - sinTheta2Sq;
  if (cosTheta2Sq < 0.0) { return vec3<f32>(1.0); }
  let cosTheta2 = sqrt(cosTheta2Sq);

  let R0 = IorToFresnel0f(iridescenceIOR, outsideIOR);
  let R12 = F_Schlick1(R0, 1.0, cosTheta1);
  let T121 = 1.0 - R12;
  var phi12 = 0.0;
  if (iridescenceIOR < outsideIOR) { phi12 = PI; }
  let phi21 = PI - phi12;

  let baseIOR = Fresnel0ToIor(clamp(baseF0, vec3<f32>(0.0), vec3<f32>(0.9999)));
  let R1 = IorToFresnel0v(baseIOR, iridescenceIOR);
  let R23 = F_Schlick3(R1, 1.0, cosTheta2);
  let phi23 = vec3<f32>(select(0.0, PI, baseIOR.x < iridescenceIOR),
                        select(0.0, PI, baseIOR.y < iridescenceIOR),
                        select(0.0, PI, baseIOR.z < iridescenceIOR));

  let opd = 2.0 * iridescenceIOR * thickness * cosTheta2;
  let phi = vec3<f32>(phi21) + phi23;

  let R123 = clamp(R12 * R23, vec3<f32>(1e-5), vec3<f32>(0.9999));
  let r123 = sqrt(R123);
  let Rs = pow2f(T121) * R23 / (vec3<f32>(1.0) - R123);

  var I = vec3<f32>(R12) + Rs;
  var Cm = Rs - vec3<f32>(T121);
  for (var m: i32 = 1; m <= 2; m = m + 1) {
    Cm = Cm * r123;
    let Sm = 2.0 * evalSensitivity(f32(m) * opd, f32(m) * phi);
    I = I + Cm * Sm;
  }
  return max(I, vec3<f32>(0.0));
}
fn Schlick_to_F0(f: vec3<f32>, f90: f32, dotVH: f32) -> vec3<f32> {
  let x = clamp(1.0 - dotVH, 0.0, 1.0);
  let x5 = clamp(x * x * x * x * x, 0.0, 0.9999);
  return (f - vec3<f32>(f90) * x5) / (1.0 - x5);
}

fn softPanel(d: vec3<f32>, axis: vec3<f32>, rough: f32) -> vec3<f32> {
  let sharp = mix(26.0, 1.2, sat(rough * 1.4 + 0.06));
  let norm = (sharp + 1.0) / 27.0;
  return vec3<f32>(norm * pow(sat(dot(d, axis)), sharp));
}
fn roomEnv(d: vec3<f32>, rough: f32) -> vec3<f32> {
  let up = d.y;
  var c = mix(vec3<f32>(0.05, 0.053, 0.062), vec3<f32>(0.55, 0.57, 0.62),
              vec3<f32>(smoothstep(-1.0, -0.02, up)));
  c = mix(c, vec3<f32>(2.00, 2.05, 2.15), vec3<f32>(smoothstep(0.10, 0.80, up)));
  c += 1.70 * softPanel(d, normalize(vec3<f32>(0.42, 0.62, 0.66)), rough);
  c += 0.55 * vec3<f32>(0.82, 0.86, 0.95) * softPanel(d, normalize(vec3<f32>(0.10, 0.05, 1.0)), rough);
  c += 0.30 * vec3<f32>(0.78, 0.84, 0.95) * softPanel(d, normalize(vec3<f32>(-0.85, -0.18, 0.5)), rough);
  c += 0.70 * softPanel(d, normalize(vec3<f32>(-0.32, 0.42, -0.85)), rough);
  return c;
}

fn acesFilmic(color_in: vec3<f32>, exposure: f32) -> vec3<f32> {
  let IN = mat3x3<f32>(vec3<f32>(0.59719, 0.07600, 0.02840),
                       vec3<f32>(0.35458, 0.90834, 0.13383),
                       vec3<f32>(0.04823, 0.01566, 0.83777));
  let OUT = mat3x3<f32>(vec3<f32>( 1.60475, -0.10208, -0.00327),
                        vec3<f32>(-0.53108,  1.10813, -0.07276),
                        vec3<f32>(-0.07367, -0.00605,  1.07602));
  var color = color_in * (exposure / 0.6);
  color = IN * color;
  let a = color * (color + vec3<f32>(0.0245786)) - vec3<f32>(0.000090537);
  let b = color * (0.983729 * color + vec3<f32>(0.4329510)) + vec3<f32>(0.238081);
  color = a / b;
  color = OUT * color;
  return clamp(color, vec3<f32>(0.0), vec3<f32>(1.0));
}
fn linearToSRGB(c: vec3<f32>) -> vec3<f32> {
  return mix(c * 12.92,
             1.055 * pow(max(c, vec3<f32>(1e-5)), vec3<f32>(1.0 / 2.4)) - vec3<f32>(0.055),
             step(vec3<f32>(0.0031308), c));
}

struct SurfaceOut {
  @builtin(position) position: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
  @location(1) worldNormal: vec3<f32>,
  @location(2) uv: vec2<f32>,
};

struct PointOut {
  @builtin(position) position: vec4<f32>,
  @location(0) local: vec2<f32>,
  @location(1) uv: vec2<f32>,
};

struct FullOut {
  @builtin(position) position: vec4<f32>,
  @location(0) ndc: vec2<f32>,
};

@vertex
fn vs_surface(@location(0) local: vec3<f32>,
              @location(1) n: vec3<f32>,
              @location(2) uv: vec2<f32>) -> SurfaceOut {
  let world = u.model * vec4<f32>(local, 1.0);
  var o: SurfaceOut;
  o.position = u.viewProj * world;
  o.worldPos = world.xyz;
  o.worldNormal = (u.model * vec4<f32>(n, 0.0)).xyz;
  o.uv = uv;
  return o;
}

@vertex
fn vs_points(@builtin(vertex_index) vi: u32,
             @location(0) local: vec3<f32>,
             @location(2) uv: vec2<f32>) -> PointOut {
  var corners = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0,  1.0),
  );
  let c = corners[vi];
  let world = u.model * vec4<f32>(local, 1.0);
  let clip = u.viewProj * world;
  let viewZ = max(clip.w, 1e-3);
  var px = max(1.0, u.env.w * 0.5 * u.view.y / viewZ);
  if (u.grain.w > 0.0) { px = u.grain.w; }
  let half = vec2<f32>(px / max(u.view.x, 1.0), px / max(u.view.y, 1.0)) * clip.w;
  var o: PointOut;
  o.position = vec4<f32>(clip.xy + c * half, clip.z, clip.w);
  o.local = c;
  o.uv = uv;
  return o;
}

@vertex
fn vs_full(@builtin(vertex_index) vi: u32) -> FullOut {
  var p = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0),
  );
  var o: FullOut;
  o.ndc = p[vi];
  o.position = vec4<f32>(o.ndc, 0.0, 1.0);
  return o;
}

@fragment
fn fs_background(in: FullOut) -> @location(0) vec4<f32> {
  let mode = u.bgM.x;
  if (mode < 0.5) { return vec4<f32>(0.0); }
  let uv = vec2<f32>(in.ndc.x * 0.5 + 0.5, 0.5 - in.ndc.y * 0.5);
  if (mode < 1.5) { return vec4<f32>(u.bg0.rgb, 1.0); }
  let c = u.bgP.xy;
  let aspect = max(u.bgM.y, 1e-4);
  var radius = vec2<f32>(u.bgP.z, u.bgP.w * aspect);
  if (aspect >= 1.0) { radius = vec2<f32>(u.bgP.z / aspect, u.bgP.w); }
  let d = (uv - c) / max(radius, vec2<f32>(1e-4));
  let t = sat(length(d));
  var col = mix(u.bg1.rgb, u.bg2.rgb, vec3<f32>((t - 0.55) / 0.45));
  if (t < 0.55) { col = mix(u.bg0.rgb, u.bg1.rgb, vec3<f32>(t / 0.55)); }
  return vec4<f32>(col, 1.0);
}

@fragment
fn fs_surface(in: SurfaceOut, @builtin(front_facing) frontFacing: bool) -> @location(0) vec4<f32> {

  let viewDir = normalize(u.camera.xyz - in.worldPos);
  var facing = -1.0;
  if (frontFacing) { facing = 1.0; }
  let geoNormal = normalize(in.worldNormal) * facing;

  var albedo = u.base.rgb;
  var emissive = vec3<f32>(0.0);
  var roughness = u.base.w;
  let metalness = u.m0.x;
  let sheenAmount = u.sheenC.w;
  let envIntensity = u.m0.z;
  let bumpScale = u.m0.w;

  if (u.m2.y > 0.5) {
    let fuv = in.uv * u.tiles.zw;
    let texel = textureSample(fillTex, fillSmp, fuv);
    let picture = texel.rgb * u.tint.rgb;
    albedo = mix(u.base.rgb, picture, vec3<f32>(texel.a));
    if (u.m2.z > 0.5) { emissive = picture * texel.a * u.tint.w; }
  }

  var normal = geoNormal;
  if (u.m2.x > 0.5 && bumpScale != 0.0) {
    let buv = in.uv * u.tiles.xy;
    let dims = vec2<f32>(textureDimensions(weaveTex, 0));
    let texel = vec2<f32>(1.0) / dims;
    let h0 = textureSample(weaveTex, weaveSmp, buv).r;
    let hu = textureSample(weaveTex, weaveSmp, buv + vec2<f32>(texel.x, 0.0)).r;
    let hv = textureSample(weaveTex, weaveSmp, buv + vec2<f32>(0.0, texel.y)).r;
    let dH = vec2<f32>(hu - h0, hv - h0) * bumpScale * 4.0;
    let dp1 = dpdx(in.worldPos);
    let dp2 = dpdy(in.worldPos);
    let duv1 = dpdx(buv);
    let duv2 = dpdy(buv);
    let dp2perp = cross(dp2, geoNormal);
    let dp1perp = cross(geoNormal, dp1);
    let tangent = dp2perp * duv1.x + dp1perp * duv2.x;
    let bitangent = dp2perp * duv1.y + dp1perp * duv2.y;
    let invmax = inverseSqrt(max(max(dot(tangent, tangent), dot(bitangent, bitangent)), 1e-12));
    normal = normalize(geoNormal - (tangent * dH.x + bitangent * dH.y) * invmax);
  }

  if (u.m2.w < 0.5 && u.env.x < 0.5) {
    var shade = 0.25 + 0.75 * sat(dot(normal, viewDir));
    if (u.m2.y > 0.5) { shade = mix(shade, 1.0, clamp(u.tint.w, 0.0, 1.0)); }
    let flat = clamp(albedo * (shade * u.camera.w), vec3<f32>(0.0), vec3<f32>(1.0));
    return vec4<f32>(linearToSRGB(flat), 1.0);
  }

  let dxy = max(abs(dpdx(geoNormal)), abs(dpdy(geoNormal)));
  roughness = min(max(roughness, 0.0525) + max(max(dxy.x, dxy.y), dxy.z), 1.0);
  let alpha = pow2f(roughness);

  let diffuseColor = albedo * (1.0 - metalness);
  let specularColor = mix(vec3<f32>(0.04), albedo, vec3<f32>(metalness));
  let specularF90 = 1.0;

  let dotNV = sat(dot(normal, viewDir));

  let iridescence = u.m1.x;
  var iridescenceFresnel = vec3<f32>(0.0);
  var iridescenceF0 = specularColor;
  if (iridescence > 0.0) {
    let thickness = u.m1.w;
    iridescenceFresnel = evalIridescence(1.0, u.m1.y, dotNV, thickness, specularColor);
    iridescenceF0 = Schlick_to_F0(iridescenceFresnel, 1.0, dotNV);
  }

  var directDiffuse = vec3<f32>(0.0);
  var directSpecular = vec3<f32>(0.0);
  var sheenDirect = vec3<f32>(0.0);
  var indirectDiffuse = vec3<f32>(0.0);
  var indirectSpecular = vec3<f32>(0.0);
  var sheenIndirect = vec3<f32>(0.0);
  let sheenColor = u.sheenC.rgb;
  let sheenRoughness = max(u.m0.y, 0.07);

  if (u.m2.w > 0.5) {
    var LDIR = array<vec3<f32>, 3>(normalize(vec3<f32>( 2.4,  3.2,  4.5)),
                                   normalize(vec3<f32>(-3.5, -1.5,  2.5)),
                                   normalize(vec3<f32>(-1.5,  2.0, -4.0)));
    var LCOL = array<vec3<f32>, 3>(vec3<f32>(2.1, 2.1, 2.1),
                                   vec3<f32>(0.5085, 0.5820, 0.6841),
                                   vec3<f32>(1.5, 1.5, 1.5));
    for (var i: i32 = 0; i < 3; i = i + 1) {
      let l = LDIR[i];
      let dotNL = sat(dot(normal, l));
      if (dotNL <= 0.0) { continue; }
      let irradiance = dotNL * LCOL[i];
      let h = normalize(l + viewDir);
      let dotNH = sat(dot(normal, h));
      let dotVH = sat(dot(viewDir, h));
      var F = F_Schlick3(specularColor, specularF90, dotVH);
      if (iridescence > 0.0) { F = mix(F, iridescenceFresnel, vec3<f32>(iridescence)); }
      let V = V_GGX_SmithCorrelated(alpha, dotNL, dotNV);
      let D = D_GGX(alpha, dotNH);
      directSpecular += irradiance * (F * (V * D));
      directDiffuse += irradiance * (RECIP_PI * diffuseColor);
      if (sheenAmount > 0.0) {
        sheenDirect += irradiance * BRDF_Sheen(normal, viewDir, l, sheenColor, sheenRoughness);
      }
    }
    let AMBIENT = vec3<f32>(0.18);
    indirectDiffuse += AMBIENT * (RECIP_PI * diffuseColor);
  }

  if (u.env.x > 0.5 && envIntensity > 0.0) {
    let irradiance = roomEnv(normal, 1.0) * envIntensity;
    let reflectVec = normalize(mix(reflect(-viewDir, normal), normal, vec3<f32>(alpha)));
    let radiance = roomEnv(reflectVec, max(roughness, u.env.y)) * envIntensity;

    let fab = DFGApprox(dotNV, roughness);
    var Fr = specularColor;
    if (iridescence > 0.0) { Fr = mix(specularColor, iridescenceF0, vec3<f32>(iridescence)); }
    let FssEss = Fr * fab.x + vec3<f32>(specularF90 * fab.y);
    let Ess = fab.x + fab.y;
    let Ems = 1.0 - Ess;
    let Favg = Fr + (vec3<f32>(1.0) - Fr) * 0.047619;
    let Fms = FssEss * Favg / (vec3<f32>(1.0) - Ems * Favg);
    let total = FssEss + Fms * Ems;
    let diffuseScatter = diffuseColor * (1.0 - max3(total));

    indirectSpecular += radiance * FssEss;
    indirectSpecular += (Fms * Ems) * irradiance;
    indirectDiffuse += diffuseScatter * irradiance;

    if (sheenAmount > 0.0) {
      sheenIndirect += irradiance * sheenColor * IBLSheenBRDF(dotNV, sheenRoughness);
    }
  }

  var outgoing = directDiffuse + indirectDiffuse + directSpecular + indirectSpecular + emissive;
  if (sheenAmount > 0.0) {
    let energy = 1.0 - 0.157 * max3(sheenColor);
    outgoing = outgoing * energy + sheenDirect + sheenIndirect;
  }

  let mapped = acesFilmic(outgoing, u.camera.w);
  return vec4<f32>(linearToSRGB(mapped), 1.0);
}

@fragment
fn fs_points(in: PointOut) -> @location(0) vec4<f32> {
  var color = u.pointC.rgb;
  if (u.m2.y > 0.5 && u.view.w > 0.5) {
    let texel = textureSample(fillTex, fillSmp, in.uv * u.tiles.zw);
    color = mix(u.pointC.rgb, texel.rgb * u.tint.rgb, vec3<f32>(texel.a));
  }
  var alpha = u.pointC.w;
  if (u.view.z > 0.5) {
    let d = length(in.local);
    alpha *= 1.0 - smoothstep(0.75, 1.0, d);
    if (alpha <= 0.002) { discard; }
  }
  let mapped = acesFilmic(color, u.camera.w);
  return vec4<f32>(linearToSRGB(mapped), alpha);
}

fn hash21(p: vec2<f32>) -> f32 {
  var p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
  p3 += vec3<f32>(dot(p3, p3.yzx + vec3<f32>(33.33)));
  return fract((p3.x + p3.y) * p3.z);
}
fn blendOverlay(b: vec3<f32>, s: vec3<f32>) -> vec3<f32> {
  return select(1.0 - 2.0 * (vec3<f32>(1.0) - b) * (vec3<f32>(1.0) - s), 2.0 * b * s, b < vec3<f32>(0.5));
}
fn blendScreen(b: vec3<f32>, s: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(1.0) - (vec3<f32>(1.0) - b) * (vec3<f32>(1.0) - s);
}

@fragment
fn fs_composite(in: FullOut) -> @location(0) vec4<f32> {
  let uv = vec2<f32>(in.ndc.x * 0.5 + 0.5, 0.5 - in.ndc.y * 0.5);
  let src = textureSample(sceneTex, sceneSmp, uv);
  let overlayAmt = u.grain.x;
  let screenAmt = u.grain.y;
  if ((overlayAmt <= 0.0 && screenAmt <= 0.0) || src.a <= 0.0) { return src; }

  let px = floor(uv * u.view.xy / max(u.grain.z, 1.0));
  let g1 = vec3<f32>(hash21(px % vec2<f32>(256.0)));
  let g2 = vec3<f32>(hash21((px + vec2<f32>(113.0, 71.0)) % vec2<f32>(256.0) + vec2<f32>(17.0)));

  var c = src.rgb;
  c = mix(c, blendOverlay(c, g1), vec3<f32>(overlayAmt * src.a));
  c = mix(c, blendScreen(c, g2), vec3<f32>(screenAmt * src.a));
  return vec4<f32>(c, src.a);
}
`;

const PICTURE = "./cloth-artwork.jpg";

const VALUES: Record<string, unknown> = {
    "style": "grey",
    "fabric": "#a7abb2",
    "imageBrightness": 0.55,
    "imageTint": "#ffffff",
    "animate": true,
    "wind": 0.5,
    "gravity": 0,
    "drape": 3,
    "speed": 4,
    "grid": [42,54],
    "sheet": [2.35,3.05],
    "pins": "none",
    "scale": 0.7,
    "distance": 5.4,
    "tilt": [0.05,-0.12],
    "exposure": 1,
    "grain": 0,
    "grainScreen": 0,
    "bgInner": "#17191e",
    "bgMid": "#0c0d10",
    "bgOuter": "#060607",
    image: PICTURE,
};

export default function ClothView() {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        let disposed = false;
        let raf = 0;
        let sim: any = null;
        let cleanup: (() => void) | null = null;

        const start = async (canvas: HTMLCanvasElement) => {
            const gpu = (navigator as any).gpu;
            if (!gpu) {
                setError("This browser doesn't support WebGPU. Try Chrome or Edge 113+, Safari 26+, or Firefox 141+ on Windows.");
                return;
            }
            const adapter = await gpu.requestAdapter();
            if (!adapter) {
                setError("No WebGPU adapter is available on this machine.");
                return;
            }
            const device = await adapter.requestDevice();
            if (disposed) { device.destroy && device.destroy(); return; }
            device.lost.then(function (): void { disposed = true; });

            const context = canvas.getContext("webgpu") as any;
            const format = gpu.getPreferredCanvasFormat();
            context.configure({ device: device, format: format, alphaMode: "premultiplied" });

            sim = new ClothSim(device, format, WGSL);

            function resize() {
                const scale = Math.min(window.devicePixelRatio || 1, 2);
                const w = Math.max(1, Math.round(canvas.clientWidth * scale));
                const h = Math.max(1, Math.round(canvas.clientHeight * scale));
                if (w !== canvas.width) canvas.width = w;
                if (h !== canvas.height) canvas.height = h;
            }

            const startedAt = performance.now();
            function draw() {
                if (disposed) return;
                resize();
                let view: any;
                try {
                    view = context.getCurrentTexture().createView();
                } catch (e) {
                    raf = requestAnimationFrame(draw);
                    return;
                }
                sim.frame(VALUES, (performance.now() - startedAt) / 1000, canvas.width, canvas.height, view);
                raf = requestAnimationFrame(draw);
            }

            function toUv(e: PointerEvent) {
                const r = canvas.getBoundingClientRect();
                return [(e.clientX - r.left) / Math.max(r.width, 1), (e.clientY - r.top) / Math.max(r.height, 1)];
            }
            function onDown(e: PointerEvent) {
                if (!e.isPrimary) return;
                const uv = toUv(e);
                sim.pointer(uv[0], uv[1]);
            }
            function onMove(e: PointerEvent) {
                if (!e.isPrimary || e.buttons === 0) return;
                const uv = toUv(e);
                sim.pointer(uv[0], uv[1]);
            }
            function onUp(e: PointerEvent) {
                if (!e.isPrimary) return;
                sim.endStroke();
            }
            canvas.style.touchAction = "none";
            canvas.addEventListener("pointerdown", onDown);
            canvas.addEventListener("pointermove", onMove);
            canvas.addEventListener("pointerup", onUp);
            canvas.addEventListener("pointerleave", onUp);
            canvas.addEventListener("pointercancel", onUp);
            cleanup = function () {
                canvas.removeEventListener("pointerdown", onDown);
                canvas.removeEventListener("pointermove", onMove);
                canvas.removeEventListener("pointerup", onUp);
                canvas.removeEventListener("pointerleave", onUp);
                canvas.removeEventListener("pointercancel", onUp);
                if (sim) sim.dispose();
                if (device.destroy) device.destroy();
            };
            draw();
        };

        start(canvas).catch((e) => setError("WebGPU couldn't start: " + String(e)));

        return () => {
            disposed = true;
            cancelAnimationFrame(raf);
            if (cleanup) cleanup();
        };
    }, []);

    return (
        <div style={{ position: "relative", width: "100%", height: "100%" }}>
            <canvas
                ref={canvasRef}
                style={{ display: "block", width: "100%", height: "100%" }}
            />
            {error !== null && (
                <div
                    style={{
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 24,
                        textAlign: "center",
                        color: "#8A8A8E",
                        font: "14px system-ui, sans-serif",
                    }}
                >
                    {error}
                </div>
            )}
        </div>
    );
}
