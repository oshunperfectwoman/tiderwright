// ===== 10-env.js =====
// ============================================================================
// TIDEWRIGHT — 10-env.js
// Shared game state (TW.state), the Env uniform block (UBO binding 0), global
// look-dev (moon / sun / fog / ambient derived from storm + dawn), the wave
// function (identical on CPU and GPU) and the shared GLSL chunks:
//   <env> <waves> <light> <fog>
// OWNER: lead. Other modules must not edit this file.
// ============================================================================
(function () {
  'use strict';
  const TW = window.TW, M = TW.M, SETTINGS = TW.settings;
  const env = (TW.env = {});

  // ---------------------------------------------------------------------------
  // Shared state. Game logic writes it, everything else reads it.
  // ---------------------------------------------------------------------------
  TW.state = {
    time: 0,          // seconds of simulated time (drives all animation; do not use performance.now for visuals)
    dt: 0,            // seconds since previous frame (clamped)
    frame: 0,
    phase: 'title',   // 'title' | 'sailing' | 'paused' | 'ending' | 'free' (free = sailing on after the ending)
    // Boat. heading h: forward = (sin h, 0, cos h). Local axes: +Z bow, +X starboard(right when looking to bow is -X; see contract), +Y up.
    boat: { x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0, vx: 0, vz: 0, speed: 0, rudder: 0, sail: 0.7, boom: 0.5, luff: 0, hull: 1, aground: 0 },
    lantern: { oil: 1, intensity: 1, flicker: 1 },
    wind: { dirX: SETTINGS.wind.direction[0], dirZ: SETTINGS.wind.direction[1], speed: SETTINGS.wind.initialSpeed, gust: 0 },   // trade wind from NE toward SW; dir = unit vector the wind blows TOWARD
    storm: 0.8,       // 0 calm .. 1 full gale. drives sea height, fog, cloud darkness
    rain: 0.6,        // 0..1
    flash: 0,         // lightning flash brightness, 0..~1.5, decays fast
    lightning: { x: 0, y: 420, z: 900, seed: 1 },            // position of the most recent bolt
    dawn: 0,          // 0..1 narrative sunrise during the ending
    daylight: 0.78,   // ordinary tropical daytime; unlike dawn, this is present during normal sailing
    tide: 0,          // sea level offset in metres
    vortexStrength: 0,// 0..1 strength of the maelstrom at TW.world.vortex
    beacons: [],      // [{ lit:0..1 (animated light level), kindled:bool, progress:0..1 }] parallel to TW.world.beacons
    litCount: 0,
    heart: { hush: 0, t: -1, x: 0, y: 0, z: 0 },   // the Heartlight ignition (GAME writes): hush 0..1 = the held breath before the lamp catches; t = seconds since ignition (-1 before); x,y,z = the lamp
    cam: { pos: [0, 5.5, -15], target: [0, 1.6, 0], up: [0, 1, 0], fov: 55, near: 0.3, far: 7000 },
  };

  // ---------------------------------------------------------------------------
  // Wave set. Wind-sea waves and the long north swell use separate fixed directions so the
  // crossed sea remains visible and continuous while the wind wanders.
  // [wavelength m, amplitude m at full storm, steepness Qc, direction offset rad, long-swell flag]
  // ---------------------------------------------------------------------------
  env.prevailing = Math.atan2(SETTINGS.wind.direction[0], SETTINGS.wind.direction[1]); // ENE/NE trade wind blows toward WSW
  env.swellPrevailing = SETTINGS.ocean.swellDirection; // long Atlantic swell comes from north and travels toward south (+Z)
  env.waveSet = SETTINGS.ocean.waveSet;
  env.seaScale = 1; // global multiplier on wave amplitude (set from storm each frame)
  const NW = 8;
  const waveA = new Float32Array(NW * 4), waveB = new Float32Array(NW * 4);
  function rebuildWaves() {
    for (let i = 0; i < NW; i++) {
      const w = env.waveSet[i], a = (w[4] ? env.swellPrevailing : env.prevailing) + w[3];
      const speed = Math.sqrt((9.81 * w[0]) / (2 * Math.PI));
      waveA[i * 4] = Math.sin(a); waveA[i * 4 + 1] = Math.cos(a); waveA[i * 4 + 2] = w[2]; waveA[i * 4 + 3] = w[0];
      waveB[i * 4] = speed; waveB[i * 4 + 1] = w[1] * env.seaScale; waveB[i * 4 + 2] = i * 1.7; waveB[i * 4 + 3] = 0;
    }
  }
  env.rebuildWaves = rebuildWaves;
  rebuildWaves();

  // Shallow-water attenuation: waves shrink over shoals and in the lee of the land.
  env.waveAtten = function (x, z) {
    const h = TW.world && TW.world.heightAt ? TW.world.heightAt(x, z) : -200;
    const t = TW.saturate((-h - 0.5) / 22.0);
    return 0.16 + 0.84 * t * t * (3 - 2 * t);
  };

  // Raw Gerstner displacement of the rest point (x, z). Writes out.x/y/z (offset) and out.nx/ny/nz (unit normal).
  const _o = { x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0 };
  env.wave = function (x, z, out, t) {
    out = out || _o;
    if (t === undefined) t = TW.state.time;
    const att = env.waveAtten(x, z);
    let dx = 0, dy = 0, dz = 0, nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < NW; i++) {
      const Dx = waveA[i * 4], Dz = waveA[i * 4 + 1], Q = waveA[i * 4 + 2], L = waveA[i * 4 + 3];
      const k = 6.283185307 / L, a = waveB[i * 4 + 1] * att;
      const ph = k * (Dx * x + Dz * z) - waveB[i * 4] * k * t + waveB[i * 4 + 2];
      const s = Math.sin(ph), c = Math.cos(ph), qa = Q * a, wa = k * a;
      dx += Dx * qa * c; dz += Dz * qa * c; dy += a * s;
      nx -= Dx * wa * c; nz -= Dz * wa * c; ny -= Q * wa * s;
    }
    // maelstrom funnel
    const vs = TW.state.vortexStrength, vx = TW.world && TW.world.vortex;
    if (vs > 0.001 && vx) {
      const ox = x - vx.x, oz = z - vx.z, R = vx.r, s2 = R * R * 0.30;
      const f = vs * Math.exp(-(ox * ox + oz * oz) / s2), D = R * 0.16;
      dy -= D * f; nx -= (D * 2 * ox / s2) * f; nz -= (D * 2 * oz / s2) * f;
    }
    out.x = dx; out.y = dy + TW.state.tide; out.z = dz;
    const l = Math.hypot(nx, 1 + ny, nz) || 1;
    out.nx = nx / l; out.ny = (1 + ny) / l; out.nz = nz / l;
    return out;
  };
  // Water surface height (and normal) AT world position (x, z) — inverts the horizontal Gerstner shift (2 iterations).
  env.seaHeight = function (x, z, out, t) {
    out = out || _o;
    env.wave(x, z, out, t);
    let px = x - out.x, pz = z - out.z;
    env.wave(px, pz, out, t);
    px = x - out.x; pz = z - out.z;
    env.wave(px, pz, out, t);
    return out.y;
  };

  // ---------------------------------------------------------------------------
  // Env uniform block (std140, binding 0). 260 floats.
  // ---------------------------------------------------------------------------
  const O = { view: 0, proj: 16, viewProj: 32, invViewProj: 48, camPos: 64, screen: 68, moonDir: 72, moonColor: 76, sunDir: 80, sunColor: 84,
    ambient: 88, weather: 92, wind: 96, fogColor: 100, lantern: 104, lanternColor: 108, lightningPos: 112, boat: 116, boatVel: 120, vortex: 124,
    misc: 128, beacons: 132, beaconCol: 164, waveA: 196, waveB: 228, SIZE: 260 };
  const buf = new Float32Array(O.SIZE);
  env.data = buf; env.offsets = O;
  let ubo = null;
  env.view = buf.subarray(0, 16); env.proj = buf.subarray(16, 32); env.viewProj = buf.subarray(32, 48); env.invViewProj = buf.subarray(48, 64);
  env.sceneW = 1; env.sceneH = 1; // size of the scene render target; set by TW.post.resize via env.setSceneSize
  env.setSceneSize = function (w, h) { env.sceneW = w; env.sceneH = h; };

  // look-dev outputs (linear HDR radiance), readable by JS modules too
  env.look = { moonDir: [0, 1, 0], moonColor: [0, 0, 0], sunDir: [0, 1, 0], sunColor: [0, 0, 0], ambient: [0, 0, 0], fogColor: [0, 0, 0], fogDensity: 0.001 };

  env.init = function () {
    const gl = TW.gl;
    ubo = gl.createBuffer();
    gl.bindBuffer(gl.UNIFORM_BUFFER, ubo);
    gl.bufferData(gl.UNIFORM_BUFFER, buf.byteLength, gl.DYNAMIC_DRAW);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, ubo);
  };

  const set4 = (o, a, b, c, d) => { buf[o] = a; buf[o + 1] = b; buf[o + 2] = c; buf[o + 3] = d; };
  const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const LANTERN_LOCAL = (env.lanternLocal = [0.0, 2.05, 2.55]); // lantern position in boat-local space (hangs from the bow crook)
  const boatMat = M.create();
  // Model matrix of the boat from TW.state.boat: T(x,y,z) * Ry(heading) * Rx(pitch) * Rz(roll)
  TW.boatMatrix = function (out) {
    const b = TW.state.boat;
    return M.fromTRS(out || boatMat, b.x, b.y, b.z, b.heading, b.pitch, b.roll);
  };
  env.lanternWorld = [0, 2, 0];

  // Called once per frame by main BEFORE rendering: derives lighting from state, builds camera matrices, uploads the UBO.
  env.update = function () {
    const S = TW.state, gl = TW.gl, L = env.look, cam = S.cam;
    const storm = TW.saturate(S.storm), dawn = TW.saturate(S.dawn), day = TW.saturate(Math.max(S.daylight || 0, dawn)), rain = TW.saturate(S.rain);

    // --- sea state ---
    env.seaScale = TW.lerp(0.40, 1.0, storm) * TW.lerp(1.0, 0.9, dawn) * SETTINGS.ocean.waveScale;
    rebuildWaves();

    // --- camera ---
    const aspect = env.sceneW / Math.max(1, env.sceneH);
    M.lookAt(env.view, cam.pos, cam.target, cam.up);
    M.perspective(env.proj, (cam.fov * Math.PI) / 180, aspect, cam.near, cam.far);
    M.multiply(env.viewProj, env.proj, env.view);
    M.invert(env.invViewProj, env.viewProj);

    // --- look-dev: night storm -> rose-gold dawn ---
    const night = 1 - day;
    L.moonDir = TW.V.norm([0.30, 0.30 - day * 0.36, -0.84]);   // the moon sets as the sun comes up
    const moonI = TW.lerp(1.55, 0.62, storm) * night;
    L.moonColor = [0.50 * moonI, 0.66 * moonI, 0.86 * moonI];
    const sunEl = TW.lerp(0.18, 0.42, day);
    L.sunDir = TW.V.norm([0.90, sunEl, -0.40]);
    const sunI = day * 5.2 * TW.lerp(1.0, 0.72, storm) * TW.lerp(1.0, 0.78, rain);
    L.sunColor = [1.0 * sunI, TW.lerp(0.54, 0.72, day) * sunI, TW.lerp(0.28, 0.48, day) * sunI];
    const ambN = [0.050, 0.075, 0.115], ambD = [0.34, 0.33, 0.42];
    L.ambient = mix3(V3scale(ambN, TW.lerp(1.35, 0.8, storm)), ambD, day);
    const fogN = mix3([0.030, 0.050, 0.078], [0.042, 0.050, 0.068], storm), fogD = [0.40, 0.27, 0.25], fogD2 = [0.36, 0.40, 0.50];
    L.fogColor = mix3(mix3(fogN, fogD, day), fogD2, TW.smoothstep(0.75, 1.0, day) * 0.55);
    L.fogDensity = TW.lerp(0.00032, 0.00105, storm) * TW.lerp(1, 0.6, day) + rain * 0.00040 * (1 - day);

    // --- lantern world position ---
    TW.boatMatrix(boatMat);
    const lw = M.transformPoint(boatMat, LANTERN_LOCAL);
    env.lanternWorld = lw;
    const lI = S.lantern.intensity * S.lantern.flicker;

    // --- fill the block ---
    set4(O.camPos, cam.pos[0], cam.pos[1], cam.pos[2], S.time);
    set4(O.screen, env.sceneW, env.sceneH, 1 / env.sceneW, 1 / env.sceneH);
    set4(O.moonDir, L.moonDir[0], L.moonDir[1], L.moonDir[2], 0);
    set4(O.moonColor, L.moonColor[0], L.moonColor[1], L.moonColor[2], 0);
    set4(O.sunDir, L.sunDir[0], L.sunDir[1], L.sunDir[2], 0);
    set4(O.sunColor, L.sunColor[0], L.sunColor[1], L.sunColor[2], 0);
    set4(O.ambient, L.ambient[0], L.ambient[1], L.ambient[2], 0.4);
    set4(O.weather, storm, rain, S.flash, dawn);
    set4(O.wind, S.wind.dirX, S.wind.dirZ, S.wind.speed * (1 + S.wind.gust), S.tide);
    set4(O.fogColor, L.fogColor[0], L.fogColor[1], L.fogColor[2], L.fogDensity);
    set4(O.lantern, lw[0], lw[1], lw[2], lI);
    set4(O.lanternColor, 1.0, 0.56, 0.20, 26.0);
    set4(O.lightningPos, S.lightning.x, S.lightning.y, S.lightning.z, S.lightning.seed);
    set4(O.boat, S.boat.x, S.boat.y, S.boat.z, S.boat.heading);
    set4(O.boatVel, S.boat.vx, S.boat.vz, S.boat.speed, S.boat.hull);
    const vx = TW.world && TW.world.vortex;
    if (vx) set4(O.vortex, vx.x, vx.z, vx.r, S.vortexStrength); else set4(O.vortex, 0, 0, 1, 0);
    const wb = (TW.world && TW.world.beacons) || [];
    const nb = Math.min(8, wb.length);
    set4(O.misc, nb, NW, TW.quality ? TW.quality.level : 1, env.seaScale);
    for (let i = 0; i < 8; i++) {
      const b = wb[i], sb = S.beacons[i];
      if (i < nb && b) {
        set4(O.beacons + i * 4, b.lamp[0], b.lamp[1], b.lamp[2], sb ? sb.lit : 0);
        const heart = b.isHeart ? 1 : 0;
        set4(O.beaconCol + i * 4, 1.0, heart ? 0.80 : 0.66, heart ? 0.52 : 0.30, S.time * (heart ? 0.42 : 0.55) + i * 1.9);
      } else { set4(O.beacons + i * 4, 0, -1000, 0, 0); set4(O.beaconCol + i * 4, 0, 0, 0, 0); }
    }
    buf.set(waveA, O.waveA); buf.set(waveB, O.waveB);
    gl.bindBuffer(gl.UNIFORM_BUFFER, ubo);
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, buf);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, ubo);
    // keep the shared textures bound on their reserved units
    gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, TW.glx.noiseTex);
    if (TW.world && TW.world.mapTex) { gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, TW.world.mapTex); }
    gl.activeTexture(gl.TEXTURE0);
  };
  function V3scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }

  // Project a world point to scene-target pixel coords (for DOM overlays). Returns [x01, y01(top=0), w] (w<=0: behind camera)
  env.project = function (p) {
    const m = env.viewProj, x = p[0], y = p[1], z = p[2];
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    const cx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w, cy = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
    return [cx * 0.5 + 0.5, 0.5 - cy * 0.5, w];
  };

  // ===========================================================================
  // GLSL chunks
  // ===========================================================================
  TW.glsl.env = `
layout(std140) uniform Env {
  mat4 uView; mat4 uProj; mat4 uViewProj; mat4 uInvViewProj;
  vec4 uCamPos;       // xyz camera position, w = time (s)
  vec4 uScreen;       // scene target: w, h, 1/w, 1/h
  vec4 uMoonDir;      // xyz = unit vector TOWARD the moon
  vec4 uMoonColor;    // rgb = moon radiance (already scaled by cloud cover / dawn)
  vec4 uSunDir;       // xyz = unit vector TOWARD the dawn sun
  vec4 uSunColor;     // rgb = sun radiance (0 at night)
  vec4 uAmbient;      // rgb = sky ambient radiance, w = ground-bounce fraction
  vec4 uWeather;      // x storm 0..1, y rain 0..1, z lightning flash 0..1.5, w dawn 0..1
  vec4 uWind;         // xy = wind direction in the xz plane (blows TOWARD), z = speed m/s (with gusts), w = tide (m)
  vec4 uFogColor;     // rgb base fog colour, w = density (1/m)
  vec4 uLantern;      // xyz world position of the skiff's lantern, w = intensity 0..~1.3 (0 = out)
  vec4 uLanternColor; // rgb, w = radius (m)
  vec4 uLightningPos; // xyz world position of the latest bolt, w = seed
  vec4 uBoat;         // xyz boat position, w = heading (rad). forward = (sin h, 0, cos h)
  vec4 uBoatVel;      // x = vx, y = vz, z = speed (m/s), w = hull 0..1
  vec4 uVortex;       // xy = maelstrom centre (world x, z), z = radius (m), w = strength 0..1
  vec4 uMisc;         // x = beacon count, y = wave count, z = quality level 0..2, w = sea scale
  vec4 uBeacons[8];   // xyz = lamp position, w = lit level 0..1
  vec4 uBeaconCol[8]; // rgb = light colour, w = beam sweep angle (rad)
  vec4 uWaveA[8];     // xy = direction (xz plane), z = steepness, w = wavelength (m)
  vec4 uWaveB[8];     // x = phase speed (m/s), y = amplitude (m), z = phase offset
};
#define uTime (uCamPos.w)
#define uStorm (uWeather.x)
#define uRain (uWeather.y)
#define uFlash (uWeather.z)
#define uDawn (uWeather.w)
#define TW_WORLD_HALF 1536.0
uniform sampler2D uWorldMap; // unit 7 (auto-bound). RGBA16F over world xz in [-1536, 1536]^2. R = terrain height (m; <0 = seabed), G = distance to nearest shore (m, 0 on land, clamped 250), B = island mask/biome noise, A = reserved
vec2 twWorldUV(vec2 xz){ return xz/(2.0*TW_WORLD_HALF)+0.5; }
vec4 twWorld(vec2 xz){ return textureLod(uWorldMap, twWorldUV(xz), 0.0); }
`;

  TW.glsl.waves = `
#include <env>
// Shallow-water attenuation (matches TW.env.waveAtten)
float twWaveAtten(vec2 p){ float h = twWorld(p).r; float t = clamp((-h-0.5)/22.0, 0.0, 1.0); return 0.16 + 0.84*t*t*(3.0-2.0*t); }
// Gerstner displacement of rest point p (world xz). Returns offset (xyz); n = unit surface normal.
// crest = 0..1 "how pinched is the crest here" (use for foam / translucency).
float twWaveMinL = 0.0;   // caller may set before twWave(): trains shorter than this (m) are dropped, fading in up to 2x
vec3 twWave(vec2 p, out vec3 n, out float crest){
  float t = uTime; float att = twWaveAtten(p);
  vec3 d = vec3(0.0); vec3 nn = vec3(0.0); float pinch = 0.0;
  for (int i=0;i<8;i++){
    vec4 A = uWaveA[i]; vec4 B = uWaveB[i];
    float k = 6.283185307/A.w; float a = B.y*att*clamp(A.w/max(twWaveMinL, 1e-3) - 1.0, 0.0, 1.0);
    float ph = k*dot(A.xy,p) - B.x*k*t + B.z;
    float s = sin(ph), c = cos(ph); float qa = A.z*a, wa = k*a;
    d.x += A.x*qa*c; d.z += A.y*qa*c; d.y += a*s;
    nn.x -= A.x*wa*c; nn.z -= A.y*wa*c; nn.y -= A.z*wa*s;
    pinch += A.z*wa*s;
  }
  if (uVortex.w > 0.001){
    vec2 o = p - uVortex.xy; float R = uVortex.z; float s2 = R*R*0.30;
    float f = uVortex.w*exp(-dot(o,o)/s2); float D = R*0.16;
    d.y -= D*f; nn.xz -= (D*2.0*o/s2)*f;
  }
  d.y += uWind.w;
  crest = clamp(pinch, 0.0, 1.0);
  n = normalize(vec3(nn.x, 1.0+nn.y, nn.z));
  return d;
}
`;

  TW.glsl.fog = `
#include <env>
// Colour of the haze in view direction dir (unit, camera -> point). The sky MUST converge to this at the horizon.
vec3 twFogColor(vec3 dir){
  vec3 c = uFogColor.rgb;
  float md = max(dot(dir, uMoonDir.xyz), 0.0);
  c += uMoonColor.rgb*(0.055*pow(md, 5.0));
  vec3 sdir = normalize(vec3(uSunDir.x, max(uSunDir.y, 0.02), uSunDir.z));
  float sd = max(dot(normalize(vec3(dir.x, dir.y*0.6, dir.z)), sdir), 0.0);
  c += uSunColor.rgb*(0.045*pow(sd, 3.0) + 0.16*pow(sd, 28.0));
  c += vec3(0.50, 0.62, 0.95)*(uFlash*0.10);
  return c;
}
float twFogAmount(vec3 P){
  float d = distance(P, uCamPos.xyz);
  float hf = exp(-max(P.y, 0.0)*0.010);
  return 1.0 - exp(-d*uFogColor.w*mix(0.30, 1.0, hf));
}
vec3 twFog(vec3 col, vec3 P){ return mix(col, twFogColor(normalize(P-uCamPos.xyz)), twFogAmount(P)); }
`;

  TW.glsl.light = `
#include <env>
// --- shared painterly lighting (linear HDR). P world pos, N unit normal, V unit vector from P to camera. ---
vec3 twAmbient(vec3 N){ float up = N.y*0.5+0.5; return uAmbient.rgb*mix(uAmbient.w, 1.0, up); }
float twWrap(float ndl, float w){ return clamp((ndl+w)/(1.0+w), 0.0, 1.0); }
// lantern radiance arriving at P (no N term)
vec3 twLanternAt(vec3 P){
  vec3 L = uLantern.xyz - P; float d2 = dot(L,L); float r = uLanternColor.w; float r0 = r*0.22;
  float a = uLantern.w/(1.0 + d2/(r0*r0)); a *= clamp(1.0 - d2/(r*r*12.0), 0.0, 1.0);
  return uLanternColor.rgb*(a*5.5);
}
// beacon i radiance arriving at P: soft omni glow + sweeping lighthouse beam
vec3 twBeaconAt(int i, vec3 P){
  vec4 B = uBeacons[i]; if (B.w <= 0.001) return vec3(0.0);
  vec3 L = B.xyz - P; float d2 = dot(L,L); if (d2 > 1.21e6) return vec3(0.0); float d = sqrt(d2);
  float omni = 1.0/(1.0 + d2/(22.0*22.0)); omni *= clamp(1.0 - d/420.0, 0.0, 1.0);
  float ang = uBeaconCol[i].w; vec2 bd = vec2(cos(ang), sin(ang));
  vec2 toP = -L.xz/max(length(L.xz), 0.001);
  float beam = pow(max(dot(toP, bd), 0.0), 90.0) + 0.6*pow(max(dot(toP, -bd), 0.0), 90.0);
  beam *= 1.0/(1.0 + d/160.0) * clamp(1.0 - d/1100.0, 0.0, 1.0);
  return uBeaconCol[i].rgb*B.w*(omni*3.2 + beam*1.6);
}
// total diffuse irradiance (wrap-lit for a soft, painted falloff)
vec3 twIrradiance(vec3 P, vec3 N){
  vec3 e = twAmbient(N);
  e += uMoonColor.rgb*twWrap(dot(N, uMoonDir.xyz), 0.35);
  e += uSunColor.rgb*twWrap(dot(N, uSunDir.xyz), 0.25);
  vec3 Lf = normalize(uLightningPos.xyz - P);
  e += vec3(0.62, 0.74, 1.0)*(uFlash*1.5*twWrap(dot(N, Lf), 0.3));
  vec3 Ll = uLantern.xyz - P;
  e += twLanternAt(P)*twWrap(dot(N, normalize(Ll)), 0.45);
  int nb = int(uMisc.x);
  for (int i=0;i<8;i++){ if (i>=nb) break; e += twBeaconAt(i, P)*twWrap(dot(N, normalize(uBeacons[i].xyz-P)), 0.5); }
  return e;
}
float twSpecTerm(vec3 N, vec3 V, vec3 L, float shin){ vec3 H = normalize(L+V); return pow(max(dot(N,H), 0.0), shin)*(shin+8.0)/25.0; }
// total specular radiance for a surface of roughness rough (0 mirror .. 1 matte)
vec3 twSpecular(vec3 P, vec3 N, vec3 V, float rough){
  float shin = mix(220.0, 6.0, clamp(rough, 0.0, 1.0));
  vec3 s = uMoonColor.rgb*twSpecTerm(N, V, uMoonDir.xyz, shin);
  s += uSunColor.rgb*twSpecTerm(N, V, uSunDir.xyz, shin);
  s += vec3(0.62, 0.74, 1.0)*(uFlash*1.4)*twSpecTerm(N, V, normalize(uLightningPos.xyz-P), shin);
  s += twLanternAt(P)*twSpecTerm(N, V, normalize(uLantern.xyz-P), shin);
  int nb = int(uMisc.x);
  for (int i=0;i<8;i++){ if (i>=nb) break; if (uBeacons[i].w>0.001) s += twBeaconAt(i, P)*twSpecTerm(N, V, normalize(uBeacons[i].xyz-P), shin); }
  return s;
}
// convenience: fully lit opaque surface
vec3 twLight(vec3 P, vec3 N, vec3 V, vec3 albedo, float rough, float spec){
  return albedo*twIrradiance(P, N) + spec*twSpecular(P, N, V, rough);
}
`;
})();

