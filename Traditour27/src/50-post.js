// ===== 50-post.js =====
// ============================================================================
// TIDEWRIGHT — 50-post.js
// TW.post: HDR scene target, bloom, the painterly (anisotropic Kuwahara) filter,
// paint-surface relief (canvas weave / impasto / dry brush), tonemap, grade,
// vignette, fade, dither.
// OWNER: agent POST.
//
// Frame chain (scene res unless noted):
//   scene (RGBA16F + depth tex)
//    ├─ pre      : scene -> sqrt(reinhard-luma) "paint space" colour, mipmapped (3 levels)
//    ├─ tensor   : Sobel structure tensor of pre (lod 1) + depth-driven stroke radius   [half res]
//    ├─ blur H/V : 9-tap gaussian of the tensor; V pass also solves orientation/anisotropy [half res]
//    │             -> "flow" texture: rg = double-angle stroke tangent * anisotropy, b = edge strength, a = radius
//    ├─ kuwahara : 8-sector anisotropic generalized Kuwahara on pre, oriented by flow
//    ├─ bloom    : 13-tap downsample chain (Karis on the first) + 9-tap tent upsample [half res ...]
//    └─ composite: [canvas res] paint + bloom -> exposure -> tonemap -> grade -> paint relief
//                  -> vignette -> fade -> dither -> gamma
// With params.painterly == 0 the pre/tensor/blur/kuwahara passes are skipped entirely.
// ============================================================================
(function () {
  'use strict';
  const TW = window.TW;

  const params = { exposure: 1.6, bloom: 1, painterly: 1, vignette: 1, fade: 0, grade: 1, debug: 0 };

  let gl = null, hdrOK = false;
  let scene = null, pre = null, tA = null, tB = null, paint = null;
  const down = [], up = [];
  let bloomLevels = 0;
  let pPre = null, pTensor = null, pBlur = null, pFlow = null, pDown0 = null, pDown = null, pUp = null, pRays = null, rayT = null;
  const pKuwa = [null, null, null], pComp = [null, null];
  let canvasW = 2, canvasH = 2, sceneScale = 1;

  // --------------------------------------------------------------------------
  // GLSL
  // --------------------------------------------------------------------------
  const LW = 'const vec3 LW = vec3(0.2126, 0.7152, 0.0722);\n';
  // "paint space": luminance-Reinhard then sqrt. Bounded, perceptually even, so means behave like mixed pigment
  // and a lantern flame cannot smear into a blob. Exactly invertible.
  const CODEC = LW + `
vec3 twEnc(vec3 c){ c = max(c, vec3(0.0)); c = c/(1.0 + dot(c, LW)); return sqrt(c); }
vec3 twDec(vec3 e){ vec3 c = e*e; return c/max(1.0 - dot(c, LW), 0.02); }
// the part of the light that gets painted: luminance soft-capped at ~1.6. Whatever is hotter (flame, lamps, glitter)
// is kept aside and laid back on top, unfiltered, as a crisp touch of pure pigment — and feeds the bloom.
vec3 twBase(vec3 c){ float L = dot(c, LW); float Lc = L < 1.0 ? L : 1.0 + 0.6*(1.0 - exp(-(L - 1.0)/0.6)); return c*(Lc/max(L, 1e-5)); }
vec3 twSane(vec3 c){ if (any(isnan(c)) || any(isinf(c))) return vec3(0.0); return clamp(c, vec3(0.0), vec3(64.0)); }
`;

  const FS_PRE = CODEC + `
in vec2 vUV; out vec4 o; uniform sampler2D uScene; uniform vec2 uPx; // ~2 px at 720p
// Thin features (rain, bolt cores, rigging, gulls, stars) must not be dabbed into fat smears: a pixel much brighter
// (darker) than BOTH neighbours across at least one axis is pulled to its surroundings before painting. Step edges are
// untouched (one neighbour of each pair is on the same side). The composite lays the original back on top, crisp.
void main(){
  vec3 c = twBase(twSane(texture(uScene, vUV).rgb));
  float L = dot(c, LW);
  float l = dot(twBase(twSane(texture(uScene, vUV - vec2(uPx.x, 0.0)).rgb)), LW), r = dot(twBase(twSane(texture(uScene, vUV + vec2(uPx.x, 0.0)).rgb)), LW);
  float d = dot(twBase(twSane(texture(uScene, vUV - vec2(0.0, uPx.y)).rgb)), LW), u = dot(twBase(twSane(texture(uScene, vUV + vec2(0.0, uPx.y)).rgb)), LW);
  float hi = min(max(l, r), max(d, u))*1.25 + 0.003, lo = max(min(l, r), min(d, u))*0.8 - 0.003;
  if (L > hi) c *= hi/L; else if (L < lo) c = c*(lo/max(L, 1e-4)) + vec3(lo)*step(L, 1e-4);
  o = vec4(twEnc(c), 1.0);
}`;

  // Structure tensor (E, F, G) of the paint-space image + stroke radius factor from linear depth.
  // ENC8: targets are RGBA8 -> scale/bias so it fits in [0,1].
  const TENSOR_CODEC = `
#if ENC8
vec4 tsEnc(vec3 t, float r){ return vec4(clamp(t.x*6.0, 0.0, 1.0), clamp(t.y*6.0, -1.0, 1.0)*0.5+0.5, clamp(t.z*6.0, 0.0, 1.0), r); }
vec3 tsDec(vec4 v){ return vec3(v.x, v.y*2.0-1.0, v.z)/6.0; }
#else
vec4 tsEnc(vec3 t, float r){ return vec4(t, r); }
vec3 tsDec(vec4 v){ return v.xyz; }
#endif
`;
  const FS_TENSOR = TENSOR_CODEC + `
#include <env>
in vec2 vUV; out vec4 o; uniform sampler2D uPre; uniform sampler2D uDepth; uniform vec2 uPx; // uPx = 2 scene texels
void main(){
  vec3 a = textureLod(uPre, vUV + uPx*vec2(-1.0,  1.0), 1.0).rgb, b = textureLod(uPre, vUV + uPx*vec2(0.0,  1.0), 1.0).rgb, c = textureLod(uPre, vUV + uPx*vec2(1.0,  1.0), 1.0).rgb;
  vec3 d = textureLod(uPre, vUV + uPx*vec2(-1.0,  0.0), 1.0).rgb,                                                             f = textureLod(uPre, vUV + uPx*vec2(1.0,  0.0), 1.0).rgb;
  vec3 g = textureLod(uPre, vUV + uPx*vec2(-1.0, -1.0), 1.0).rgb, h = textureLod(uPre, vUV + uPx*vec2(0.0, -1.0), 1.0).rgb, i = textureLod(uPre, vUV + uPx*vec2(1.0, -1.0), 1.0).rgb;
  vec3 gx = ((c + 2.0*f + i) - (a + 2.0*d + g))*0.25;
  vec3 gy = ((a + 2.0*b + c) - (g + 2.0*h + i))*0.25;
  // linear depth (m): tight strokes on the near skiff, broad loose ones for far sea and sky
  float zn = texture(uDepth, vUV).r*2.0 - 1.0;
  float z = uProj[3][2]/(zn + uProj[2][2]);
  // (fraction of the maximum radius: ~0 on the skiff, ~0.25 on nearby swell, ~0.46 on far sea and islands, 1 in the sky / far haze)
  float r = mix(mix(0.035, 0.25, smoothstep(10.0, 70.0, z)), 0.46, smoothstep(70.0, 450.0, z));
  r = mix(r, 1.0, smoothstep(1200.0, 6000.0, z));
  // lights and their warm reflections are not brushwork: bright-and-warm or simply very bright -> (almost) no stroke
  vec3 em = (b + d + f + h)*0.25; float eL = dot(em, vec3(0.2126, 0.7152, 0.0722));
  float hotp = max(smoothstep(0.40, 0.62, eL)*smoothstep(0.04, 0.18, em.r - em.b), smoothstep(0.66, 0.75, eL));
  r *= 1.0 - 0.9*hotp;
  r *= 1.0 - 0.7*smoothstep(0.015, 0.09, em.r - em.b)*(1.0 - uDawn); // at night anything warm is light (beams, glows): barely brushed
  o = tsEnc(vec3(dot(gx, gx), dot(gx, gy), dot(gy, gy)), r);
}`;
  const BLUR_BODY = `
in vec2 vUV; out vec4 o; uniform sampler2D uTex; uniform vec2 uDir;
vec4 blur9(){
  vec4 s = texture(uTex, vUV)*0.22702703;
  s += (texture(uTex, vUV + uDir*1.38461538) + texture(uTex, vUV - uDir*1.38461538))*0.31621622;
  s += (texture(uTex, vUV + uDir*3.23076923) + texture(uTex, vUV - uDir*3.23076923))*0.07027027;
  return s;
}`;
  const FS_BLUR = BLUR_BODY + `
void main(){ o = blur9(); }`;
  // Second blur direction + eigen-analysis. Output ("flow"):
  //   rg = (cos 2θ, sin 2θ)·A ·0.5+0.5 — θ = stroke tangent (along the edge), A = anisotropy 0..1. The double-angle form
  //        filters/interpolates correctly (θ and θ+π are the same stroke) and conflicting directions cancel to A→0.
  //   b  = edge strength, a = stroke radius factor 0..1
  const FS_FLOW = TENSOR_CODEC + BLUR_BODY + `
void main(){
  vec4 s = blur9(); vec3 t = tsDec(s);
  float tr = t.x + t.z;
  vec2 v = vec2(t.z - t.x, -2.0*t.y)/(tr + 2.5e-5);
  o = vec4(v*0.5 + 0.5, clamp(sqrt(max(tr, 0.0))*1.6, 0.0, 1.0), s.a);
}`;

  // decode the flow texture -> unit tangent t (cos>=0) and anisotropy A
  const FLOW_DEC = `
void twFlow(vec4 fl, vec2 bias, out vec2 t, out float A){
  vec2 v = (fl.xy*2.0 - 1.0)*smoothstep(0.04, 0.16, fl.b); A = min(length(v), 1.0);
  v += bias; float l = length(v);
  vec2 d = l > 1e-4 ? v/l : vec2(1.0, 0.0);
  t = vec2(sqrt(max(0.5 + 0.5*d.x, 0.0)), sqrt(max(0.5 - 0.5*d.x, 0.0))*(d.y < 0.0 ? -1.0 : 1.0));
}`;

  // Anisotropic generalized Kuwahara. 8 overlapping sectors on a unit disc, warped into an ellipse aligned with the
  // local stroke tangent; each sector's taps are fixed (no jitter -> temporally stable) and read from the mip level
  // matching their spacing, so the sparse pattern stays alias-free. Output is the variance-weighted blend of sector means.
  function kuwaharaFS(level) {
    // [radius 0..1, angle offset rad] within one sector (sector axis = +x; sectors are 45° apart)
    const sets = [
      [[0.42, 0], [0.86, -0.24], [0.86, 0.24]],
      [[0.34, 0], [0.70, -0.27], [0.70, 0.27], [1.0, 0]],
      [[0.30, 0], [0.55, -0.26], [0.55, 0.26], [0.78, -0.29], [0.78, 0.29], [1.0, 0]],
    ];
    const taps = sets[level], n = taps.length;
    const f = (x) => { const s = x.toFixed(5); return s.indexOf('.') < 0 ? s + '.0' : s; };
    const lodBias = level === 0 ? 0.5 : level === 1 ? 0.25 : 0.0;
    // xy = disc position, z = gaussian weight, w = lod offset (log2 of tap spacing relative to radius)
    const arr = taps.map((t) => 'vec4(' + f(t[0] * Math.cos(t[1])) + ',' + f(t[0] * Math.sin(t[1])) + ',' + f(Math.exp(-1.3 * t[0] * t[0])) + ',' + f(Math.log2(t[0] * 0.45) + lodBias) + ')');
    return FLOW_DEC + `
#include <env>
in vec2 vUV; out vec4 o;
uniform sampler2D uPre; uniform sampler2D uFlow;
uniform vec4 uK; // x = base stroke radius (scene px), y = variance floor, z = centre weight, w = 8-bit dither amount
#include <noise>
const int NT = ${n};
const vec4 TAPS[${n}] = vec4[${n}](${arr.join(', ')});
void main(){
  vec4 fl = texture(uFlow, vUV);
  vec2 t; float A; twFlow(fl, vec2(0.0), t, A);
  float R = uK.x*fl.a;
  const float AL = 0.6;
  float ea = R*(AL + A)/AL, eb = R*AL/(AL + A);
  vec2 tu = t*ea*uScreen.zw, nu = vec2(-t.y, t.x)*eb*uScreen.zw;
  float lod0 = log2(max(R, 1.0));
  vec3 c0 = textureLod(uPre, vUV, 0.0).rgb;
  vec3 c0s = c0*c0;
  vec3 mk[8]; float vk[8]; float vmin = 1e9;
  vec2 ax = vec2(1.0, 0.0), ay = vec2(0.0, 1.0);
  for (int k = 0; k < 8; k++){
    vec3 m = c0*uK.z, s = c0s*uK.z; float w = uK.z;
    for (int j = 0; j < NT; j++){
      vec4 T = TAPS[j];
      vec2 p = ax*T.x + ay*T.y;
      vec3 c = textureLod(uPre, vUV + tu*p.x + nu*p.y, max(lod0 + T.w, 0.0)).rgb;
      m += c*T.z; s += c*c*T.z; w += T.z;
    }
    m /= w; s = abs(s/w - m*m);
    float v = s.r + s.g + s.b;
    mk[k] = m; vk[k] = v; vmin = min(vmin, v);
    ax = vec2(ax.x - ax.y, ax.x + ax.y)*0.70710678; ay = vec2(-ax.y, ax.x);
  }
  // weights are RELATIVE to the calmest sector: the stroke always comes from the most uniform side, so colour pools
  // into flat dabs with crisp borders even in low-contrast water; the floor (uK.y) keeps truly flat areas a plain mean.
  vec3 acc = vec3(0.0); float wsum = 0.0; float vref = 1.0/(vmin*2.2 + uK.y);
  for (int k = 0; k < 8; k++){
    float x = vk[k]*vref; x *= x;
    float wk = 1.0/(1.0 + x);
    acc += mk[k]*wk; wsum += wk;
  }
  vec3 r = acc/wsum;
  if (uK.w > 0.0){ vec2 q = gl_FragCoord.xy/256.0; r += (textureLod(uNoiseTex, q, 0.0).a - textureLod(uNoiseTex, q + vec2(0.37, 0.61), 0.0).a)*uK.w; }
  o = vec4(r, 1.0);
}`;
  }

  // ---- bloom -----------------------------------------------------------------
  const DOWN_TAPS = `
in vec2 vUV; out vec4 o; uniform sampler2D uTex; uniform vec2 uPx; // source texel
#define T(x,y) texture(uTex, vUV + uPx*vec2(x, y)).rgb
`;
  // first downsample: 13 taps in 5 overlapping 2x2 groups, each group luma-weighted (soft Karis) -> no fireflies
  const FS_DOWN0 = CODEC + DOWN_TAPS + `
float kw(vec3 c){ return 1.0/(1.0 + dot(c, LW)*0.05); } // light-handed: tiny HDR lamps must still throw a wide glow
void main(){
  vec3 a = twSane(T(-2.0, 2.0)), b = twSane(T(0.0, 2.0)), c = twSane(T(2.0, 2.0));
  vec3 d = twSane(T(-2.0, 0.0)), e = twSane(T(0.0, 0.0)), f = twSane(T(2.0, 0.0));
  vec3 g = twSane(T(-2.0, -2.0)), h = twSane(T(0.0, -2.0)), i = twSane(T(2.0, -2.0));
  vec3 j = twSane(T(-1.0, 1.0)), k = twSane(T(1.0, 1.0)), l = twSane(T(-1.0, -1.0)), m = twSane(T(1.0, -1.0));
  vec3 g0 = (a + b + d + e)*0.25, g1 = (b + c + e + f)*0.25, g2 = (d + e + g + h)*0.25, g3 = (e + f + h + i)*0.25, g4 = (j + k + l + m)*0.25;
  float w0 = 0.125*kw(g0), w1 = 0.125*kw(g1), w2 = 0.125*kw(g2), w3 = 0.125*kw(g3), w4 = 0.5*kw(g4);
  vec3 s = (g0*w0 + g1*w1 + g2*w2 + g3*w3 + g4*w4)/(w0 + w1 + w2 + w3 + w4);
  // soft knee: dim fog and dark sea contribute next to nothing, so the bloom glows around lights without veiling the darks
  float L = dot(s, LW);
  o = vec4(s*(L*L/(L*L + 0.16)), 1.0);
}`;
  const FS_DOWN = DOWN_TAPS + `
void main(){
  vec3 e = T(0.0, 0.0);
  vec3 s = e*0.125;
  s += (T(-2.0, 2.0) + T(2.0, 2.0) + T(-2.0, -2.0) + T(2.0, -2.0))*0.03125;
  s += (T(0.0, 2.0) + T(-2.0, 0.0) + T(2.0, 0.0) + T(0.0, -2.0))*0.0625;
  s += (T(-1.0, 1.0) + T(1.0, 1.0) + T(-1.0, -1.0) + T(1.0, -1.0))*0.125;
  o = vec4(s, 1.0);
}`;
  // upsample: 3x3 tent of the coarser level, lerped over this level's own downsample
  // ---- Heartlight light shafts ------------------------------------------------
  // Screen-space radial scattering, quarter resolution. Each pixel marches 16 taps toward the lamp's screen position
  // through a coarse, knee-filtered bloom level (only glare / lit cloud / bright sky carry light; dark silhouettes such
  // as the island and the skiff contribute nothing, so they cut shadows into the fan). The start is jittered by half a
  // step; the source is coarse enough (1/16 res) that neither bands nor dashes survive.
  const FS_RAYS = LW + `
#include <env>
#include <noise>
in vec2 vUV; out vec4 o; uniform sampler2D uSrc; uniform sampler2D uDepth; uniform vec4 uL; // xy = lamp uv, z = aspect, w = direct lamp term
void main(){
  vec2 d = uL.xy - vUV;
  float jit = textureLod(uNoiseTex, gl_FragCoord.xy/256.0, 0.0).a;
  vec3 c = vec3(0.0); float w = 1.0, ws = 0.0, vis = 1.0;
  float zf = uProj[3][2]/(1.0 + uProj[2][2]);             // far-plane distance
  for (int i = 0; i < 16; i++){
    vec2 p = vUV + d*((float(i) + 0.35 + 0.3*jit)*0.0625);
    vec3 sm = texture(uSrc, p).rgb; float L = dot(sm, LW);
    sm *= clamp((L - 0.45)/max(L, 1e-4), 0.0, 1.0)*min(1.0, 6.0/max(L, 1e-4));   // threshold, and no single tap dominates
    float inb = step(0.0, p.x)*step(p.x, 1.0)*step(0.0, p.y)*step(p.y, 1.0);
    // anything solid between this pixel and the lamp (island, tower, skiff) blocks the light: silhouettes cut shadows
    float zt = uProj[3][2]/(texture(uDepth, p).r*2.0 - 1.0 + uProj[2][2]);
    vis *= 1.0 - 0.42*inb*(1.0 - smoothstep(0.45*zf, 0.8*zf, zt))*smoothstep(0.03, 0.10, length((uL.xy - p)*vec2(uL.z, 1.0)));   // (not the lamp house itself)
    c += sm*(w*inb); ws += w; w *= 1.12;                   // the lamp end of the path counts most
  }
  c *= vis/ws;
  vec2 da = d*vec2(uL.z, 1.0);
  float r = length(da);                                    // distance to the lamp, in screen heights
  float fall = 1.0/(1.0 + r*r*3.2);
  // the fan: slow-turning angular streaks, so the glow reads as separate shafts through rain and cloud
  float ang = atan(da.y, da.x);
  float fan = 0.45 + 0.75*twNoise(vec2(ang*6.0, uTime*0.10)) + 0.45*twNoise(vec2(ang*17.0 + 9.0, -uTime*0.07));
  fan = mix(1.0, fan, smoothstep(0.02, 0.18, r));          // no pinwheel inside the glare itself
  vec2 dl = (uL.xy - vUV)*vec2(uL.z, 1.0); float rl = dot(dl, dl);
  // + the lamp itself, analytically (its shafts must not depend on a tap finding it): tighter falloff, low level
  vec3 lampTerm = vec3(1.0, 0.86, 0.62)*(uL.w*vis/(1.0 + rl*11.0));
  o = vec4((mix(c, vec3(dot(c, LW)), 0.35)*fall + lampTerm)*fan, 1.0);
}`;
  const FS_UP = `
in vec2 vUV; out vec4 o; uniform sampler2D uTex; uniform sampler2D uBase; uniform vec2 uPx; uniform float uMix;
#define T(x,y) texture(uTex, vUV + uPx*vec2(x, y)).rgb
void main(){
  vec3 s = T(0.0, 0.0)*4.0;
  s += (T(-1.0, 0.0) + T(1.0, 0.0) + T(0.0, -1.0) + T(0.0, 1.0))*2.0;
  s += T(-1.0, -1.0) + T(1.0, -1.0) + T(-1.0, 1.0) + T(1.0, 1.0);
  o = vec4(mix(texture(uBase, vUV).rgb, s*0.0625, uMix), 1.0);
}`;

  // ---- composite (canvas resolution) -------------------------------------------
  function compositeFS(paintOn) {
    return '#define PAINT ' + (paintOn ? 1 : 0) + '\n' + CODEC + FLOW_DEC + `
#include <env>
#include <noise>
in vec2 vUV; out vec4 o;
uniform sampler2D uScene; uniform sampler2D uBloom; uniform sampler2D uRays;
uniform vec4 uRay;    // z = light-shaft gain (0 = off), w = ignition clamp 0..1 (edge treatment held back during the flash)
#if PAINT
uniform sampler2D uPaint; uniform sampler2D uFlow; uniform sampler2D uPre;
#endif
uniform vec4 uP;      // exposure, bloom, painterly, vignette
uniform vec4 uQ;      // fade, grade, canvas scale (canvasH/720), scene scale
uniform vec4 uCanvas; // canvas w, h, 1/sceneW, 1/sceneH
uniform float uDbg;   // -1 = low quality (no fine relief), 0 = normal, 1/2 = debug views

vec3 aces(vec3 x){ return clamp((x*(2.51*x + 0.03))/(x*(2.43*x + 0.59) + 0.14), 0.0, 1.0); }
// ACES fit (same curve as the dev stub), but bright saturated light keeps its hue for longer:
// blend toward a max-channel (hue-preserving) mapping so lantern orange stays orange instead of going yellow-white.
vec3 tonemap(vec3 c){
  vec3 a = aces(c);
  float pk = max(c.r, max(c.g, c.b));
  vec3 h = c*(aces(vec3(pk)).x/max(pk, 1e-5));
  float keep = 0.60*smoothstep(0.35, 1.6, pk)*(1.0 - 0.75*smoothstep(8.0, 70.0, pk));
  vec3 o = mix(a, h, keep);
  // shoulder: as a value nears the top it rolls toward a warm white of the same peak, never toward a saturated
  // primary (no flat yellow tower, no magenta where a warm lamp meets cool paint)
  float po = max(o.r, max(o.g, o.b));
  float roll = clamp(0.60*smoothstep(0.70, 1.0, po) + 0.30*smoothstep(2.0, 14.0, pk), 0.0, 0.9)*(1.0 - 0.45*uDawn);
  return mix(o, po*vec3(1.0, 0.955, 0.87), roll);
}
// colour grade, in display (gamma) space
vec3 grade(vec3 g, float dawn){
  float l = dot(g, LW);
  // split tone: cold teal-indigo shadows (deep teal at dawn); only already-warm lights are pushed warmer at night
  // (moon and lightning stay cold), at dawn every light leans gold/rose
  vec3 sh = mix(vec3(0.86, 1.00, 1.14), vec3(0.80, 1.00, 1.07), dawn);
  float warm = clamp((g.r - g.b)*2.5, 0.0, 1.0);
  vec3 hi = mix(vec3(1.0), mix(vec3(1.10, 1.00, 0.86), vec3(1.09, 0.985, 0.87), dawn), max(warm, dawn*0.65));
  vec3 c = g*mix(sh, hi, smoothstep(0.06, mix(0.62, 0.78, dawn), l));
  c *= l/max(dot(c, LW), 1e-4);
  // S-curve: gentle at night around a low pivot (dark silhouettes keep their separation from the sky);
  // firm at dawn around a higher one, so the morning has real value structure instead of cream
  float k = mix(0.15, 0.46, dawn), pv = mix(0.30, 0.50, dawn);
  c += k*2.4*(c - pv)*c*(1.0 - c);
  // saturation (warm lights a touch more: lantern and beacons against the cold night), then a tinted black floor
  float l2 = dot(c, LW);
  c = mix(vec3(l2), c, mix((1.16 + 0.18*warm)*(1.0 - 0.14*smoothstep(0.62, 0.95, l2)), 1.36, dawn));
  vec3 fl = mix(vec3(0.009, 0.013, 0.022), vec3(0.020, 0.022, 0.030), dawn);
  c = c*(1.0 - fl) + fl;
  return clamp(c, 0.0, 1.0);
}
#if PAINT
float weave(vec2 p, float pitch){
  vec2 q = vec2(p.x*0.9925 - p.y*0.1219, p.x*0.1219 + p.y*0.9925)/pitch; // 7 degrees off-axis: no beating against the pixel grid
  vec2 n = textureLod(uNoiseTex, p/(pitch*90.0), 0.0).rg - 0.5;
  q += n*1.1;
  return cos(6.2831853*q.x)*cos(6.2831853*q.y)*(0.75 + n.x);
}
// bristle height: static screen-space grain integrated along the local stroke direction (a 5-tap LIC)
float bristle(vec2 p, vec2 t, float pn){
  vec2 st = t*(1.7*pn); float inv = 1.0/(256.0*pn);
  float a = textureLod(uNoiseTex, p*inv, 0.0).a;
  a += textureLod(uNoiseTex, (p + st)*inv, 0.0).a + textureLod(uNoiseTex, (p - st)*inv, 0.0).a;
  a += textureLod(uNoiseTex, (p + 2.0*st)*inv, 0.0).a + textureLod(uNoiseTex, (p - 2.0*st)*inv, 0.0).a;
  return a*0.2;
}
// brush marks: the same idea two octaves coarser — long soft streaks of slightly varying value along the stroke
float strokes(vec2 p, vec2 t, float pn){
  float sc = pn*3.2; vec2 st = t*(2.1*sc); float inv = 1.0/(256.0*sc); p += vec2(91.0, 37.0)*sc;
  float a = textureLod(uNoiseTex, p*inv, 0.0).a;
  a += textureLod(uNoiseTex, (p + st)*inv, 0.0).a + textureLod(uNoiseTex, (p - st)*inv, 0.0).a;
  a += textureLod(uNoiseTex, (p + 2.0*st)*inv, 0.0).a + textureLod(uNoiseTex, (p - 2.0*st)*inv, 0.0).a;
  return a*0.2 - 0.5;
}
#endif
void main(){
  vec3 src = twSane(texture(uScene, vUV).rgb);
  float pm = 0.0;
#if PAINT
  pm = clamp(uP.z, 0.0, 1.0);
  vec4 fl = texture(uFlow, vUV);
  vec2 t; float A; twFlow(fl, vec2(0.085, 0.03), t, A);
  // painted edges: average the source a little ALONG the local edge (never across it), with the direction taken from
  // the pixel-scale gradient (FXAA-like). Geometric stair-steps and upscaling jaggies melt into a clean drawn line;
  // a 1 px line itself has no gradient at its centre and is left alone.
  if (uDbg > -0.5) {
    vec2 d = uCanvas.zw;
    float gw = sqrt(min(dot(twSane(texture(uScene, vUV - vec2(d.x, 0.0)).rgb), LW), 4.0)), gr = sqrt(min(dot(twSane(texture(uScene, vUV + vec2(d.x, 0.0)).rgb), LW), 4.0));
    float gd = sqrt(min(dot(twSane(texture(uScene, vUV - vec2(0.0, d.y)).rgb), LW), 4.0)), gu = sqrt(min(dot(twSane(texture(uScene, vUV + vec2(0.0, d.y)).rgb), LW), 4.0));
    vec2 gg = vec2(gr - gw, gu - gd); float gm = length(gg);
    vec2 tn = vec2(-gg.y, gg.x)/max(gm, 1e-4)*d*1.5;
    vec3 ta = twSane(texture(uScene, vUV + tn).rgb), tb = twSane(texture(uScene, vUV - tn).rgb); vec3 s1 = ta + tb;
    // only where the centre lies BETWEEN its two tangent neighbours (a stair corner on a real edge). A pixel that is a
    // local extreme along the tangent is a spark, rain streak, bolt or thin line: leave it, or it gets a blocky footprint
    float lc = dot(src, LW), la = dot(ta, LW), lb = dot(tb, LW);
    float mx = max(la, lb), mn = min(la, lb);
    float inside = 1.0 - smoothstep(0.02, 0.25, max(lc - mx, mn - lc)/(lc + mx + 0.02));
    src = mix(src, src*0.36 + s1*0.32, smoothstep(0.035, 0.14, gm)*inside);
  }
  vec3 sb = twBase(src);
  // broad strokes + the render's own fine detail: a high-pass of the original (original - small blur) is laid back over
  // the painted masses, more where there is real structure. It may pull the paint toward the original but never past
  // it, so there is no sharpening overshoot / halo. Then a gentle, halo-limited local-contrast lift.
  // where strokes are broad (sky, cloud, far sea, foam on the swell) the painted layer is looked up through a small
  // brush-shaped offset across the stroke, so soft edges wobble and break up like dragged paint; near / hard objects (fl.a ~ 0) get none
  vec2 px = gl_FragCoord.xy;
  float cs = max(uQ.z, 0.5), pn = max(1.0, 1.25*cs);
  float mk = strokes(px, t, pn);
  float broad = smoothstep(0.09, 0.5, fl.a);
  float far = smoothstep(0.50, 0.92, fl.a);               // sky, cloud, far haze: where the picture is openly painted
  vec2 wob = textureLod(uNoiseTex, px/(256.0*1.6*cs), 2.5).rg - 0.5;   // slow hand wobble (fine octaves dropped via the mip)
  // (full strength only in sky / cloud / far haze, where the paint is also dragged along the stroke direction;
  //  a little on open water; faded out on strong hard silhouettes)
  float soft = (0.2*broad + 0.8*far)*(1.0 - smoothstep(0.30, 0.75, fl.b));
  // light shafts (lighthouse beams, glows) are light, not paint: where the pixel is warmer than the night or brighter
  // than its painted surroundings along a coherent straight feature, it is neither wobbled nor dragged
  vec3 es0 = twEnc(sb), e3 = textureLod(uPre, vUV, 3.0).rgb;
  float shaft = max(smoothstep(0.0, 0.05, es0.r - es0.b)*(1.0 - uDawn), smoothstep(0.008, 0.04, dot(es0 - e3, LW))*(0.35 + 0.65*smoothstep(0.2, 0.6, A)));
  soft *= (1.0 - shaft)*(1.0 - uRay.w);
  // the sky's own brush: the same streak field three times larger (long, broad, soft) — evaluated only where needed
  float big = 0.0;
  if (far > 0.01 && uDbg > -0.5){ // sampled on a 37-degree rotated lattice so the magnified noise grid never lines up into a weave
    const mat2 RT = mat2(0.7986, 0.6018, -0.6018, 0.7986);
    big = strokes(RT*px + vec2(311.0, 173.0), RT*t, pn*3.0);
  }
  vec2 buv = vUV + (wob*(5.0 + 2.5*far) + vec2(-t.y, t.x)*(mk*2.5 + big*9.0*far))*uCanvas.zw*(uQ.w*cs*soft*pm);
  vec3 ep = texture(uPaint, buv).rgb, es = es0;
  vec3 hp = es - textureLod(uPre, vUV, 1.5).rgb;
  // fine detail comes back at full weight near the camera, much less in the far, broadly painted parts
  float dwt = mix(0.5, 0.85, smoothstep(0.03, 0.22, fl.b))*mix(1.0, 0.35, broad)*(1.0 - 0.6*far);
  vec3 e = mix(ep, clamp(ep + hp*dwt, min(ep, es), max(ep, es)), mix(1.0, 0.45, broad)*(1.0 - 0.5*far));
  e += clamp(ep - e3, -0.06, 0.06)*(0.32*(1.0 - uRay.w));
  vec3 pc = twDec(max(e, vec3(0.0)));
  // thin / small features the strokes would swallow or smear (stars, embers, rain, bolt cores, the moon's disc; and
  // dark ones: rigging, gulls): where the source departs strongly from the painted mass, it shows through, crisp.
  // The brighter the feature in absolute terms, the smaller the departure needed.
  float Ls = dot(sb, LW), Lp = dot(pc, LW);
  float th = mix(1.6, 1.22, smoothstep(0.12, 0.7, Ls));
  float show = max(smoothstep(th, th*2.4, Ls/(Lp + 0.004)), smoothstep(1.5, 3.0, (Lp + 0.004)/(Ls + 0.004))*(1.0 - 0.8*uRay.w));
  // warm light on water / lit surfaces is never brushwork: it is taken smoothly from the render itself (a continuous
  // weight on the pixel's own colour, not a mask), so a warm gradient can not be cut into flat shapes by the filter
  float warmBright = smoothstep(0.30, 0.55, dot(es, LW))*smoothstep(0.03, 0.16, es.r - es.b);
  pc = mix(pc, sb, max(show, warmBright));
  vec3 col = mix(src, pc + (src - sb), clamp(pm*1.6, 0.0, 1.0));
#else
  vec3 col = src;
  if (uQ.w < 0.99){ // sharpened upsample of the clean render
    vec2 d = uCanvas.zw;
    vec3 b = (texture(uScene, vUV + vec2(d.x, 0.0)).rgb + texture(uScene, vUV - vec2(d.x, 0.0)).rgb + texture(uScene, vUV + vec2(0.0, d.y)).rgb + texture(uScene, vUV - vec2(0.0, d.y)).rgb)*0.25;
    col = clamp(col + (col - twSane(b))*0.6*(1.0 - uQ.w), col*0.6, col*1.6);
  }
#endif
  vec3 bloom = texture(uBloom, vUV).rgb;
  col += bloom*(0.20*uP.y);
  if (uRay.z > 0.0){ // 4-tap tent over the quarter-res shaft buffer: no blocks, no grain
    vec2 rd = uCanvas.zw*2.0;
    vec3 ry = texture(uRays, vUV + rd*vec2(1.0, 1.0)).rgb + texture(uRays, vUV + rd*vec2(-1.0, 1.0)).rgb + texture(uRays, vUV + rd*vec2(1.0, -1.0)).rgb + texture(uRays, vUV + rd*vec2(-1.0, -1.0)).rgb;
    col += ry*vec3(1.0, 0.80, 0.50)*(0.25*uRay.z);
  }   // warm gold shafts from the Heartlight

  // exposure: the eye stops down a little on a lightning flash (the scene itself already jumps) and for the bright morning
  float flash = clamp(uFlash, 0.0, 1.5);
  col *= uP.x*(1.0 - 0.13*flash)*(1.0 - 0.22*uDawn);
  // value structure: a power toe on luminance (chroma kept) opens the night's darks into readable mid-tones and
  // compresses diffuse whites, leaving the top of the range to lights and glints. Fades out toward the dawn picture.
  {
    float Lx = dot(col, LW), nt = uQ.y*(1.0 - 0.8*uDawn);
    float Ly = mix(Lx, 0.80*pow(max(Lx, 1e-5), 0.78), nt);
    col *= Ly/max(Lx, 1e-5);
  }
  col = tonemap(col);
  col = mix(col, vec3(dot(col, LW))*vec3(0.93, 0.98, 1.06), 0.05*min(flash, 1.0)); // faint cold bleach
  vec3 g = pow(col, vec3(1.0/2.2));
  g = mix(g, grade(g, uDawn), uQ.y);

#if PAINT
  // ---- the paint surface: weave, impasto, pooled pigment, dry brush ----
  float lum = dot(g, LW);
  float load = smoothstep(0.34, 0.62, textureLod(uNoiseTex, px/(256.0*5.0*cs), 0.0).g); // brush load varies patch to patch
  const vec2 LR = vec2(-0.5547, 0.8321);                  // raking light from the upper left
  float pitch = max(4.3, 4.4*cs);
  vec2 pl = px + LR*(1.15*pn);
  float b0 = 0.5, db = 0.0, dw = 0.0;
  if (uDbg > -0.5){ // (skipped at quality 0: 12 fewer taps per canvas pixel)
    b0 = bristle(px, t, pn);
    db = b0 - bristle(pl, t, pn);
    dw = weave(px, pitch) - weave(pl, pitch);
  }
  float conf = smoothstep(0.04, 0.16, fl.b);              // is there real form here, or just a smooth glow gradient?
  // canvas / pigment grain lives in the shadows and mid-tones only; highlights and lights stay clean
  float body = smoothstep(0.05, 0.18, lum)*(1.0 - smoothstep(0.50, 0.74, lum));
  // lattice-based texture (weave, bristle, brush marks) exists ONLY where there is real form; a smooth gradient (flat
  // sky, haze, glow on water) gets none of it — a regular pattern on a flat field reads as a screen door
  float form = smoothstep(0.035, 0.13, fl.b);
  float relief = (db*(0.35 + 0.65*load)*0.07 + dw*0.005*(1.0 - 0.8*load)*(1.0 - far))*body*form;
  // tooth for everything: high-passed (blue-ish) pixel grain, luminance-scaled, sized with the canvas, very low
  vec2 gq = px/(256.0*max(1.0, 0.9*cs)) + vec2(0.317, 0.713);
  float grain = textureLod(uNoiseTex, gq, 0.0).a - 0.5*(textureLod(uNoiseTex, gq + vec2(1.0/256.0, 0.0), 0.0).a + textureLod(uNoiseTex, gq + vec2(0.0, 1.0/256.0), 0.0).a);
  relief += grain*0.022*body;
  float pool = smoothstep(0.20, 0.90, fl.b)*0.05*broad*(1.0 - uRay.w)*(1.0 - smoothstep(0.55, 0.95, fl.b));  // pigment pooling where colour masses meet (never on hard objects)
  float dry = smoothstep(0.59, 0.73, b0)*(0.35 + 0.65*A)*0.035*body*(1.0 - 0.7*load)*conf; // dry-brush break-up
  float marks = body*form*(mk*mix(0.15*(0.4 + 0.6*broad), 0.09, far) + big*0.15*far); // sky: clearly visible, broad soft brush direction
  float airy = mix(1.0, 0.6, uDawn);
  g *= 1.0 + pm*((relief + marks)*airy - pool - dry);
#endif

  // vignette, fade
  vec2 vc = (vUV - 0.5)*vec2(1.85, 2.05);
  g *= 1.0 - 0.10*uP.w*smoothstep(0.60, 1.40, length(vc));
  g *= 1.0 - clamp(uQ.x, 0.0, 1.0);

#if PAINT
  if (uDbg > 1.5) g = vec3(fl.b, fl.a, 0.0); else if (uDbg > 0.5) g = vec3(fl.xy, 0.5);
#endif
  // triangular dither, 1 LSB: night gradients must not band at 8 bits
  vec2 dq = gl_FragCoord.xy/256.0;
  float dn = textureLod(uNoiseTex, dq, 0.0).a - textureLod(uNoiseTex, dq + vec2(0.53125, 0.26953125), 0.0).a;
  o = vec4(g + dn/255.0, 1.0);
}`;
  }

  // --------------------------------------------------------------------------
  // targets
  // --------------------------------------------------------------------------
  // colour target with a short mip chain (regenerated every frame by the caller)
  function mipTarget() {
    const t = { fbo: gl.createFramebuffer(), tex: null, w: 0, h: 0 };
    t.resize = function (w, h) {
      w = Math.max(1, w | 0); h = Math.max(1, h | 0);
      if (w === t.w && h === t.h) return;
      t.w = w; t.h = h;
      if (t.tex) gl.deleteTexture(t.tex);
      t.tex = TW.glx.texture({ w, h, internal: hdrOK ? 'RGBA16F' : 'RGBA8', format: 'RGBA', type: hdrOK ? 'HALF_FLOAT' : 'UNSIGNED_BYTE', filter: 'LINEAR', mips: true });
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    };
    t.bind = function () { gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo); gl.viewport(0, 0, t.w, t.h); };
    return t;
  }

  function init() {
    gl = TW.gl;
    hdrOK = !!TW.caps.floatRT && !TW.q.has('nofloat');
    const mk = (w, h, o) => TW.glx.target(w, h, { hdr: hdrOK && !!o.hdr, depth: o.depth });
    scene = mk(4, 4, { hdr: true, depth: 'texture' });
    post.scene = scene; post.depthTex = scene.depthTex;
    pre = mipTarget(); pre.resize(4, 4);
    tA = mk(2, 2, { hdr: true }); tB = mk(2, 2, { hdr: true }); paint = mk(4, 4, { hdr: true });
    for (let i = 0; i < 6; i++) { down.push(mk(2, 2, { hdr: true })); up.push(i < 5 ? mk(2, 2, { hdr: true }) : null); }

    const vs = TW.glsl.fsvs, enc = '#define ENC8 ' + (hdrOK ? 0 : 1) + '\n';
    pPre = TW.glx.program(vs, FS_PRE, 'post-pre');
    pTensor = TW.glx.program(vs, enc + FS_TENSOR, 'post-tensor');
    pBlur = TW.glx.program(vs, FS_BLUR, 'post-blur');
    pFlow = TW.glx.program(vs, enc + FS_FLOW, 'post-flow');
    pDown0 = TW.glx.program(vs, FS_DOWN0, 'post-bloom-down0');
    pDown = TW.glx.program(vs, FS_DOWN, 'post-bloom-down');
    pUp = TW.glx.program(vs, FS_UP, 'post-bloom-up');
    pRays = TW.glx.program(vs, FS_RAYS, 'post-heart-rays');
    rayT = mk(2, 2, { hdr: true });
    // the variants for the starting quality level are compiled now; the others on first use (one-off)
    kuwahara(qLevel()); composite(params.painterly > 0.001 ? 1 : 0);

    // look-dev overrides (debug only)
    ['exposure', 'bloom', 'painterly', 'vignette', 'grade'].forEach((k) => { if (TW.q.has(k)) params[k] = TW.qf(k, params[k]); });
    params.debug = TW.qf('pdbg', 0);
  }
  function qLevel() { const q = TW.quality ? TW.quality.level | 0 : 1; return q < 0 ? 0 : q > 2 ? 2 : q; }
  function kuwahara(q) { return pKuwa[q] || (pKuwa[q] = TW.glx.program(TW.glsl.fsvs, kuwaharaFS(q), 'post-kuwahara-q' + q)); }
  function composite(v) { return pComp[v] || (pComp[v] = TW.glx.program(TW.glsl.fsvs, compositeFS(v), 'post-composite-' + (v ? 'paint' : 'clean'))); }

  function resize(cw, ch, scale) {
    canvasW = Math.max(2, cw | 0); canvasH = Math.max(2, ch | 0); sceneScale = scale > 0 ? scale : 1;
    const sw = Math.max(2, Math.round(canvasW * sceneScale)), sh = Math.max(2, Math.round(canvasH * sceneScale));
    scene.resize(sw, sh);
    post.scene = scene; post.depthTex = scene.depthTex;
    TW.env.setSceneSize(sw, sh);
    pre.resize(sw, sh); paint.resize(sw, sh);
    const hw = Math.max(1, (sw + 1) >> 1), hh = Math.max(1, (sh + 1) >> 1);
    tA.resize(hw, hh); tB.resize(hw, hh);
    rayT.resize(Math.max(1, (hw + 1) >> 1), Math.max(1, (hh + 1) >> 1));
    let w = hw, h = hh; bloomLevels = 0;
    for (let i = 0; i < 6; i++) {
      down[i].resize(w, h); if (up[i]) up[i].resize(w, h);
      bloomLevels = i + 1;
      if (Math.min(w, h) <= 4) break;
      w = Math.max(1, (w + 1) >> 1); h = Math.max(1, (h + 1) >> 1);
    }
  }

  function begin() {
    scene.bind();
    gl.depthMask(true); gl.colorMask(true, true, true, true);
    gl.clearColor(0, 0, 0, 1); gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }

  function end() {
    const P = params, q = qLevel(), drawFS = TW.glx.drawFS;
    const pm = TW.saturate(+P.painterly || 0), bl = Math.max(0, +P.bloom || 0);
    const painted = pm > 0.001 && pPre.ok && pTensor.ok && pBlur.ok && pFlow.ok && kuwahara(q).ok;
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE); gl.colorMask(true, true, true, true);

    // ---- painterly ----
    if (painted) {
      pre.bind();
      { const o = Math.max(1.5, 2 * scene.h / 720); pPre.use().setTex('uScene', 0, scene.tex).set2f('uPx', o / scene.w, o / scene.h); drawFS(); }
      gl.bindTexture(gl.TEXTURE_2D, pre.tex); gl.generateMipmap(gl.TEXTURE_2D);

      tA.bind();
      pTensor.use().setTex('uPre', 0, pre.tex).setTex('uDepth', 1, scene.depthTex).set2f('uPx', 2 / scene.w, 2 / scene.h); drawFS();
      tB.bind();
      pBlur.use().setTex('uTex', 0, tA.tex).set2f('uDir', 1 / tA.w, 0); drawFS();
      tA.bind();
      pFlow.use().setTex('uTex', 0, tB.tex).set2f('uDir', 0, 1 / tB.h); drawFS();

      // stroke radius in scene pixels: constant fraction of the picture height -> same look at any resolution
      // (sub-linear above 1080p so 1440p / 4K never get huge blobs)
      const rs = scene.h / 720, R = 14.0 * (rs < 1.5 ? rs : Math.min(2.3, 1.5 + 0.45 * (rs - 1.5))) * (0.55 + 0.45 * pm);
      paint.bind();
      kuwahara(q).use().setTex('uPre', 0, pre.tex).setTex('uFlow', 1, tA.tex).set4f('uK', R, hdrOK ? 1.0e-4 : 2.0e-4, 0.4, hdrOK ? 0 : 0.6 / 255); drawFS();
    }

    // ---- bloom ----
    let bloomTex = null;
    const n = Math.min(bloomLevels, q === 0 ? 5 : 6);
    if (bl > 0.001 && n > 0) {
      down[0].bind();
      pDown0.use().setTex('uTex', 0, scene.tex).set2f('uPx', 1 / scene.w, 1 / scene.h); drawFS();
      pDown.use();
      for (let i = 1; i < n; i++) {
        down[i].bind();
        pDown.setTex('uTex', 0, down[i - 1].tex).set2f('uPx', 1 / down[i - 1].w, 1 / down[i - 1].h); drawFS();
      }
      let prev = down[n - 1];
      pUp.use().set1f('uMix', 0.66);
      for (let i = n - 2; i >= 0; i--) {
        up[i].bind();
        pUp.setTex('uTex', 0, prev.tex).setTex('uBase', 1, down[i].tex).set2f('uPx', 1 / prev.w, 1 / prev.h); drawFS();
        prev = up[i];
      }
      bloomTex = prev.tex;
    }

    // ---- Heartlight light shafts (only from ignition until the dawn has risen) ----
    let rayGain = 0, ign = 0;
    const H = TW.state.heart;
    if (H && H.t >= 0) {
      ign = 1 - TW.smoothstep(0.6, 1.8, H.t);   // the flash: hold the edge treatment back so silhouettes stay clean
      const env = TW.saturate(H.t / 0.15) * TW.lerp(0.85, 0.5, TW.smoothstep(0.5, 2.5, H.t)) * TW.lerp(1, 0.5, TW.smoothstep(4, 9, H.t)) * (1 - TW.smoothstep(0.35, 0.75, TW.state.dawn)) / (1 + 4.5 * Math.exp(-H.t / 0.5));   // the flash itself is far brighter: keep the shafts from whiting the frame out
      if (env > 0.01 && bloomTex && n >= 2 && pRays.ok) {
        const pr = TW.env.project([H.x, H.y, H.z]);
        if (pr[2] > 0.5 && pr[0] > -1 && pr[0] < 2 && pr[1] > -1 && pr[1] < 2) {
          const srcT = down[Math.min(n - 1, 3)];
          rayT.bind();
          pRays.use().setTex('uSrc', 0, srcT.tex).setTex('uDepth', 1, scene.depthTex).set4f('uL', pr[0], 1 - pr[1], scene.w / scene.h, 0.075); drawFS();
          rayGain = 0.6 * env * bl;
        }
      }
    }

    // ---- composite to the canvas ----
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, TW.canvas.width, TW.canvas.height);
    let cp = composite(painted ? 1 : 0); if (!cp.ok && painted) cp = composite(0); cp.use();
    cp.setTex('uScene', 0, scene.tex).setTex('uBloom', 1, bloomTex || scene.tex);
    if (painted) cp.setTex('uPaint', 2, paint.tex).setTex('uFlow', 3, tA.tex).setTex('uPre', 4, pre.tex);
    cp.set4f('uP', +P.exposure || 0, bloomTex ? bl * (hdrOK ? 1 : 1.5) : 0, pm, P.vignette === undefined ? 1 : +P.vignette || 0);
    cp.set4f('uQ', +P.fade || 0, P.grade === undefined ? 1 : +P.grade || 0, TW.canvas.height / 720, scene.w / Math.max(1, TW.canvas.width));
    cp.set4f('uCanvas', TW.canvas.width, TW.canvas.height, 1 / scene.w, 1 / scene.h);
    cp.set1f('uDbg', q === 0 ? -1 : +P.debug || 0);
    cp.setTex('uRays', 5, rayGain > 0 ? rayT.tex : scene.tex).set4f('uRay', 0, 0, rayGain, ign);
    drawFS();

    // ---- restore the agreed GL state; drop our textures from the low units ----
    for (let u = 5; u >= 0; u--) { gl.activeTexture(gl.TEXTURE0 + u); gl.bindTexture(gl.TEXTURE_2D, null); }
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
  }

  const post = (TW.post = { init, resize, begin, end, scene: null, depthTex: null, params });
})();

