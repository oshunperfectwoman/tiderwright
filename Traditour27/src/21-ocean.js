// ===== 21-ocean.js =====
// ============================================================================
// TIDEWRIGHT — 21-ocean.js
// The sea. A camera-following nest of world-snapped square rings (one draw call)
// displaced by the shared Gerstner sum twWave().
// Shading (round 3): the look is built to be crisp on its own, unfiltered —
//  * detail normals from two BAKED, tiling, mip-mapped choppy-sea textures
//    (slope / height / crest), sampled at four scales scrolling round the wind;
//  * value-defined wave faces: Fresnel sky reflection on the detailed normal,
//    dark body, height occlusion, hard energy-normalised glitter (moon, sun,
//    lantern, beacons) that relaxes into a soft path with distance;
//  * foam from the analytic Jacobian of the Gerstner displacement (now and
//    ~1.3 s ago), cut into lace by a baked, histogram-equalised foam texture;
//  * a boat-centred wake texture (thin V + lace band astern) and a contact
//    shadow that seats the hull in the water;
//  * controlled back-lit emerald crests, shore surf, the Maw, rain rings (q2).
// OWNER: agent SKY-OCEAN.
// ============================================================================
(function () {
  'use strict';
  const TW = window.TW;

  let levels = 9;            // nested rings, each twice as coarse as the last (10 at quality >= 1: a finer innermost ring)
  const EXTENT = 7100;       // half-size of the outermost ring (m)
  const WAKE_SIZE = 100;     // metres covered by the wake texture
  const MAX_STAMPS = 32;
  const WAKE_STEP = 1 / 20;  // wake simulation rate (s)
  const BAKE = 512;          // baked texture size
  const SLOPE_S = 24.0;      // slope range stored in the baked chop textures

  let prog = null, mesh = null, cell0 = 0.5, lodK = 0, holeK = 1 / 26;
  const jac = new Float32Array(32);
  let wakeProg = null, wakeA = null, wakeB = null, wakeN = 512;
  let wakeCx = 0, wakeCz = 0, wakeValid = false, wakeT = 0;
  let detA = null, detB = null, laceTex = null;
  const detK = [1, 1, 0.5, 0.5];
  const stamps = new Float32Array(MAX_STAMPS * 4), stampsB = new Float32Array(MAX_STAMPS * 4);
  // short history of the skiff's track (one sample per ~0.6 m), used to lay the two arms of the V wake
  const HN = 28, HSTEP = 0.6, hx = new Float32Array(HN), hz = new Float32Array(HN), hh = new Float32Array(HN);
  let hCount = 0, hHead = 0;
  let nStamps = 0;

  // --------------------------------------------------------------------------
  // Mesh: LEVELS concentric square rings of (2M)^2 cells. Vertex = (ix, iz, level);
  // the vertex shader scales by the level's cell size and snaps each level to its
  // own world grid, so vertices never swim. Finer levels overlap the hole of the
  // next coarser one by >= 1 cell (no stitching needed: both evaluate the same field).
  // --------------------------------------------------------------------------
  function buildMesh(M, LEVELS) {
    const side = 2 * M + 1;
    const hole = M / 2 - 2;
    const map = new Int32Array(side * side);
    const pos = [], idx = [];
    for (let L = 0; L < LEVELS; L++) {
      map.fill(-1);
      const vert = (i, j) => {
        const k = (j + M) * side + (i + M);
        let v = map[k];
        if (v < 0) { v = map[k] = pos.length / 3; pos.push(i, j, L); }
        return v;
      };
      for (let j = -M; j < M; j++) for (let i = -M; i < M; i++) {
        if (L > 0 && i >= -hole && i < hole && j >= -hole && j < hole) continue;
        const a = vert(i, j), b = vert(i, j + 1), c = vert(i + 1, j), d = vert(i + 1, j + 1);
        idx.push(a, b, c, c, b, d);
      }
    }
    return TW.glx.mesh({ attribs: [{ loc: 0, size: 3, data: new Float32Array(pos) }], indices: new Uint32Array(idx) });
  }

  const VS = `
#include <waves>
layout(location=0) in vec3 aPos;   // xy = integer lattice coords, z = ring level
uniform float uCell0; uniform float uLodK;
uniform sampler2D uDetA; uniform sampler2D uDetB; uniform vec4 uDetK;
out vec3 vP; out vec2 vRest; out vec3 vN; out vec2 vHC;
// height of one baked chop layer (same uv as chop() in the fragment shader, so geometry and shading agree)
float chopH(sampler2D tx, vec2 q, vec2 cs, float T, float spd, float lod){
  vec2 r = vec2(cs.x*q.x + cs.y*q.y, -cs.y*q.x + cs.x*q.y);
  return textureLod(tx, vec2((r.x - uTime*spd)/T, r.y/(T*1.5)), lod).b;
}
void main(){
  float c = uCell0*exp2(aPos.z);
  vec2 snap = floor(uCamPos.xz/(2.0*c) + 0.5)*(2.0*c);
  vec2 p = aPos.xy*c + snap;
  float dcam = distance(p, uCamPos.xz);
  float fade = 1.0 - smoothstep(1300.0, 2800.0, dcam);
  vec3 n; float cr;
  vec2 dc = abs(p - uCamPos.xz); twWaveMinL = 1.5*max(dc.x, dc.y)*uLodK;
  vec3 d = twWave(p, n, cr);
  d.y -= uWind.w; d *= fade; d.y += uWind.w;
  // Near the eye the two broadest chop layers also lift the surface itself, so crest silhouettes are irregular curves
  // instead of the straight lines a handful of Gerstner trains draw. It fades out round the skiff, where the hull must
  // meet exactly the water the physics uses.
  float nearK = 1.0 - smoothstep(110.0, 300.0, dcam);
  if (nearK > 0.001){
    vec2 wd = normalize(uWind.xy + vec2(1e-5)); vec2 wp = vec2(-wd.y, wd.x);
    vec2 q = vec2(dot(p, wd), dot(p, wp));
    float amp = min(mix(0.40, 1.0, uStorm) + 0.22*smoothstep(0.05, 0.9, uDawn), 1.0)*mix(0.80, 1.0, twWaveAtten(p));
    float lodB = max(log2(c*${BAKE}.0/10.3) + 0.5, 0.0);
    float h = (chopH(uDetB, q, vec2(0.8525, -0.5227), 10.3, 2.4, lodB) - uDetK.w)*(10.3*uDetK.y*0.072/${SLOPE_S.toFixed(1)})*(1.0 - smoothstep(35.0, 110.0, dcam));
#ifndef OCEAN_LOW
    float lodA = max(log2(c*${BAKE}.0/31.0) + 0.5, 0.0);
    h += (chopH(uDetA, q, vec2(0.9287, 0.3709), 31.0, 4.2, lodA) - uDetK.z)*(31.0*uDetK.x*0.085/${SLOPE_S.toFixed(1)});
#endif
    d.y += h*amp*nearK*smoothstep(2.6, 8.5, distance(p, uBoat.xz));
  }
  vP = vec3(p.x, 0.0, p.y) + d;
  vRest = p;
  vN = normalize(mix(vec3(0.0, 1.0, 0.0), n, fade));
  vHC = vec2(d.y - uWind.w, cr*fade);
  gl_Position = uViewProj*vec4(vP, 1.0);
}`;

  // --------------------------------------------------------------------------
  // Bake 1: a TILING choppy-sea heightfield (the classic "Seascape" octave, made exactly periodic by using integer
  // lattice matrices for every octave and a periodic warp noise). RG = normal.xz (-dH/du, /SLOPE_S), B = height, A = crest.
  // --------------------------------------------------------------------------
  const BAKE_WAVE_FS = `
in vec2 vUV; out vec4 o;
uniform float uSeed; uniform int uVar;
const vec2 MA[5] = vec2[5](vec2(2.0, 1.0), vec2(5.0, -2.0), vec2(3.0, 11.0), vec2(21.0, -9.0), vec2(20.0, 43.0));
const vec2 MB[5] = vec2[5](vec2(3.0, 1.0), vec2(7.0, -2.0), vec2(6.0, 15.0), vec2(31.0, -13.0), vec2(24.0, 67.0));
float hsh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed)*43758.5453); }
float pn(vec2 x, float per){
  vec2 i = floor(x), f = fract(x); vec2 u = f*f*(3.0 - 2.0*f);
  float a = hsh(mod(i, per)), b = hsh(mod(i + vec2(1.0, 0.0), per)), c = hsh(mod(i + vec2(0.0, 1.0), per)), d = hsh(mod(i + vec2(1.0, 1.0), per));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float oct(vec2 u, vec2 m, float choppy, float sd){
  // one train of short-crested wavelets: sharp ridges whose crest lines meander and come and go along their length
  float per = floor(length(m) + 0.5);
  float pe = max(3.0, floor(per*0.5 + 0.5));
  float cyc = m.x*u.x + m.y*u.y;
  float w1 = pn(u*pe + sd, pe)*2.0 - 1.0;
  float w2 = pn(u*per + sd + 17.0, per)*2.0 - 1.0;
  float sn = sin(3.14159265*(cyc + w1*0.85 + w2*0.32) + sd*1.7);
  float r = max(1.0 - sqrt(sn*sn + 0.035) + 0.02, 0.0);                     // a ridge with a slightly rounded crest
  float env = smoothstep(0.20, 0.70, pn(u*per + sd + 41.0, per)*0.6 + pn(u*pe + sd + 5.0, pe)*0.4);
  return pow(r, choppy)*(0.55 + 0.45*env);
}
vec2 field(vec2 u){
  float h = 0.0, cr = 0.0, a = 1.0, ch = 1.35, nrm = 0.0;   // near-linear flanks: slopes everywhere, no flat mirror-like troughs
  for (int i = 0; i < 5; i++){
    vec2 m = uVar == 0 ? MA[i] : MB[i];
    float d1 = oct(u, m, ch, float(i)*3.1 + 1.0), d2 = oct(u, m.yx, ch, float(i)*5.3 + 2.0);
    float mx = max(d1, d2);
    h += (d1*0.62 + d2*0.38)*a; cr += mx*mx*mx*a; nrm += a;
    a *= 0.47; ch = mix(ch, 1.0, 0.3);
  }
  return vec2(h, cr)/nrm;
}
void main(){
  float e = 0.5/${BAKE}.0;
  vec2 f = field(vUV);
  vec2 sl = vec2(field(vUV + vec2(e, 0.0)).x - field(vUV - vec2(e, 0.0)).x, field(vUV + vec2(0.0, e)).x - field(vUV - vec2(0.0, e)).x)/(2.0*e);
  o = vec4(clamp(0.5 - 0.5*sl/${SLOPE_S.toFixed(1)}, 0.0, 1.0), clamp(f.x, 0.0, 1.0), clamp(f.y*1.5, 0.0, 1.0));
}`;

  // --------------------------------------------------------------------------
  // Bake 2: sea-foam lace. A threshold field: cell borders of warped Worley noise at three scales (webs survive at low
  // coverage, cell interiors only fill at high coverage) modulated by fbm. R = field (equalised on the CPU afterwards so
  // "field > 1 - c" covers exactly a fraction c), G = emboss of the field (fake relief), B = fbm, A = fine bubbles.
  // --------------------------------------------------------------------------
  const BAKE_LACE_FS = `
in vec2 vUV; out vec4 o;
float hsh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)) + 3.7)*43758.5453); }
vec2 h2(vec2 p, float sd){ return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))) + sd)*43758.5453); }
float pn(vec2 x, float per){
  vec2 i = floor(x), f = fract(x); vec2 u = f*f*(3.0 - 2.0*f);
  float a = hsh(mod(i, per)), b = hsh(mod(i + vec2(1.0, 0.0), per)), c = hsh(mod(i + vec2(0.0, 1.0), per)), d = hsh(mod(i + vec2(1.0, 1.0), per));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 u){ return pn(u*4.0, 4.0)*0.5 + pn(u*9.0 + 3.3, 9.0)*0.27 + pn(u*19.0 + 7.1, 19.0)*0.15 + pn(u*41.0 + 1.7, 41.0)*0.08; }
float border(vec2 u, float C, float sd, float w){
  vec2 x = u*C; vec2 ic = floor(x), f = fract(x); float d1 = 9.0, d2 = 9.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++){
    vec2 g = vec2(float(i), float(j)); vec2 pt = h2(mod(ic + g, C), sd)*0.86 + 0.07;
    float d = length(g + pt - f);
    if (d < d1){ d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return 1.0 - smoothstep(0.015, w, d2 - d1);
}
vec2 field(vec2 u0){
  // heavy multi-scale warp: cell sizes and shapes vary from place to place, so no lattice can be read
  vec2 wA = vec2(pn(u0*3.0 + 11.0, 3.0), pn(u0*3.0 + 47.0, 3.0)) - 0.5;
  vec2 wB = vec2(pn(u0*7.0 + 5.0, 7.0), pn(u0*7.0 + 29.0, 7.0)) - 0.5;
  vec2 wC = vec2(pn(u0*17.0 + 2.0, 17.0), pn(u0*17.0 + 71.0, 17.0)) - 0.5;
  vec2 u = u0 + wA*0.17 + wB*0.060 + wC*0.018;
  float fb = fbm(u0), fb2 = fbm(u0.yx + 0.61);
  float b1 = border(u, 5.0, 1.0, 0.15), b2 = border(u + wB*0.05, 11.0, 2.0, 0.21), b3 = border(u - wB*0.04, 23.0, 3.0, 0.28), b4 = border(u, 47.0, 4.0, 0.36);
  float sel = smoothstep(0.38, 0.62, fb2);                              // which cell size dominates changes across the tile
  float web = max(mix(b1, b2, sel), mix(b3, b4, 1.0 - sel)*0.72);
  web *= smoothstep(0.34, 0.56, fb*0.55 + pn(u0*29.0 + 9.0, 29.0)*0.45 + web*0.10);   // strings break off instead of closing every polygon
  float froth = fb*0.72 + pn(u0*61.0 + 3.0, 61.0)*0.28;                 // fluffy body that fills in as coverage rises
  return vec2(web*0.48 + froth*0.52 + b4*0.05, b4);
}
void main(){
  vec2 f = field(vUV);
  float f2 = field(vUV + vec2(1.6, 1.2)/${BAKE}.0).x;
  o = vec4(clamp(f.x*0.8, 0.0, 1.0), clamp(0.5 + (f.x - f2)*2.2, 0.0, 1.0), fbm(vUV + 0.37), f.y);
}`;

  const FS = `
#include <noise>
#include <light>
#include <fog>
#include <sky>
uniform sampler2D uWake;      // boat-centred wake: R = fresh thin foam lines, G = churned band astern
uniform sampler2D uDetA;      // baked chop, pattern A: RG = normal.xz, B = height, A = crest
uniform sampler2D uDetB;      // baked chop, pattern B
uniform sampler2D uLace;      // baked foam lace: R = equalised threshold field, G = relief, B = fbm, A = bubbles
uniform vec4 uWakeRect;       // xy = centre (world xz), z = 1/size, w = 1 when valid
uniform vec4 uJac[8];         // per wave: cos/sin of the two fixed foam-age phase lags (1.2 s, 2.6 s)
uniform vec4 uDetK;           // x, y = gains that bring pattern A / B to unit rms slope; z, w = their mean heights
in vec3 vP; in vec2 vRest; in vec3 vN; in vec2 vHC;
out vec4 o;

float sat(float x){ return clamp(x, 0.0, 1.0); }

#ifdef OCEAN_RAIN
// one layer of expanding rain rings; returns a slope perturbation
vec2 rainRing(vec2 p, float sc, float seed){
  vec2 gc = p*sc; vec2 id = floor(gc); vec2 h = twHash22(id + seed);
  float t = fract(uTime*(1.1 + 0.6*h.x) + h.y*7.0);
  vec2 f = fract(gc) - 0.5 - (h - 0.5)*0.4;
  float r = length(f);
  float x = (r - t*0.40)*34.0;
  float w = cos(clamp(x, -4.712, 4.712))*exp(-x*x*0.12)*(1.0 - t)*(1.0 - t);
  return (f/max(r, 0.02))*w;
}
#endif

// One scrolling layer of baked chop. q = wind-frame position (x along the wind), cs = (cos, sin) of the layer's heading
// relative to the wind, T = tile size (m), spd = drift (m/s), k = gain to unit rms slope.
// Returns xy = slope (normal.xz, wind frame, unit rms), z = height 0..1, w = crest mask.
vec4 chop(sampler2D tx, vec2 q, vec2 cs, float T, float spd, float k){
  vec2 r = vec2(cs.x*q.x + cs.y*q.y, -cs.y*q.x + cs.x*q.y);
  vec4 t = texture(tx, vec2((r.x - uTime*spd)/T, r.y/(T*1.5)));
  vec2 s = (t.rg*2.0 - 1.0)*k; s.y *= 0.6667;
  return vec4(cs.x*s.x - cs.y*s.y, cs.y*s.x + cs.x*s.y, t.b, t.a);
}
// reflection lobe of a lamp, stretched vertically the way a rough sea smears it into a column toward the eye
float column(vec3 R, vec3 L, float k, float stretch){ vec3 dl = R - L; dl.y *= stretch; return exp(-dot(dl, dl)*k); }
// fraction of a layer's slope variance already filtered away by the mips (tpp = texels per pixel)
float lostMip(float tpp){ return clamp(log2(max(tpp, 1.0))*0.22, 0.0, 1.0); }
// normalised Blinn-Phong lobe on the detailed normal
float glit(vec3 N, vec3 V, vec3 L, float shin){ return (shin + 2.0)*0.159155*pow(max(dot(N, normalize(L + V)), 0.0), shin); }
// how strongly light from L shines THROUGH a crest toward the viewer: only for crests between the eye and the light
float backlit(vec3 L, vec3 N, vec3 V){
  vec2 Lh = normalize(L.xz + vec2(1e-4)); vec2 Vh = normalize(V.xz + vec2(1e-4));
  float toward = pow(sat(0.5 - 0.5*dot(Vh, Lh)), 6.0);
  float face = smoothstep(0.02, 0.32, dot(N.xz, Vh));
  return toward*face*(1.0 - 0.5*sat(L.y));
}

void main(){
  vec2 p = vRest;
  vec3 toCam = uCamPos.xyz - vP; float dist = length(toCam); vec3 V = toCam/dist;
  vec4 wm = twWorld(vP.xz);
  if (wm.r > 0.45) discard;                              // the sea never lies on land: a swell that overtops a low shore is cut away
  float landK = 1.0 - smoothstep(0.08, 0.40, wm.r);      // ... and no surf is drawn where the map says ground
  float depth = max(-wm.r, 0.0); float shore = wm.g;
  float ta = clamp((-wm.r - 0.5)/22.0, 0.0, 1.0); float att = 0.16 + 0.84*ta*ta*(3.0 - 2.0*ta);
  float fp = max(length(dFdx(p)), length(dFdy(p)));     // metres of sea under one pixel
  float tt = uTime; float storm = uStorm; float sea = max(uMisc.w, 0.05);
  vec2 wd = normalize(uWind.xy + vec2(1e-5)); vec2 wp = vec2(-wd.y, wd.x);
  vec2 q = vec2(dot(p, wd), dot(p, wp));                // wind frame: x downwind, y across
  vec2 vo = p - uVortex.xy; float vR = max(uVortex.z, 1.0);

#ifdef OCEAN_LOW
  // phone path: interpolated vertex normal / pinch / height from twWave(), no per-pixel wave sum
  vec3 nn = vec3(vN.x/max(vN.y, 0.25), 0.0, vN.z/max(vN.y, 0.25));
  float hgt = vHC.x, sig2 = 0.0, lostF = 0.0;
  float pn = vHC.y/sea;
  float J = 1.0 - vHC.y*1.15, Jl = J + 0.10, Jm = 1.0;
#else
  // ---- the same Gerstner sum as twWave(), per pixel: normal, height and the Jacobian of the horizontal displacement
  // (now, and where it was 1.3 s ago). Each train fades out as it drops below the pixel footprint.
  vec3 nn = vec3(0.0); float hgt = 0.0, sig2 = 0.0, tot = 1e-5;
  float Jxx = 1.0, Jzz = 1.0, Jxz = 0.0, Lxx = 1.0, Lzz = 1.0, Lxz = 0.0, Mxx = 1.0, Mzz = 1.0, Mxz = 0.0;
  for (int i = 0; i < 8; i++){
    vec4 A = uWaveA[i]; vec4 B = uWaveB[i];
    float k = 6.283185307/A.w; float a = B.y*att;
    float lw = 1.0 - smoothstep(0.22, 0.70, fp/A.w);
    float ph = k*dot(A.xy, p) - B.x*k*tt + B.z;
    float s = sin(ph), c = cos(ph); vec4 jc = uJac[i]; float sl = s*jc.x + c*jc.y, sm = s*jc.z + c*jc.w;
    float wa = k*a; float wl = wa*lw; float qk = A.z*wl;
    nn.x -= A.x*wl*c; nn.z -= A.y*wl*c; nn.y -= qk*s;
    hgt += a*s;
    Jxx -= qk*A.x*A.x*s;  Jzz -= qk*A.y*A.y*s;  Jxz -= qk*A.x*A.y*s;
    Lxx -= qk*A.x*A.x*sl; Lzz -= qk*A.y*A.y*sl; Lxz -= qk*A.x*A.y*sl;
    Mxx -= qk*A.x*A.x*sm; Mzz -= qk*A.y*A.y*sm; Mxz -= qk*A.x*A.y*sm;
    sig2 += 0.5*wa*wa*(1.0 - lw*lw); tot += 0.5*wa*wa;
  }
  float J = Jxx*Jzz - Jxz*Jxz, Jl = Lxx*Lzz - Lxz*Lxz, Jm = Mxx*Mzz - Mxz*Mxz;
  float pn = (2.0 - Jxx - Jzz)/sea;
  float lostF = sig2/tot;
  if (uVortex.w > 0.001){
    float s2 = vR*vR*0.30; float vfun = uVortex.w*exp(-dot(vo, vo)/s2);
    nn.xz -= (vR*0.16*2.0*vo/s2)*vfun;
  }
#endif
  vec3 Nw = normalize(vec3(nn.x*1.4, 1.0 + nn.y, nn.z*1.4));   // the swell alone (slightly exaggerated so the forms read)

  // ---- baked chop: four scales, each drifting its own way round the wind; the mips relax it with distance
  float gust = 1.0, streakC = 0.0;
#ifndef OCEAN_LOW
  vec4 gm = twTexNoise(q*vec2(0.0024, 0.0043) - vec2(tt*0.010, tt*0.002));           // cat's-paws: gusts roughen patches
  gust = 0.68 + 0.64*smoothstep(0.36, 0.64, gm.r);
  float sk = twTexNoise(q*vec2(0.0052, 0.085) + (gm.rg - 0.5)*0.3 - vec2(tt*0.006, 0.0)).g;
  streakC = smoothstep(0.60, 0.73, sk)*storm*0.36;                                    // wind-rows
#endif
  float amp = min(mix(0.40, 1.0, storm) + 0.22*smoothstep(0.05, 0.9, uDawn), 1.0)*gust*mix(0.80, 1.0, att);
  float tpp = fp*${BAKE}.0;
#ifdef OCEAN_LOW
  vec4 c1 = chop(uDetB, q, vec2(0.8525, -0.5227), 10.3, 2.4, uDetK.y);
  vec4 c2 = chop(uDetA, q, vec2(0.6600, 0.7513), 2.9, 1.3, uDetK.x);
  vec2 g = (c1.xy*0.080 + c2.xy*0.060)*amp;
  float hd = (c1.z - uDetK.w)*0.6 + (c2.z - uDetK.z)*0.4;
  float crD = max(c1.w, c2.w*0.8);
  sig2 += amp*amp*(0.0064*lostMip(tpp/10.3) + 0.0036*lostMip(tpp/2.9)) + 0.004;
  float fine = (c2.z - uDetK.z) + 0.6*(c1.z - uDetK.w); float nearK = 1.0 - lostMip(tpp/2.9);
  float mid = c1.z - uDetK.w; float midK = 1.0 - lostMip(tpp/10.3);
#else
  vec4 c0 = chop(uDetA, q, vec2(0.9287, 0.3709), 31.0, 4.2, uDetK.x);
  vec4 c1 = chop(uDetB, q, vec2(0.8525, -0.5227), 10.3, 2.4, uDetK.y);
  vec4 c2 = chop(uDetA, q, vec2(0.6600, 0.7513), 3.7, 1.4, uDetK.x);
  vec4 c3 = chop(uDetB, q, vec2(0.9689, -0.2474), 1.27, 0.8, uDetK.y);
  float f0 = 1.0/(1.0 + dist/260.0), f1 = 1.0/(1.0 + dist/140.0);       // far away the ridging gives way to a broad glitter response
  vec2 g = (c0.xy*(0.085*f0) + c1.xy*(0.072*f1) + c2.xy*0.064 + c3.xy*0.058)*amp;
  sig2 += amp*amp*(0.0072*(1.0 - f0*f0) + 0.0052*(1.0 - f1*f1));
  float fine = (c3.z - uDetK.w) + 0.6*(c2.z - uDetK.z); float nearK = 1.0 - lostMip(tpp/3.7);
  float mid = (c1.z - uDetK.w) + 0.6*(c0.z - uDetK.z); float midK = 1.0 - lostMip(tpp/31.0);
  float hd = (c0.z - uDetK.z)*0.40 + (c1.z - uDetK.w)*0.30 + (c2.z - uDetK.z)*0.20 + (c3.z - uDetK.w)*0.10;
  float crD = max(max(c0.w*0.7, c1.w), c2.w*0.8);
  sig2 += amp*amp*(0.0072*lostMip(tpp/31.0) + 0.0052*lostMip(tpp/10.3) + 0.0041*lostMip(tpp/3.7) + 0.0034*lostMip(tpp/1.27));
#ifdef OCEAN_RAIN
  vec4 c4 = chop(uDetA, q, vec2(0.9950, 0.0998), 0.43, 0.45, uDetK.x);
  g += c4.xy*(0.045*amp); sig2 += amp*amp*0.0020*lostMip(tpp/0.43);
#endif
#endif

  // ---- wake
  vec2 wuv = (vP.xz - uWakeRect.xy)*uWakeRect.z + 0.5;
  vec2 wk = texture(uWake, wuv).rg;
  vec2 we = smoothstep(vec2(0.0), vec2(0.06), wuv)*smoothstep(vec2(0.0), vec2(0.06), 1.0 - wuv);
  wk *= we.x*we.y*uWakeRect.w;
  g *= 1.0 + wk.g*1.3;                                   // churned water astern is rougher

  vec2 gw = wd*g.x + wp*g.y;
#ifdef OCEAN_RAIN
  float rainK = smoothstep(0.25, 0.9, uRain)*(1.0 - smoothstep(22.0, 65.0, dist));
  if (rainK > 0.001) gw += (rainRing(p, 1.9, 0.0) + rainRing(p + 3.7, 3.1, 5.0))*(rainK*0.34);
#endif

  // ---- foam lace: carried by the surface itself (sampled at the DISPLACED position, so it rides the orbital motion),
  // drifting slowly downwind; three scales at three angles so no cell lattice can be read
  vec2 lq = vec2(dot(vP.xz, wd), dot(vP.xz, wp)) - vec2(tt*0.22, 0.0);
  vec4 la = texture(uLace, lq*vec2(0.052, 0.092));                                                   // long, wind-drawn
  vec4 lb = texture(uLace, vec2(lq.x*0.8 + lq.y*0.6, -lq.x*0.6 + lq.y*0.8)*vec2(0.170, 0.225) + vec2(0.37, 0.11));
#ifdef OCEAN_LOW
  float F = la.r*0.58 + lb.r*0.42; float relief = la.g*0.5 + lb.g*0.5; float bub = lb.a;
#else
  vec4 lc = texture(uLace, vec2(lq.x*0.6 - lq.y*0.8, lq.x*0.8 + lq.y*0.6)*0.560 + vec2(0.71, 0.53));
  float F = la.r*0.46 + lb.r*0.33 + lc.r*0.21; float relief = la.g*0.36 + lb.g*0.36 + lc.g*0.28; float bub = lc.a;
#endif

  // ---- maelstrom: thin, broken log-spiral arms over dark glassy water, black throat
  float cV = 0.0, throat = 0.0, vDark = 0.0;
  if (uVortex.w > 0.001){
    float r = length(vo); float rn = r/vR;
    float lr = log(max(rn, 0.02));
    float th = atan(vo.y, vo.x);
    vec2 uv = vec2(th*0.477465 + lr*1.9 - tt*0.15, lr*9.0 + tt*0.12);
    vec2 dox = dFdx(vo), doy = dFdy(vo); float r2 = max(r*r, 1.0);
    float dthx = (vo.x*dox.y - vo.y*dox.x)/r2, dthy = (vo.x*doy.y - vo.y*doy.x)/r2;
    float dlrx = dot(vo, dox)/r2, dlry = dot(vo, doy)/r2;
    vec2 gx = vec2(dthx*0.477465 + dlrx*1.9, dlrx*9.0), gy = vec2(dthy*0.477465 + dlry*1.9, dlry*9.0);
    vec4 sn = textureGrad(uNoiseTex, uv, gx, gy);
    float ring = smoothstep(1.25, 0.62, rn)*smoothstep(0.16, 0.36, rn);
    float rim = 1.0 - smoothstep(0.25, 0.85, rn);
    float sv = sn.r + (la.b - 0.5)*0.10;
    cV = (1.0 - smoothstep(0.006, 0.024 + 0.030*rim, abs(sv - 0.56 + 0.03*rim)))*smoothstep(0.40, 0.58, sn.g + rim*0.22)*ring*uVortex.w*0.80;
    throat = (1.0 - smoothstep(0.13, 0.36, rn))*uVortex.w;
    vDark = max(ring, throat)*uVortex.w;
    gw += (sn.rg - 0.5)*(ring*uVortex.w*0.9);
  }

  vec3 N = normalize(vec3(Nw.x + gw.x*Nw.y, Nw.y, Nw.z + gw.y*Nw.y));
  float ndv = dot(N, V);
  if (ndv < 0.03) { N = normalize(N + V*(0.03 - ndv)); ndv = dot(N, V); }
  ndv = max(ndv, 0.0);

  // ---- foam coverage: where the surface folds (Jacobian), where it folded a moment ago, shore, Maw, wind-rows, wake
  // ---- the hull sits IN the water: a small feathered contact shadow, and froth hugging her waterline
  vec2 bo = vP.xz - uBoat.xz; vec2 bf = vec2(sin(uBoat.w), cos(uBoat.w));
  float bl = dot(bo, bf), bs = bo.x*bf.y - bo.y*bf.x;
  float he = (bl*bl)/(2.95*2.95) + (bs*bs);
  float hullAO = 1.0 - 0.42*(1.0 - smoothstep(0.70, 1.22, he));
  float hx = (sqrt(he) - 1.03)/0.17;
  float hullFroth = exp(-hx*hx)*(0.16 + 0.62*sat(uBoatVel.z*0.22))*(0.35 + 1.30*la.b);

  // a breaker's life: dense core where the surface is folding NOW, webby lace where it folded ~1.2 s ago,
  // sparse wind-drawn streaks where it folded ~2.6 s ago
  float D = smoothstep(0.05, 0.9, uDawn);
  float jt = mix(0.60, 0.765, storm) + 0.13*D - 0.08*lostF;
  float cCap = pow(sat((jt - J + (crD - 0.40)*0.10)/0.11), 0.7);
#ifdef OCEAN_LOW
  cCap *= 0.80;                                             // vertex-rate pinch is broad: never let it fill solid
#endif
  float cT1 = sat((jt - 0.050 - Jl + (crD - 0.40)*0.08)/0.11)*0.56;
  float cT2 = sat((jt - 0.060 - Jm + (la.b - 0.5)*0.10)/0.13)*0.30;
  float cov = max(max(cCap, cT1), max(cT2, streakC*(0.5 + 0.5*sat(crD*2.0))));
  cov *= 1.0 - 0.9*vDark;
  float covOpen = cov;                                       // (the aerated halo below follows open-water foam only)
  float shoreFar = 0.0;
  if (shore < 80.0){
    // Surf all the way round every shore: a white broken line with trailing wash, wider and brighter where the coast faces
    // the swell, ragged along its length. Up close it is cut into lace like all other foam; far away (where the lace is
    // smaller than a pixel and its mips average out) it is drawn as a soft solid line so it never disappears.
    vec2 sg = vec2(twWorld(vP.xz + vec2(7.0, 0.0)).g, twWorld(vP.xz + vec2(0.0, 7.0)).g) - shore;
    float expo = sat(0.55 - 0.75*dot(sg/max(length(sg), 0.05), wd));
    float sn2 = la.b*2.0 - 1.0;
    float far = smoothstep(0.10, 0.55, fp);
    // along the shore the surf comes and goes: bright runs a few tens of metres long, gaps where it nearly dies, and a
    // width that swells and pinches, so it never reads as one painted stripe
    vec4 shv = twTexNoise(vP.xz*0.0061 + vec2(0.37, 0.71) + tt*0.0005);
    float run = smoothstep(0.26, 0.52, shv.r + 0.10*sn2*(1.0 - far));
    float wvar = 0.50 + 1.50*shv.g;
    float wS = ((9.0 + 8.0*expo)*(0.70 + 0.60*sat(0.5 + sn2)) + min(fp*4.6, 64.0))*wvar;
    float sdist = shore + sn2*1.5*(1.0 - far);
    float line = 1.0 - smoothstep(0.20*wS, wS, sdist);                    // a long feather seaward
    float inner = mix(0.70, 1.0, smoothstep(0.0, 0.12*wS, shore));        // and a soft landward edge: backwash, not a ruled line
    float wash = pow(max(0.5 + 0.5*sin(6.2831853*(shore/9.0 + tt*0.19) + sn2*3.0), 0.0), 10.0)*(1.0 - smoothstep(wS, wS*2.0 + 3.0, shore));
    cov = max(cov, max(line*(0.84 + 0.16*expo)*mix(0.30, 1.0, run), wash*(0.30 + 0.26*expo))*landK);
    cov = max(cov, smoothstep(1.0, 0.15, depth + sn2*0.8)*landK*mix(0.40, 1.0, run));
    shoreFar = line*(0.78 + 0.22*expo)*far*(0.26 + 0.74*run)*inner*landK;
  }
  cov = max(cov, hullFroth);
  cov = max(cov, cV);
  cov = max(cov, max(wk.r*0.90, wk.g*0.66));
  cov *= 1.0 - throat;
  float tF = mix(0.93, 0.30, cov);                           // even the heart of a breaker keeps dark holes
  float ew = 0.040 + sat(fp*0.6)*0.14;                       // soft but defined
  float foam = max(smoothstep(tF - ew, tF + ew, F)*smoothstep(0.0, 0.07, cov), shoreFar)*0.94;
  float thick = smoothstep(tF, tF + 0.30, F)*(0.70 + 0.30*bub);

  // ---- light
  float fl = sat(uFlash);
  float flashK = 1.0/(1.0 + 1.0*uFlash);
  vec3 Ns = normalize(vec3(N.x*0.5, 1.0, N.z*0.5));
  vec3 E = twIrradiance(vP, Ns);
  vec3 lan = twLanternAt(vP);
  vec3 Ll = uLantern.xyz - vP; float dl2 = dot(Ll, Ll); vec3 Lln = Ll*inversesqrt(dl2);
  vec3 Elan = lan*twWrap(dot(Ns, Lln), 0.45);
  float F0 = 0.045 + 0.955*pow(clamp(1.0 - ndv, 0.0, 1.0), 5.0);
  vec3 R0 = reflect(-V, N);
  vec3 R = normalize(vec3(R0.x, abs(R0.y) + 0.02, R0.z));
  vec3 refl = twSkyReflect(R);
  refl = mix(refl, vec3(0.84, 0.92, 1.0)*dot(refl, vec3(0.3, 0.5, 0.2)), 0.58*(1.0 - D));   // colder, steelier night reflections
  refl /= 1.0 + dot(refl, vec3(0.3, 0.5, 0.2))*mix(1.5, 0.20, D);     // tame the moon's halo in the mirror: the glade is made of glints, not a sheet

  // height occlusion: troughs (swell + chop) sit darker than crests
  float hN = hgt/(2.7*sea);
  float occ = mix(0.55, 1.0, smoothstep(-1.0, 0.7, hN))*clamp(0.92 + hd*1.5, 0.62, 1.15);

  // body: near-black indigo deep water; a subtle lift only over real shallows (< 5 m)
  vec3 scat = mix(vec3(0.005, 0.019, 0.025), vec3(0.008, 0.037, 0.040), smoothstep(-0.6, 1.0, hN));   // teal-black troughs
  scat = mix(scat, mix(vec3(0.004, 0.030, 0.046), vec3(0.008, 0.052, 0.064), smoothstep(-0.6, 1.0, hN)), D);                                                    // the morning sea is lighter, greener
  scat = mix(scat, vec3(0.030, 0.092, 0.086), max(smoothstep(8.0, 0.5, depth)*0.42, smoothstep(26.0 + min(fp*7.0, 90.0), 2.0, shore)*0.34)*(1.0 - 0.40*D));   // a paler, faintly turquoise band round every shore
  scat += vec3(0.020, 0.105, 0.110)*(sat((covOpen - 0.25)*1.4)*(1.0 - foam)*0.30 + sat(wk.g)*0.08);   // aerated water close under foam
  scat = mix(scat, vec3(0.90, 1.0, 1.18)*dot(scat, vec3(0.3, 0.5, 0.2)), 0.48*D);   // dawn: slate, not teal
  vec3 Eb = (E - Elan)*(flashK*mix(1.0, 0.40, D));          // no lantern on the water body at all: its light arrives only as glints
  vec3 body = scat*Eb*(1.35*occ);
  body += uAmbient.rgb*vec3(0.30, 0.70, 1.0)*(0.085*occ*(1.0 - D)*flashK);   // a little sky-lit lift so wave forms never crush to black
  body = mix(body, vec3(0.62, 0.74, 1.0)*(dot(body, vec3(0.3, 0.5, 0.2))*1.1), fl*0.75);   // lightning: steel, not turquoise
  body *= 1.0 - 0.55*vDark;
  body = mix(body, body*vec3(0.05, 0.06, 0.09), throat);

  // translucency — the Aivazovsky accent: only thin, steep crests that stand between the eye and the moon / sun
  float thin = smoothstep(0.55, 1.55, hN + pn*1.5 + hd*0.8);
  thin *= smoothstep(0.03, 0.22, 1.0 - Nw.y)/(1.0 + dist*0.004);
  vec3 tint = mix(vec3(0.034, 0.105, 0.090), vec3(0.100, 0.215, 0.165), thin*thin);   // grey-green jade, not neon
  vec3 Lf = normalize(uLightningPos.xyz - vP);
  vec3 sss = uMoonColor.rgb*(backlit(uMoonDir.xyz, Nw, V)*0.95);
  sss += uSunColor.rgb*(backlit(uSunDir.xyz, Nw, V)*0.30);
  sss += vec3(0.62, 0.74, 1.0)*(uFlash*backlit(Lf, Nw, V)*0.3);
  sss *= mix(tint, vec3(0.30, 0.42, 0.52), fl*0.8)*(thin*(1.0 - vDark));

  // glitter: one hard, energy-normalised lobe per light on the DETAILED normal. Its width follows the slope variance the
  // mips / footprint filter have already removed, so sparks near the eye relax into a soft path far away (no sparkle noise).
  float shin = clamp(1.0/(sig2 + 0.0040), 48.0, 250.0);     // 0.004: capillary roughness the textures cannot carry
  // light on water is always broken by the chop: near the eye only the little crests glint; far away (where the mips have
  // averaged the chop) the mask relaxes to an even fraction
  float farMask = 0.22 + 0.95*smoothstep(-0.30, 0.55, hN + hd*2.0);          // far away the swell itself breaks the path: crests glint, troughs do not
  float gmask = mix(mix(farMask, smoothstep(-0.03, 0.10, mid)*1.3, midK), smoothstep(-0.03, 0.09, fine)*1.3, nearK);
  vec3 spec = uMoonColor.rgb*(glit(N, V, uMoonDir.xyz, shin)*(0.035 + 0.9*F0)*0.21*gmask);
  spec += uSunColor.rgb*(glit(N, V, uSunDir.xyz, shin)*(0.035 + 0.9*F0)*0.12*gmask);
  // the long broken path under the low moon / sun: a vertically smeared lobe, cut into glints by the chop
  spec += (uMoonColor.rgb*(column(R0, uMoonDir.xyz, 55.0, 0.24)*0.085) + uSunColor.rgb*(column(R0, uSunDir.xyz, 42.0, 0.20)*0.360))*((0.12 + 0.88*gmask)*(0.25 + 0.75*F0));
  // a faint broad lobe: facets turned to the light lift a little, so the chop reads by value up close
  spec += uMoonColor.rgb*(pow(max(dot(N, normalize(uMoonDir.xyz + V)), 0.0), 22.0)*0.012) + uSunColor.rgb*(pow(max(dot(N, normalize(uSunDir.xyz + V)), 0.0), 14.0)*0.014);
  spec += vec3(0.62, 0.74, 1.0)*(uFlash*(glit(N, V, Lf, min(shin, 90.0))*0.05 + F0*0.30*smoothstep(-0.6, 0.9, hN)))*flashK;
  // firelight: a column of thin warm glints running from the flame toward the eye, smooth in strength, gone by ~14 m
  // (continuous on purpose: no masks or thresholds, only the wave-normal distribution breaks it up; the reflection vector
  //  uses a half-detailed normal so the column is made of soft streaks, not hard flecks)
  vec3 Rs = reflect(-V, normalize(mix(Nw, N, 0.80)));
  float lampK = (1.0 - smoothstep(0.012, 0.080, cov))*(1.0 - foam);       // foam is a diffuser: no lamp reflection where the water is foamy (soft ramp on coverage)
  spec += mix(uLanternColor.rgb, vec3(1.0, 0.84, 0.60), 0.45)*(uLantern.w*column(Rs, Lln, 70.0, 0.15)*0.19*lampK*exp(-dl2/36.0)*(1.0 - 0.55*D));
#ifndef OCEAN_LOW
  // lit beacons: the same, at any distance (thinned by the haze)
  int nb = int(uMisc.x);
  for (int i = 0; i < 8; i++){
    if (i >= nb) break;
    vec4 B = uBeacons[i];
    if (B.w > 0.001){
      vec3 Lb = B.xyz - vP; float db = length(Lb);
      float hk = i == nb - 1 ? uHeartB.z : 0.0;                 // the Heartlight, once lit: a stronger, longer, lasting path (it yields to the sun)
      spec += mix(uBeaconCol[i].rgb, vec3(1.0, 0.86, 0.64), 0.40)*(B.w*column(Rs, Lb/db, mix(460.0, 250.0, hk), mix(0.10, 0.075, hk))*0.16*(1.0 + 1.2*hk)*(1.0 - 0.8*D*hk)*mix(lampK, 1.0 - foam, 0.6*hk)*exp(-db*uFogColor.w*mix(0.9, 0.35, hk)));
    }
  }
#endif
  {
    // the ignition: a band of gold sweeps the sea with the front that opens the sky (radius uHeartA.z from the lamp),
    // carried by the wave faces turned to the lamp; and at the flash itself the water round the island lifts gold
    vec2 Lhx = uHeartA.xy - vP.xz; float dH = length(Lhx);
    vec3 Lh = normalize(vec3(Lhx.x, 60.0, Lhx.y));
    float face = sat(0.5 + 2.4*dot(N.xz, Lhx/max(dH, 1.0))); face *= face;
    float hxr = (dH - uHeartA.z)/24.0;
    float ring = step(1.0, uHeartA.z)*exp(-hxr*hxr)*(1.0 - smoothstep(420.0, 900.0, uHeartA.z));
    float hcolm = column(Rs, Lh, 380.0, 0.10)*(0.25 + 0.75*gmask);
    // the Heartlight's glade: a long warm path of glints from the island's foot toward the eye (the moon glade, in gold)
    vec2 ha = uCamPos.xz - uHeartA.xy; float hal = max(length(ha), 1.0); ha /= hal;
    float hs = dot(vP.xz - uHeartA.xy, ha), hl = dot(vP.xz - uHeartA.xy, vec2(-ha.y, ha.x)), hw = 4.0 + 0.045*max(hs, 0.0);
    float glade = exp(-hl*hl/(hw*hw))*smoothstep(10.0, 60.0, hs)*exp(-max(hs, 0.0)/700.0)*uHeartB.z*(1.0 - 0.85*D);
    float hgl = gmask*(1.0/1.3); hgl *= hgl*hgl;                 // only the brightest facets: sparks, not a sheet
    spec += vec3(1.0, 0.76, 0.42)*(glade*(0.002 + hgl*(0.026 + 0.10*smoothstep(-0.2, 0.8, hN + hd*2.0)))*(1.0 - foam));
    spec += vec3(1.0, 0.76, 0.40)*((ring*(0.006 + 0.04*face + 0.13*hcolm)*mix(lampK, 1.0, 0.25) + uHeartB.y*exp(-dH/170.0)*(0.0005 + 0.004*face + 0.016*hcolm)*lampK)*(1.0 - foam));
  }
  refl *= mix(1.0, 0.38 + 0.62*smoothstep(-0.5, 1.1, hN), fl);
  refl *= (1.0 - 0.45*throat)*(1.0 - 0.50*vDark)*mix(0.72, 1.0, occ)*clamp(0.90 + hd*2.6, 0.55, 1.25);   // chop troughs reflect less: keeps texture inside the moon glade

  // night grade of the water itself (not of the lights on it): colder, greyer, a stop down — the moon path, the
  // lantern and the foam carry the light
  // by day the body / mirror mix follows a smoother normal, so the morning sea grades evenly from gold to slate
  float Fm = mix(F0, max(0.045 + 0.955*pow(clamp(1.0 - max(dot(normalize(mix(Nw, N, 0.40)), V), 0.0), 0.0, 1.0), 5.0), 0.20), 0.85*D);
  vec3 wcol = body*(1.0 - Fm) + refl*Fm;
#ifndef OCEAN_LOW
  wcol *= mix(1.0, 0.70 + 0.62*smoothstep(0.30, 0.70, gm.g), smoothstep(50.0, 380.0, dist)*(1.0 - 0.85*D));   // far sea: broad cloud-shadow-like patches instead of flat navy
#endif
  wcol = mix(wcol, vec3(0.78, 0.93, 1.0)*dot(wcol, vec3(0.3, 0.5, 0.2)), 0.34*(1.0 - D))*mix(0.70, 1.0, D);
  vec3 col = wcol + sss*(1.0 - 0.5*F0) + spec;
  col *= hullAO;

  // foam is lit, never self-luminous, and never the brightest thing in the frame: blue-grey under the moon, warm by the
  // lantern, gold-pink at dawn; darker on the side of the swell turned from the light; thin edges darker, a lit rim
  vec3 Lmain = normalize(mix(uMoonDir.xyz, uSunDir.xyz, D));
  float fsh = (0.50 + 0.62*twWrap(dot(normalize(mix(Nw, N, 0.5)), Lmain), 0.35))*clamp(0.92 + hd*2.4, 0.66, 1.22);
  vec3 Ef = (E - Elan)*(fsh/(1.0 + 2.4*uFlash));
  float core = sat(cCap*cCap*1.2);                                                     // bright and dense at the crest line
  vec3 alb = mix(vec3(0.30, 0.38, 0.50), vec3(0.58, 0.60, 0.60), max(thick, shoreFar))*(0.60 + 0.40*max(core, shoreFar));
  vec3 foamCol = alb*Ef*(0.84 + 0.42*(relief - 0.5)*2.0) + scat*Eb*0.6;
  float fmax = mix(0.17, 1.05, D);                                                       // night: ~70 % value; by day foam must out-shine the bright water                                                       // ~70 % value after the grade
  float fk = dot(foamCol, vec3(0.3, 0.5, 0.2))/fmax; foamCol /= sqrt(sqrt(1.0 + fk*fk*fk*fk));
  // foam is a diffuser, not a mirror: lamp light on it is a pale gold wash, never a saturated orange patch
  foamCol = mix(foamCol, vec3(0.95, 0.99, 1.05)*dot(foamCol, vec3(0.3, 0.5, 0.2)), 0.80*(1.0 - D));
  foamCol = max(foamCol, mix(vec3(0.068, 0.079, 0.094), vec3(0.98, 0.90, 0.76), D)*shoreFar);   // the distant surf line: never darker than mid-grey by night, cream by day
  col = mix(col, foamCol*mix(1.0, hullAO, 0.25), foam);

  // ---- haze: the general fog, plus sea-level spray that swallows the water faster than the air above it
  // (the same band sits in the first degree of sky, so sea and sky melt together); the far rim is forced fully into it
  vec3 fogc = twFogColor(-V);
  float spray = 1.0 - exp(-max(dist - 140.0, 0.0)*mix(0.00042, 0.00095, storm)*mix(1.0, 0.55, D));
  float fa = max(max(twFogAmount(vP), spray*0.97), smoothstep(5200.0, 6800.0, dist));
  col *= 1.0 - 0.22*uHeartA.w;                              // the hush: the sea holds its breath too
  o = vec4(mix(col, fogc, fa), 1.0);
#ifdef OCEAN_DEBUG_SHORE
  o = vec4(fract(shore/10.0)*step(shore, 249.0), clamp(shore/60.0, 0.0, 1.0), clamp(depth/10.0, 0.0, 1.0), 1.0)*0.5;
#endif
}`;

  const WAKE_FS = `
in vec2 vUV; out vec4 o;
uniform sampler2D uPrev;
uniform ivec2 uShift;      // how many texels the window moved since uPrev was written
uniform vec3 uDecay;       // x,y = multipliers for R (thin fresh lines), G (churned band); z = constant drop
uniform float uDiffuse;
uniform vec4 uRect;        // xy = centre (world xz), z = size (m)
uniform vec4 uStamps[${MAX_STAMPS}];   // xy = world xz (segment start), z = radius, w = strength
uniform vec4 uStampsB[${MAX_STAMPS}];  // xy = segment end (= start for a round stamp), z = share written to R, w = share written to G
uniform int uCount;
void main(){
  ivec2 sz = textureSize(uPrev, 0);
  ivec2 ip = ivec2(gl_FragCoord.xy) + uShift;
  vec2 v = vec2(0.0);
  if (ip.x >= 1 && ip.y >= 1 && ip.x < sz.x - 1 && ip.y < sz.y - 1){
    vec2 c = texelFetch(uPrev, ip, 0).rg;
    vec2 nb = (texelFetch(uPrev, ip + ivec2(1, 0), 0).rg + texelFetch(uPrev, ip - ivec2(1, 0), 0).rg
             + texelFetch(uPrev, ip + ivec2(0, 1), 0).rg + texelFetch(uPrev, ip - ivec2(0, 1), 0).rg)*0.25;
    v = mix(c, nb, vec2(0.5, 1.0)*uDiffuse);
  }
  v = max(v*uDecay.xy - uDecay.z, 0.0);
  vec2 w = uRect.xy + (vUV - 0.5)*uRect.z;
  vec2 add = vec2(0.0);
  for (int i = 0; i < ${MAX_STAMPS}; i++){
    if (i >= uCount) break;
    vec4 s = uStamps[i]; vec4 e = uStampsB[i]; vec2 pa = w - s.xy; vec2 ba = e.xy - s.xy;
    vec2 dl = pa - ba*clamp(dot(pa, ba)/max(dot(ba, ba), 1e-4), 0.0, 1.0);
    add = max(add, e.zw*(s.w*exp(-dot(dl, dl)/(s.z*s.z*0.5))));
  }
  v = max(v, add);
  o = vec4(min(v, 1.0), 0.0, 1.0);
}`;

  // queue a stamp: a soft disc at (x, z), or a capsule from (x, z) to (x2, z2). toR / toG = share written to each channel.
  function stamp(x, z, strength, radius, toR, toG, x2, z2) {
    if (!(strength > 0.004) || !(radius > 0)) return;
    let k = nStamps;
    if (k >= MAX_STAMPS) {            // full: overwrite the weakest pending stamp if this one is stronger
      k = 0;
      for (let i = 1; i < MAX_STAMPS; i++) if (stamps[i * 4 + 3] < stamps[k * 4 + 3]) k = i;
      if (stamps[k * 4 + 3] >= strength) return;
    } else nStamps++;
    stamps[k * 4] = x; stamps[k * 4 + 1] = z; stamps[k * 4 + 2] = radius; stamps[k * 4 + 3] = strength > 1 ? 1 : strength;
    stampsB[k * 4] = x2 === undefined ? x : x2; stampsB[k * 4 + 1] = z2 === undefined ? z : z2;
    stampsB[k * 4 + 2] = toR; stampsB[k * 4 + 3] = toG;
  }
  function trackBoat() {
    const b = TW.state.boat;
    if (hCount) {
      const dx = b.x - hx[hHead], dz = b.z - hz[hHead], d2 = dx * dx + dz * dz;
      if (d2 > 64) hCount = 0;                      // teleport / respawn: forget the old track
      else if (d2 < HSTEP * HSTEP) return;
    }
    hHead = (hHead + 1) % HN; hx[hHead] = b.x; hz[hHead] = b.z; hh[hHead] = b.heading;
    if (hCount < HN) hCount++;
  }
  // The skiff's own wash, laid once per wake step:
  //  * a small curl at each bow shoulder and the two thin arms of a V trailing from the bow (capsules joining points of
  //    the recorded track, each pushed outward in proportion to its age) -> channel R, short-lived and crisp;
  //  * a band about one hull-width wide directly astern -> channel G, which breaks into lace as it decays over ~7 s.
  function ownWake() {
    const b = TW.state.boat, sp = Math.abs(b.speed || 0);
    if (sp < 0.3) return;
    const s = TW.saturate(sp / 5.0), fx = Math.sin(b.heading), fz = Math.cos(b.heading);
    stamp(b.x + fx * 2.0 + fz * 0.42, b.z + fz * 2.0 - fx * 0.42, 0.95 * s, 0.34, 1, 0.3, b.x + fx * 1.0 + fz * 0.80, b.z + fz * 1.0 - fx * 0.80);
    stamp(b.x + fx * 2.0 - fz * 0.42, b.z + fz * 2.0 + fx * 0.42, 0.95 * s, 0.34, 1, 0.3, b.x + fx * 1.0 - fz * 0.80, b.z + fz * 1.0 + fx * 0.80);
    stamp(b.x - fx * 2.5, b.z - fz * 2.5, 0.92 * s, 0.50, 0, 1, b.x - fx * 3.4, b.z - fz * 3.4);
    for (let side = -1; side <= 1; side += 2) {
      let px = 0, pz = 0, have = false;
      for (let i = 2; i < hCount; i += 3) {
        const k = (hHead - i + HN * 4) % HN, d = i * HSTEP, off = side * (0.55 + 0.17 * d);
        const cf = Math.cos(hh[k]), sf = Math.sin(hh[k]);
        const x = hx[k] + sf * 1.6 + cf * off, z = hz[k] + cf * 1.6 - sf * off;
        if (have) stamp(px, pz, s * Math.max(0.15, 0.80 - 0.05 * d), 0.24 + 0.008 * d, 1, 0.0, x, z);
        px = x; pz = z; have = true;
      }
    }
  }

  // Advance the wake texture: scroll with the boat (whole texels only, so nothing blurs), decay, diffuse, add stamps.
  function stepWake() {
    if (!wakeProg || !wakeProg.ok) return;
    const steps = Math.min(4, Math.floor(wakeT / WAKE_STEP));
    if (steps < 1 && nStamps < MAX_STAMPS - 6 && wakeValid) return;   // nothing due yet; stamps wait for the next step
    if (steps >= 1) ownWake();
    wakeT -= steps * WAKE_STEP; if (wakeT > WAKE_STEP * 4) wakeT = 0;
    const gl = TW.gl, b = TW.state.boat, texel = WAKE_SIZE / wakeN;
    const cx = Math.round(b.x / texel) * texel, cz = Math.round(b.z / texel) * texel;
    let sx = 0, sz = 0;
    if (wakeValid) { sx = Math.round((cx - wakeCx) / texel); sz = Math.round((cz - wakeCz) / texel); }
    else { sx = wakeN * 4; sz = wakeN * 4; }     // first frame: everything is "off the map" -> starts empty
    wakeCx = cx; wakeCz = cz; wakeValid = true;
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    wakeB.bind();
    wakeProg.use();
    wakeProg.setTex('uPrev', 0, wakeA.tex);
    gl.uniform2i(wakeProg.loc('uShift'), sx, sz);
    const dt = steps * WAKE_STEP;
    wakeProg.set3f('uDecay', Math.exp(-dt / 1.5), Math.exp(-dt / 3.4), steps * 0.55 / 255);
    wakeProg.set1f('uDiffuse', steps > 0 ? 0.05 : 0);
    wakeProg.set4f('uRect', cx, cz, WAKE_SIZE, 0);
    gl.uniform4fv(wakeProg.loc('uStamps[0]'), stamps);
    gl.uniform4fv(wakeProg.loc('uStampsB[0]'), stampsB);
    gl.uniform1i(wakeProg.loc('uCount'), nStamps);
    TW.glx.drawFS();
    nStamps = 0;
    const t = wakeA; wakeA = wakeB; wakeB = t;
    gl.enable(gl.DEPTH_TEST);
    if (TW.post && TW.post.scene) TW.post.scene.bind();
  }

  // Render `fs` once into a new BAKE² RGBA8 REPEAT texture; `fix(pixels)` may rewrite the pixels on the CPU (and returns
  // whatever statistics the caller wants); then build mips (+ anisotropic filtering where available).
  function bake(fs, name, setUniforms, fix) {
    const gl = TW.gl;
    gl.activeTexture(gl.TEXTURE0);
    const tex = TW.glx.texture({ w: BAKE, h: BAKE, wrap: 'REPEAT', filter: 'LINEAR' });
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.viewport(0, 0, BAKE, BAKE);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    const p = TW.glx.program(TW.glsl.fsvs, fs, name);
    p.use();
    if (setUniforms) setUniforms(p, gl);
    TW.glx.drawFS();
    let out = null;
    const px = new Uint8Array(BAKE * BAKE * 4);
    gl.readPixels(0, 0, BAKE, BAKE, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    if (p.prog) gl.deleteProgram(p.prog);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (fix) {
      out = fix(px);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, BAKE, BAKE, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
    const ext = gl.getExtension('EXT_texture_filter_anisotropic');
    if (ext) {
      const want = (TW.quality && TW.quality.level <= 0) ? 2 : 4;
      gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(want, gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 1));
    }
    gl.enable(gl.DEPTH_TEST);
    if (TW.q && TW.q.has('oceandbg')) (TW.ocean.debugTex || (TW.ocean.debugTex = {}))[name] = px;
    return { tex, out };
  }
  // statistics of a baked chop texture: gain that brings its slope to unit rms, and its mean height
  function chopStats(px) {
    let s2 = 0, hm = 0, clip = 0; const n = px.length / 4;
    for (let i = 0; i < px.length; i += 4) {
      const a = (px[i] - 127.5) / 127.5, b = (px[i + 1] - 127.5) / 127.5;
      s2 += a * a + b * b; hm += px[i + 2];
      if (px[i] === 0 || px[i] === 255 || px[i + 1] === 0 || px[i + 1] === 255) clip++;
    }
    const rms = Math.sqrt(s2 / n) || 1;
    return { gain: 1 / rms, mean: hm / n / 255, rms, clip: clip / n };
  }
  // histogram-equalise the lace field (R) so that "R > 1 - c" covers a fraction c of the surface
  function equaliseLace(px) {
    const hist = new Float64Array(256), n = px.length / 4;
    for (let i = 0; i < px.length; i += 4) hist[px[i]]++;
    const lut = new Uint8Array(256); let acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; lut[v] = Math.round(255 * (acc - hist[v] * 0.5) / n); }
    for (let i = 0; i < px.length; i += 4) px[i] = lut[px[i]];
    return null;
  }

  function compileVariant(q) {
    const def = (q <= 0 ? '#define OCEAN_LOW\n' : q >= 2 ? '#define OCEAN_RAIN\n' : '') + (TW.ocean.debugShore ? '#define OCEAN_DEBUG_SHORE\n' : '');
    return TW.glx.program(def + VS, def + FS, 'ocean-q' + q);
  }

  TW.ocean = {
    // swap the fragment path at run time (0 = phone, 1 = default, 2 = + a fifth chop layer and rain rings); keeps the old one if the new one fails
    setShaderQuality(q) { const p = compileVariant(q | 0); if (p.ok) { prog = p; lodK = (q | 0) <= 0 ? holeK : 0; } return p.ok; },

    init() {
      const gl = TW.gl, q = TW.quality ? TW.quality.level : 1;
      const M = q <= 0 ? 36 : q >= 2 ? 72 : 56;
      levels = q <= 0 ? 9 : 10;
      cell0 = EXTENT / (M * Math.pow(2, levels - 1));
      holeK = 1 / (M / 2 - 2); lodK = q <= 0 ? holeK : 0;
      mesh = buildMesh(M, levels);
      for (let i = 0; i < 8; i++) { const L = TW.env.waveSet[i][0], w = Math.sqrt(2 * Math.PI * 9.81 / L); jac[i * 4] = Math.cos(1.2 * w); jac[i * 4 + 1] = Math.sin(1.2 * w); jac[i * 4 + 2] = Math.cos(2.6 * w); jac[i * 4 + 3] = Math.sin(2.6 * w); }
      // baked detail: two different tiling chop patterns + the foam lace
      const a = bake(BAKE_WAVE_FS, 'ocean-bake-a', (p) => { p.set1f('uSeed', 1.37); p.set1i('uVar', 0); }, chopStats);
      const b = bake(BAKE_WAVE_FS, 'ocean-bake-b', (p) => { p.set1f('uSeed', 7.91); p.set1i('uVar', 1); }, chopStats);
      detA = a.tex; detB = b.tex;
      detK[0] = a.out.gain; detK[1] = b.out.gain; detK[2] = a.out.mean; detK[3] = b.out.mean;
      laceTex = bake(BAKE_LACE_FS, 'ocean-bake-lace', null, equaliseLace).tex;
      TW.ocean.bakeStats = { a: a.out, b: b.out };
      prog = compileVariant(q);
      wakeProg = TW.glx.program(TW.glsl.fsvs, WAKE_FS, 'ocean-wake');
      wakeN = q <= 0 ? 256 : 512;
      // RGBA8 on purpose: works with or without float render targets
      wakeA = TW.glx.target(wakeN, wakeN, { hdr: false, depth: false, filter: 'LINEAR' });
      wakeB = TW.glx.target(wakeN, wakeN, { hdr: false, depth: false, filter: 'LINEAR' });
      gl.clearColor(0, 0, 0, 1);
      wakeA.bind(); gl.clear(gl.COLOR_BUFFER_BIT);
      wakeB.bind(); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      wakeValid = false; wakeT = 0; nStamps = 0; hCount = 0;
    },

    // Leave a mark on the water at world (x, z): strength 0..1, radius in metres. Call every frame for a continuous
    // wake or once for a splash; stamps combine by maximum, so overlapping callers never over-brighten. External stamps
    // go to the churn channel (lace that breaks up as it fades) and are kept to about a hull-width.
    addWake(x, z, strength01, radiusM) { stamp(x, z, (strength01 === undefined ? 1 : strength01) * 0.75, Math.min((radiusM || 1.2) * 0.42, 0.55), 0, 1); },

    update(dt) {
      if (TW.state.phase === 'paused') return;
      wakeT += dt;
      trackBoat();
    },

    draw() {
      if (!prog || !prog.ok || !mesh) return;
      stepWake();
      const gl = TW.gl;
      prog.use();
      prog.set1f('uCell0', cell0);
      prog.set1f('uLodK', lodK);
      { const lj = prog.loc('uJac[0]'); if (lj) TW.gl.uniform4fv(lj, jac); }
      prog.setTex('uDetA', 1, detA);
      prog.setTex('uDetB', 2, detB);
      prog.setTex('uLace', 3, laceTex);
      prog.setTex('uWake', 0, wakeA.tex);
      prog.set4f('uWakeRect', wakeCx, wakeCz, 1 / WAKE_SIZE, wakeValid ? 1 : 0);
      prog.set4f('uDetK', detK[0], detK[1], detK[2], detK[3]);
      if (TW.sky && TW.sky.drift) gl.uniform4fv(prog.loc('uSkyDrift'), TW.sky.drift);
      if (TW.sky && TW.sky.heartU) { const hu = TW.sky.heartU(); gl.uniform4fv(prog.loc('uHeartA'), hu.subarray(0, 4)); gl.uniform4fv(prog.loc('uHeartB'), hu.subarray(4, 8)); }
      mesh.draw();
      gl.activeTexture(gl.TEXTURE0);
    },
  };
})();

