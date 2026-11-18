// ===== 41-fx.js =====
// ============================================================================
// TIDEWRIGHT — 41-fx.js
// Weather and particles: rain, spray / splashes / embers / kindling motes /
// sparkles, the lantern halo, lightning bolts, sea-mist wisps, dawn gulls,
// and the skiff's wake. Everything is instanced and pooled; no per-frame
// allocation. OWNER: agent BOAT-FX.
// ============================================================================
(function () {
  'use strict';
  const TW = window.TW;

  let gl = null, ready = false, rnd = null;
  let rainProg, partProg, haloProg, boltProg, mistProg, gullProg, threadProg, threadMesh, threadCount = 0;
  let rainMesh, partMesh, boltMesh, mistMesh, gullMesh, quadMesh;
  let rainCount = 0, mistCount = 0, gullCount = 0;

  // ---------------------------------------------------------------- instanced mesh helper
  // corners: per-vertex data (triangle strip); instance buffer is interleaved with `stride` floats.
  function instMesh(corners, csize, stride, attrs, maxInst, usage) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const cb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cb);
    gl.bufferData(gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, csize, gl.FLOAT, false, 0, 0);
    const ib = gl.createBuffer(), data = new Float32Array(maxInst * stride);
    gl.bindBuffer(gl.ARRAY_BUFFER, ib);
    gl.bufferData(gl.ARRAY_BUFFER, data, usage || gl.DYNAMIC_DRAW);
    for (let i = 0; i < attrs.length; i++) {
      const a = attrs[i];
      gl.enableVertexAttribArray(a.loc);
      gl.vertexAttribPointer(a.loc, a.size, gl.FLOAT, false, stride * 4, a.off * 4);
      gl.vertexAttribDivisor(a.loc, 1);
    }
    gl.bindVertexArray(null);
    const nverts = corners.length / csize;
    return {
      vao, ib, data, stride, nverts,
      upload(n) { gl.bindBuffer(gl.ARRAY_BUFFER, ib); gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, Math.max(1, n) * stride); },
      draw(n) { if (n > 0) { gl.bindVertexArray(vao); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, nverts, n); } },
    };
  }

  // ---------------------------------------------------------------- shaders
  const RAIN_VS = `
#include <noise>
#include <light>
#include <fog>
layout(location=0) in vec2 aCorner;
layout(location=4) in vec4 aSeed;
uniform vec3 uBox;
uniform vec3 uVel;
uniform vec3 uOff;
uniform vec3 uTravel;
uniform vec4 uHeart;    // xyz = Heartlight lamp, w = radius of its light front (m), < 0 = none
uniform vec4 uHeartK;   // x = gold strength
out vec2 vC; out vec3 vCol;
void main(){
  float r1 = fract(aSeed.x*37.7 + aSeed.y*91.3), r2 = fract(aSeed.z*53.1 + aSeed.x*17.9);
  vec3 vel = uVel*(0.82 + 0.36*r1);
  vec2 jit = (vec2(r2, fract(r2*7.13)) - 0.5)*0.7; vel.xz += jit;
  vec3 ctr = uCamPos.xyz + uOff;
  vec3 w = aSeed.xyz*uBox + uTravel*(0.82 + 0.36*r1) + vec3(jit.x, 0.0, jit.y)*uTime;
  vec3 rel = mod(w - ctr, uBox) - 0.5*uBox;
  vec3 P = ctr + rel;
  vec3 dir = normalize(vel);
  float len = length(vel)*0.024*(0.6 + 0.8*r2)*uHeartK.z;
  vec3 toCam = uCamPos.xyz - P; float dist = length(toCam);
  vec3 side = normalize(cross(dir, toCam));
  float px = 2.0*dist/(uProj[1][1]*uScreen.y);            // world size of one scene pixel out there
  float wid = max(0.004, px*0.8);                          // a hairline: ~1.5 px with a soft profile
  vec3 pos = P - dir*(len*aCorner.y) + side*(wid*aCorner.x);
  vec3 e = abs(rel)/(0.5*uBox);
  float edge = 1.0 - smoothstep(0.75, 1.0, max(e.x, max(e.y, e.z)));
  // sparse and faint close to the eye, clearest at mid-distance, thinning into the murk
  float a = edge*smoothstep(3.5, 11.0, dist)*mix(0.35, 1.0, smoothstep(42.0, 16.0, dist));
  a *= clamp(0.25 + 1.0*twNoise(P.xz*0.07 + vec2(0.5, 0.866)*(uTime*0.6)), 0.0, 1.0);     // gusting curtains
  a *= 0.45 + 0.55*r1;
  vec3 vd = -toCam/max(dist, 0.001);
  // Rain is drawn with MAX blending: it can only ever lift a pixel up to its own colour, which is the colour of
  // the air it falls through. So it shows against dark sea and cloud, vanishes against anything brighter,
  // and only the lantern or a lightning flash can make it bright.
  vec3 Lv = uLantern.xyz - P; float d2 = dot(Lv, Lv);
  vec3 lit = twFogColor(vd)*1.25 + uAmbient.rgb*0.6 + uSunColor.rgb*0.05
           + vec3(0.62, 0.74, 1.0)*(min(uFlash, 1.2)*0.45)
           + uLanternColor.rgb*(uLantern.w*1.6/(1.0 + d2/2.0)*smoothstep(40.0, 10.0, d2));     // warm only within the lantern's reach
  int nb = int(uMisc.x);
  for (int i = 0; i < 8; i++) { if (i >= nb) break; lit += min(twBeaconAt(i, P)*0.12, vec3(0.03)); }   // a beam may tint the rain, never set it alight
  if (uHeart.w >= 0.0) {   // the ignition: drops flare gold as the light front passes, and the rain dies behind it
    // A brief, delicate glitter: only drops inside the ~20 m front, only about three in ten of them, at their normal
    // hairline size, never more than ~2.5x a moonlit streak; behind the front the rain is simply gone.
    float dL = distance(P, uHeart.xyz); float q = (dL - uHeart.w)/8.0;
    float band = exp(-q*q)*step(0.70, fract(aSeed.y*61.7 + aSeed.z*17.3))*uHeartK.x;
    float lum = dot(lit, vec3(0.3333));
    lit = mix(lit, vec3(1.0, 0.70, 0.26)*(lum*2.5), band);
    a *= smoothstep(uHeart.w - 26.0, uHeart.w - 4.0, dL);
  }
  vCol = lit*(a*0.85*uHeartK.y);
  vC = aCorner;
  gl_Position = uViewProj*vec4(pos, 1.0);
}`;
  const RAIN_FS = `
in vec2 vC; in vec3 vCol; out vec4 o;
void main(){
  float prof = 1.0 - vC.x*vC.x; prof *= prof;
  float tail = smoothstep(0.0, 0.3, vC.y)*smoothstep(1.0, 0.45, vC.y);
  o = vec4(vCol*(prof*tail), 0.0);
}`;

  // particle types: 0 spray, 1 splash, 2 ember, 3 kindle, 4 sparkle, 5 spindrift
  const PART_VS = `
#include <light>
#include <fog>
layout(location=0) in vec2 aCorner;
layout(location=4) in vec4 aI0;   // xyz, size
layout(location=5) in vec4 aI1;   // life 0..1, type, seed, -
layout(location=6) in vec4 aI2;   // velocity
out vec2 vC; out vec4 vCol; out vec3 vK;   // vK: type, life, seed
void main(){
  vec3 P = aI0.xyz; float size = aI0.w; float life = aI1.x; float type = aI1.y;
  vec3 camR = vec3(uView[0][0], uView[1][0], uView[2][0]);
  vec3 camU = vec3(uView[0][1], uView[1][1], uView[2][1]);
  vec3 camF = cross(camU, camR);
  vec3 a1 = camR, a2 = camU; float stretch = 1.0;
  bool lit = type < 1.5 || type > 4.5;
  float thin = 1.0;
  if (lit) {
    vec3 vv = aI2.xyz - camF*dot(aI2.xyz, camF);
    float sp = length(vv);
    if (type > 4.5) size *= 1.0 + life*1.2;
    else {   // droplets never go sub-pixel; they dim instead
      float px = 2.0*distance(P, uCamPos.xyz)/(uProj[1][1]*uScreen.y);
      size *= 1.0 - 0.35*life; float want = clamp(size, 0.7*px, 2.2*px); thin = min(size/want, 1.0); size = want;
    }
    if (sp > 0.3) { a1 = vv/sp; a2 = cross(camF, a1); stretch = type > 4.5 ? 1.0 + min(sp*0.75, 11.0) : 1.0 + min(sp*0.010/size, 4.0); }   // droplets smear into short streaks (~1/70 s of travel)
  } else {
    float tw = 0.75 + 0.25*sin(uTime*(11.0 + aI1.z*9.0) + aI1.z*40.0);
    size *= tw*(type < 2.5 ? 1.0 - 0.5*life : 1.0);
    float pxm = 2.0*distance(P, uCamPos.xyz)/(uProj[1][1]*uScreen.y);
    size = max(size, pxm*(type < 2.5 ? 1.0 : (type < 3.5 ? 1.3 : 1.6)));          // sparks stay readable far off
    if (type > 2.5 && type < 3.5) {   // kindling motes trail along their flight
      vec3 vv = aI2.xyz - camF*dot(aI2.xyz, camF); float sp = length(vv);
      if (sp > 0.3) { a1 = vv/sp; a2 = cross(camF, a1); stretch = 1.0 + min(sp*0.12, 2.2); }
    }
  }
  vec3 pos = P + a1*(aCorner.x*size*stretch) + a2*(aCorner.y*size);
  float fogA = twFogAmount(P);
  vec3 col; float a;
  if (lit) {
    vec3 e = uAmbient.rgb*1.7 + uMoonColor.rgb*0.8 + uSunColor.rgb*0.5 + vec3(0.62, 0.74, 1.0)*(uFlash*1.2);
    { vec3 Lv = uLantern.xyz - P; e += uLanternColor.rgb*(uLantern.w*(type > 4.5 ? 0.15 : 0.55)/(1.0 + dot(Lv, Lv)/1.0)); }   // the nearest droplets catch the lantern as warm sparks
    int nb = int(uMisc.x);
    for (int i = 0; i < 8; i++) { if (i >= nb) break; e += twBeaconAt(i, P)*0.4; }
    col = mix(e*0.85, twFogColor(normalize(P - uCamPos.xyz)), fogA);
    a = type > 4.5 ? smoothstep(0.0, 0.10, life)*pow(1.0 - life, 0.7)*0.16 : pow(1.0 - life, 0.6)*0.7*thin;
    a *= type > 4.5 ? smoothstep(7.0, 20.0, distance(P, uCamPos.xyz)) : smoothstep(1.5, 5.0, distance(P, uCamPos.xyz));   // droplets blown past the lens must not become giant blobs
  } else {
    float fade = smoothstep(0.0, 0.1, life)*(1.0 - life);
    if (type < 2.5) col = vec3(1.0, 0.40, 0.09)*(7.0*fade*(1.0 - life));
    else if (type < 3.5) col = mix(vec3(1.0, 0.66, 0.24), vec3(1.0, 0.36, 0.08), life)*(10.0*fade);
    else col = mix(vec3(1.0, 0.85, 0.50), vec3(0.55, 1.0, 0.85), fract(aI1.z*7.3))*(7.0*fade);
    col *= 1.0 - fogA;
    a = 1.0;
  }
  vCol = vec4(col, a); vC = aCorner; vK = vec3(type, life, aI1.z);
  gl_Position = uViewProj*vec4(pos, 1.0);
}`;
  const PART_FS = `
#include <noise>
in vec2 vC; in vec4 vCol; in vec3 vK; out vec4 o;
void main(){
  float r = length(vC);
  if (vK.x < 1.5) {                       // water droplets: small, crisp, bright-cored
    float a = smoothstep(1.0, 0.55, r)*vCol.a;
    o = vec4(vCol.rgb*(a*(0.75 + 0.5*smoothstep(0.7, 0.0, r))), a);
  } else if (vK.x > 4.5) {                // spindrift: a thin torn veil
    float n = twTexNoise(vC*vec2(1.3, 0.22) + vK.z*vec2(3.1, 7.7) + vec2(vK.y*0.3, 0.0)).r;
    float body = (1.0 - vC.y*vC.y)*smoothstep(1.0, 0.3, abs(vC.x));
    float a = body*body*smoothstep(0.36 + 0.3*vK.y, 0.66 + 0.25*vK.y, n + 0.2*body)*vCol.a;
    o = vec4(vCol.rgb*a, a);
  } else if (vK.x < 3.5) {
    float g = exp(-r*r*7.0)*0.55 + exp(-r*r*60.0)*2.0;
    g *= smoothstep(1.0, 0.7, r);
    o = vec4(vCol.rgb*g, 0.0);
  } else {
    vec2 q = abs(vC);
    float star = exp(-q.x*18.0)*exp(-q.y*3.0) + exp(-q.y*18.0)*exp(-q.x*3.0);
    float g = (star*1.2 + exp(-r*r*40.0)*1.5)*smoothstep(1.0, 0.7, r);
    o = vec4(vCol.rgb*g, 0.0);
  }
}`;

  const HALO_VS = `
#include <env>
layout(location=0) in vec2 aCorner;
uniform vec4 uPosSize; uniform vec4 uCol;   // uCol.a = pull toward the camera (m)
out vec2 vC;
void main(){
  vec3 camR = vec3(uView[0][0], uView[1][0], uView[2][0]);
  vec3 camU = vec3(uView[0][1], uView[1][1], uView[2][1]);
  vec3 P = uPosSize.xyz; P += normalize(uCamPos.xyz - P)*uCol.a;
  vC = aCorner;
  gl_Position = uViewProj*vec4(P + (camR*aCorner.x + camU*aCorner.y)*uPosSize.w, 1.0);
}`;
  const HALO_FS = `
#include <fog>
in vec2 vC; uniform vec4 uCol; uniform vec4 uPosSize; out vec4 o;
void main(){
  float r = length(vC);
  float g = (exp(-r*r*9.0) + 0.35*exp(-r*r*2.6))*smoothstep(1.0, 0.55, r);
  o = vec4(uCol.rgb*g*(1.0 - 0.8*twFogAmount(uPosSize.xyz)), 0.0);
}`;

  const BOLT_VS = `
#include <fog>
layout(location=0) in vec2 aCorner;   // x 0..1 along, y -1..1 across
layout(location=4) in vec4 aA;        // xyz, width (m)
layout(location=5) in vec4 aB;        // xyz, brightness
uniform float uVis;
out vec2 vC; out float vBr;
void main(){
  vec3 A = aA.xyz, B = aB.xyz;
  vec3 ax = B - A; float L = max(length(ax), 0.001); vec3 d = ax/L;
  vec3 mid = mix(A, B, aCorner.x);
  vec3 toCam = uCamPos.xyz - mid; float dist = length(toCam);
  vec3 side = normalize(cross(d, toCam));
  float px = 2.0*dist/(uProj[1][1]*uScreen.y);
  float w = max(aA.w, px*1.7*(0.35 + 0.65*aB.w));     // the HDR core blooms to ~3 px even when the channel is sub-pixel
  vec3 P = mid + d*((aCorner.x - 0.5)*w*0.8) + side*(aCorner.y*w*3.0);
  vC = aCorner; vBr = aB.w*uVis*(1.0 - 0.35*twFogAmount(mid));
  gl_Position = uViewProj*vec4(P, 1.0);
}`;
  const BOLT_FS = `
in vec2 vC; in float vBr; out vec4 o;
void main(){
  float x = vC.y;
  float core = exp(-x*x*36.0), sheath = exp(-x*x*5.0)*(1.0 - x*x);
  vec3 c = vec3(0.90, 0.94, 1.0)*(core*46.0) + vec3(0.30, 0.36, 1.0)*(sheath*2.2);   // white-hot channel, thin blue-violet corona
  o = vec4(c*vBr, 0.0);
}`;

  // rain curtains: big soft veils of streaked rain hanging in the mid-distance, slanted with the wind
  const MIST_VS = `
#include <light>
#include <fog>
layout(location=0) in vec2 aCorner;
layout(location=4) in vec4 aSeed;
uniform vec3 uBox;
uniform vec2 uDrift;
uniform vec4 uFall;      // xyz = unit direction the rain falls, w = amount 0..1
uniform vec4 uHeart;
uniform vec4 uHeartK;
out vec2 vC; out vec4 vCol; out vec2 vU;
void main(){
  vec3 w = aSeed.xyz*uBox + vec3(uDrift.x, 0.0, uDrift.y)*(0.8 + 0.4*aSeed.w);
  vec2 rel = mod(w.xz - uCamPos.xz, uBox.xz) - 0.5*uBox.xz;
  float dist = length(rel);
  float wdt = 34.0 + 38.0*aSeed.w, hgt = 30.0 + 24.0*aSeed.y;
  vec3 base = vec3(uCamPos.x + rel.x, uWind.w - 1.0, uCamPos.z + rel.y);
  vec3 toC = normalize(vec3(-rel.x, 0.0, -rel.y) + vec3(1e-4, 0.0, 0.0));
  vec3 right = vec3(toC.z, 0.0, -toC.x);
  vec3 up = -uFall.xyz;
  float v01 = aCorner.y*0.5 + 0.5;
  vec3 pos = base + right*(aCorner.x*wdt) + up*(v01*hgt/max(up.y, 0.35));
  vec2 e = abs(rel)/(0.5*uBox.xz);
  float a = (1.0 - smoothstep(0.72, 1.0, max(e.x, e.y)))*smoothstep(26.0, 62.0, dist);
  a *= uFall.w*(0.5 + 0.5*aSeed.w);
  vec3 mid = base + vec3(0.0, hgt*0.4, 0.0);
  vec3 vd = normalize(mid - uCamPos.xyz);
  // A veil is only ever the colour of hazy air: a few percent above the dark behind it. It is drawn with MAX blending,
  // so veils never stack and can never out-shine what is already there. No beacon term: they are not light shafts.
  vec3 lit = twFogColor(vd)*1.28 + uAmbient.rgb*0.42 + uMoonColor.rgb*(0.02 + 0.20*pow(max(dot(vd, uMoonDir.xyz), 0.0), 4.0))
           + uSunColor.rgb*0.03 + vec3(0.62, 0.74, 1.0)*(min(uFlash, 1.2)*0.25);
  if (uHeart.w >= 0.0) {
    float dL = distance(mid.xz, uHeart.xz); float q = (dL - uHeart.w)/16.0;
    lit = mix(lit, vec3(1.0, 0.72, 0.30)*(dot(lit, vec3(0.3333))*1.6), exp(-q*q)*uHeartK.x*0.3);   // the faintest warm breath on the veil
    a *= smoothstep(uHeart.w - 60.0, uHeart.w - 8.0, dL);
  }
  lit *= 1.0 + uHeartK.y;   // in the held breath the veils carry the weather: lift them against the darkened frame
  vCol = vec4(lit, a); vC = aCorner;
  vU = vec2(aCorner.x*wdt*0.03 + aSeed.x*9.0, v01*hgt*0.012 + uTime*0.10 + aSeed.z*5.0);
  gl_Position = uViewProj*vec4(pos, 1.0);
}`;
  const MIST_FS = `
#include <noise>
in vec2 vC; in vec4 vCol; in vec2 vU; out vec4 o;
void main(){
  float ex = 1.0 - vC.x*vC.x; ex *= ex;
  float ey = smoothstep(-1.0, -0.8, vC.y)*smoothstep(1.0, 0.1, vC.y);
  float streak = twTexNoise(vec2(vU.x, vU.y*0.10)).r;                 // broad, feathered variation along the fall line
  float blot = twTexNoise(vec2(vU.x*0.3, vU.y*0.22) + 0.37).g;        // large ragged density
  float a = ex*ey*smoothstep(0.20, 0.80, blot)*(0.78 + 0.22*smoothstep(0.25, 0.75, streak))*vCol.a;
  o = vec4(vCol.rgb*a, 0.0);
}`;

  // the kindling: a fine thread of sparks climbing from the skiff's lantern to the lamp room
  const THREAD_VS = `
#include <fog>
layout(location=0) in vec2 aCorner;
layout(location=4) in vec4 aSeed;     // phase, angle, random, order
uniform vec3 uA; uniform vec3 uB; uniform vec3 uC;   // lantern, lamp, bend
uniform vec4 uTh;                     // head, cut, density, brightness
uniform vec4 uTh2;                    // flow, tightness, hush, -
out vec2 vC; out vec3 vCol;
void main(){
  float r1 = fract(aSeed.z*7.31 + aSeed.x*3.17), r2 = fract(aSeed.z*13.7 + aSeed.y*5.9);
  float s = fract(aSeed.x + uTh2.x*(0.15 + 0.07*r1)); s = s*sqrt(s);   // sparks linger low, so the thread is as full by the skiff as by the tower
  float k = 1.0 - s;
  vec3 P = uA*(k*k) + uC*(2.0*s*k) + uB*(s*s);
  vec3 T = normalize((uC - uA)*k + (uB - uC)*s);
  vec3 n1 = normalize(cross(T, vec3(0.0, 1.0, 0.13))), n2 = cross(T, n1);
  float len = distance(uA, uB);
  float strag = step(0.9, aSeed.z);                                   // a few stragglers peel away and gutter out
  float ang = aSeed.y*6.2832 + s*7.0 + uTime*(0.8 + 1.2*r2);
  float rad = (0.03 + sin(3.14159*s)*(0.10 + 0.55*r2)*min(1.0, len*0.012))*uTh2.y*(1.0 + strag*(2.0 + 9.0*s));
  P += (n1*cos(ang) + n2*sin(ang))*rad + vec3(0.0, -strag*s*s*len*0.03, 0.0);
  float dist = distance(P, uCamPos.xyz);
  float px = 2.0*dist/(uProj[1][1]*uScreen.y);
  float size = px*(0.9 + 1.2*r1);                                     // 2-5 px across, whatever the range
  vec3 camR = vec3(uView[0][0], uView[1][0], uView[2][0]);
  vec3 camU = vec3(uView[0][1], uView[1][1], uView[2][1]);
  vec3 camF = cross(camU, camR);
  vec3 tv = T - camF*dot(T, camF); float tl = length(tv);
  vec3 a1 = tl > 0.05 ? tv/tl : camU; vec3 a2 = cross(camF, a1);
  vec3 pos = P + a1*(aCorner.x*size*(1.8 + 1.2*r2)) + a2*(aCorner.y*size);
  float vis = step(aSeed.w, uTh.z)*smoothstep(uTh.y, uTh.y + 0.05, s)*(1.0 - smoothstep(uTh.x - 0.05, uTh.x, s))*smoothstep(0.0, 0.03, s);
  vis *= 0.65 + 0.35*sin(uTime*(9.0 + 14.0*r1) + aSeed.x*50.0);
  vis *= mix(1.0, max(1.0 - s*1.2, 0.0), strag);
  vec3 col = mix(vec3(1.0, 0.70, 0.30), vec3(1.0, 0.46, 0.13), r2);
  col = mix(col, vec3(1.0, 0.86, 0.60), smoothstep(0.75, 1.0, s)*0.6);
  vCol = col*(vis*uTh.w*(1.0 - 0.5*twFogAmount(P)));
  vC = aCorner;
  gl_Position = uViewProj*vec4(pos, 1.0);
}`;
  const THREAD_FS = `
in vec2 vC; in vec3 vCol; out vec4 o;
void main(){
  vec2 d = vec2((vC.x - 0.55)/0.42, vC.y);
  float head = exp(-dot(d, d)*3.2);
  float tail = exp(-vC.y*vC.y*7.0)*smoothstep(-1.0, 0.55, vC.x)*(1.0 - smoothstep(0.5, 0.75, vC.x))*0.4;
  o = vec4(vCol*(head*1.8 + tail), 0.0);
}`;

  const GULL_VS = `
#include <fog>
layout(location=0) in vec2 aPos;      // x = span -1..1, y = chord
layout(location=4) in vec4 aSeed;     // phase, radius, height, speed (signed)
uniform vec4 uCtr;                    // xyz = centre, w = visibility
out vec4 vCol;
void main(){
  float ang = aSeed.x*6.283 + uTime*aSeed.w/aSeed.y;
  vec3 c = uCtr.xyz + vec3(cos(ang)*aSeed.y, aSeed.z + 2.5*sin(uTime*0.37 + aSeed.x*9.0), sin(ang)*aSeed.y);
  float sg = sign(aSeed.w);
  vec3 fwd = vec3(-sin(ang), 0.0, cos(ang))*sg;
  vec3 right = vec3(fwd.z, 0.0, -fwd.x);
  vec3 up = normalize(vec3(0.0, 1.0, 0.0) - vec3(cos(ang), 0.0, sin(ang))*0.35);
  right = normalize(cross(up, fwd));
  float glide = smoothstep(-0.3, 0.5, sin(uTime*0.6 + aSeed.x*17.0));
  float flap = sin(uTime*(6.5 + fract(aSeed.x*3.3)*2.0) + aSeed.x*40.0)*(0.25 + 0.75*glide);
  float ax = abs(aPos.x);
  float y = ax*(0.34 + 0.55*flap) - ax*ax*(0.30 + 0.22*flap);
  float span = 1.45;
  vec3 wc = c + right*(aPos.x*span*(1.0 - 0.12*abs(flap))) + up*(y*span) - fwd*(0.16*ax*span);
  vec3 thick = normalize(cross(right, uCamPos.xyz - wc) + vec3(0.0, 1e-4, 0.0));   // the chord always faces the eye: a readable V from any angle
  vec3 P = wc + thick*(aPos.y*span*1.25);
  vec3 lit = vec3(0.045, 0.048, 0.06)*(uAmbient.rgb*1.2 + uSunColor.rgb*(0.10 + 0.25*max(y, 0.0)) + uMoonColor.rgb*0.3);
  vCol = vec4(mix(lit, twFogColor(normalize(P - uCamPos.xyz)), twFogAmount(P)*0.35), uCtr.w*(1.0 - smoothstep(40.0, 75.0, distance(P, uCamPos.xyz))));   // far gulls would read as bright specks against dark rock
  gl_Position = uViewProj*vec4(P, 1.0);
}`;
  const GULL_FS = `in vec4 vCol; out vec4 o; void main(){ o = vec4(vCol.rgb*vCol.a, vCol.a); }`;

  // ---------------------------------------------------------------- particle pool
  const rainTravel = [0, 0, 0], mistDrift = [0, 0];
  const TYPES = { spray: 0, splash: 1, ember: 2, kindle: 3, sparkle: 4, spindrift: 5 };
  //            n, spread, up, size0, size1, life0, life1, gravity, drag, windFactor
  const TDEF = [
    [6, 2.2, 2.6, 0.016, 0.042, 0.5, 1.0, -8.5, 0.7, 0.30],
    [24, 3.2, 4.6, 0.022, 0.060, 0.7, 1.3, -9.8, 0.35, 0.15],
    [1, 0.25, 0.55, 0.03, 0.05, 0.8, 1.7, 0.5, 1.5, 0.30],
    [1, 0.6, 1.2, 0.04, 0.08, 2.2, 3.2, 0.3, 1.0, 0.2],
    [30, 2.4, 2.2, 0.10, 0.24, 0.6, 1.4, -1.5, 2.0, 0.1],
    [4, 2.4, 0.35, 0.06, 0.14, 1.0, 2.1, -0.45, 0.9, 0.9],
  ];
  let MAXP = 900;
  const PT = { n: 0 };
  const defOpts = {};
  const io = { n: 0, vx: 0, vy: 0, vz: 0, spread: -1, up: -1, size: -1, life: -1, tx: 0, ty: 0, tz: 0, target: false };  // reusable opts for internal emits
  function resetIO() { io.n = 0; io.vx = io.vy = io.vz = 0; io.spread = io.up = io.size = io.life = -1; io.target = false; return io; }

  function emit(type, x, y, z, opts) {
    if (!ready) return;
    const ti = typeof type === 'number' ? type : TYPES[type];
    if (ti === undefined) return;
    const d = TDEF[ti], o = opts || defOpts;
    const n = o.n > 0 ? o.n : d[0];
    const spread = o.spread >= 0 ? o.spread : d[1], up = o.up >= 0 ? o.up : d[2];
    const bvx = o.vx || 0, bvy = o.vy || 0, bvz = o.vz || 0;
    const hasT = !!(o.target || (o.tx !== undefined && o !== io && o.ty !== undefined));
    for (let i = 0; i < n; i++) {
      if (PT.n >= MAXP) return;
      const k = PT.n++;
      // random direction in the unit ball
      let rx = rnd() * 2 - 1, ry = rnd() * 2 - 1, rz = rnd() * 2 - 1;
      const rl = Math.hypot(rx, ry, rz) || 1, rs = Math.pow(rnd(), 0.5) / rl;
      rx *= rs; ry *= rs; rz *= rs;
      PT.x[k] = x + rx * 0.15; PT.y[k] = y + ry * 0.1; PT.z[k] = z + rz * 0.15;
      PT.vx[k] = bvx + rx * spread; PT.vy[k] = bvy + Math.abs(ry) * spread * 0.6 + up * (0.5 + 0.7 * rnd()); PT.vz[k] = bvz + rz * spread;
      PT.size[k] = (o.size > 0 ? o.size : 1) * (d[3] + (d[4] - d[3]) * rnd());
      PT.inv[k] = 1 / ((o.life > 0 ? o.life : 1) * (d[5] + (d[6] - d[5]) * rnd()));
      PT.life[k] = 0; PT.type[k] = ti; PT.seed[k] = rnd();
      PT.tg[k] = hasT ? 1 : 0;
      if (hasT) { PT.tx[k] = o.tx; PT.ty[k] = o.ty; PT.tz[k] = o.tz; }
    }
  }

  function simulate(dt) {
    const S = TW.state, ws = S.wind.speed * (1 + S.wind.gust), wx = S.wind.dirX * ws, wz = S.wind.dirZ * ws, t = S.time;
    const d = partMesh.data;
    let i = 0, o = 0;
    while (i < PT.n) {
      const life = PT.life[i] + dt * PT.inv[i];
      if (life >= 1) { // kill: move the last one into this slot
        const l = --PT.n;
        if (i !== l) {
          PT.x[i] = PT.x[l]; PT.y[i] = PT.y[l]; PT.z[i] = PT.z[l]; PT.vx[i] = PT.vx[l]; PT.vy[i] = PT.vy[l]; PT.vz[i] = PT.vz[l];
          PT.life[i] = PT.life[l]; PT.inv[i] = PT.inv[l]; PT.size[i] = PT.size[l]; PT.type[i] = PT.type[l]; PT.seed[i] = PT.seed[l];
          PT.tg[i] = PT.tg[l]; PT.tx[i] = PT.tx[l]; PT.ty[i] = PT.ty[l]; PT.tz[i] = PT.tz[l];
        }
        continue;
      }
      PT.life[i] = life;
      const ty = PT.type[i], df = TDEF[ty];
      let vx = PT.vx[i], vy = PT.vy[i], vz = PT.vz[i];
      if (PT.tg[i]) { // homing mote: arrive at the target as its life runs out
        const rem = Math.max(0.25, (1 - life) / PT.inv[i]), k = 1 - Math.exp(-3.0 * dt), sd = PT.seed[i] * 40;
        const sw = 3.4 * Math.sin(Math.PI * life);   // spiral widest in mid-flight
        const dx = (PT.tx[i] - PT.x[i]) / rem + Math.sin(t * 3.4 + sd) * sw;
        const dy = (PT.ty[i] - PT.y[i]) / rem + Math.sin(t * 2.1 + sd * 1.7) * 0.8 * (1 - life);
        const dz = (PT.tz[i] - PT.z[i]) / rem + Math.cos(t * 3.4 + sd) * sw;
        vx += (dx - vx) * k; vy += (dy - vy) * k; vz += (dz - vz) * k;
      } else {
        const k = 1 - Math.exp(-df[8] * dt);
        vx += (wx * df[9] - vx) * k; vz += (wz * df[9] - vz) * k;
        vy += df[7] * dt - vy * k * 0.3;
        if (ty === 2 || ty === 3) { const sd = PT.seed[i] * 50; vx += Math.sin(t * 5.0 + sd) * 1.2 * dt; vz += Math.cos(t * 4.3 + sd) * 1.2 * dt; }
      }
      PT.vx[i] = vx; PT.vy[i] = vy; PT.vz[i] = vz;
      PT.x[i] += vx * dt; PT.y[i] += vy * dt; PT.z[i] += vz * dt;
      d[o] = PT.x[i]; d[o + 1] = PT.y[i]; d[o + 2] = PT.z[i]; d[o + 3] = PT.size[i];
      d[o + 4] = life; d[o + 5] = ty; d[o + 6] = PT.seed[i]; d[o + 7] = 0;
      d[o + 8] = vx; d[o + 9] = vy; d[o + 10] = vz; d[o + 11] = 0;
      o += 12; i++;
    }
  }

  // ---------------------------------------------------------------- lightning
  const MAXSEG = 240;
  const boltS = { n: 0, age: 9, seed: 1, x: 0, y: 0, z: 0 };
  function bolt(x, y, z, seed) {
    if (!ready) return;
    seed = (seed === undefined ? (TW.state.lightning.seed || 1) : seed);
    const r = TW.rng(((Math.floor(seed * 7919) | 0) + 13) ^ TW.seed);
    const d = boltMesh.data;
    let n = 0;
    let gy = (TW.world && TW.world.heightAt) ? TW.world.heightAt(x, z) : 0;
    if (!(gy > 0)) gy = TW.state.tide || 0;
    if (y !== undefined && y > gy && y < 60) gy = y;
    const seg = (a, b, w, br) => {
      if (n >= MAXSEG || br <= 0.004) return;
      const o = n * 8;
      d[o] = a[0]; d[o + 1] = a[1]; d[o + 2] = a[2]; d[o + 3] = w; d[o + 4] = b[0]; d[o + 5] = b[1]; d[o + 6] = b[2]; d[o + 7] = br;
      n++;
    };
    // fractal midpoint displacement: jagged at every scale
    const build = (a, b, levels, rough) => {
      let pts = [a, b];
      let disp = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * rough;
      for (let l = 0; l < levels; l++) {
        const np = [pts[0]];
        for (let i = 0; i < pts.length - 1; i++) {
          const p = pts[i], q = pts[i + 1];
          np.push([(p[0] + q[0]) * 0.5 + (r() - 0.5) * 2 * disp, (p[1] + q[1]) * 0.5 + (r() - 0.5) * 0.7 * disp, (p[2] + q[2]) * 0.5 + (r() - 0.5) * 2 * disp], q);
        }
        pts = np; disp *= 0.56;
      }
      return pts;
    };
    // lay a path down as ribbons; width and brightness run from (w0, b0) to (w1, b1); fadeIn hides the start inside the cloud
    const lay = (pts, w0, w1, b0, b1, fadeIn) => {
      const m = pts.length - 1;
      for (let i = 0; i < m; i++) {
        const f = (i + 0.5) / m;
        seg(pts[i], pts[i + 1], w0 + (w1 - w0) * f, (b0 + (b1 - b0) * f) * (fadeIn ? TW.smoothstep(0.0, 0.2, f) : 1));
      }
    };
    const top = [x + (r() - 0.5) * 170, 560 + r() * 150, z + (r() - 0.5) * 170];
    const ground = [x, gy, z];
    const main = build(top, ground, 6, 0.16);
    lay(main, 2.4, 0.9, 1.0, 0.9, true);
    // forks: leave the channel at a shallow angle, wander on downward and die out
    const nf = 2 + Math.floor(r() * 2.99), M = main.length - 1;
    for (let k = 0; k < nf; k++) {
      const i = Math.floor(M * (0.16 + 0.55 * (k + r()) / nf));
      const p = main[i], q = main[Math.min(M, i + 6)];
      let dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2];
      const dl = Math.hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
      const ha = r() * 6.283, ang = 0.32 + 0.4 * r(), ca = Math.cos(ang), sa = Math.sin(ang);
      const len = Math.hypot(p[0] - x, p[1] - gy, p[2] - z) * (0.28 + 0.3 * r());
      const e = [p[0] + (dx * ca + Math.cos(ha) * sa) * len, Math.max(gy + 12, p[1] + (dy * ca - 0.15 * sa) * len), p[2] + (dz * ca + Math.sin(ha) * sa) * len];
      const fork = build(p, e, 4, 0.2);
      lay(fork, 1.5, 0.25, 0.8, 0.0, false);
      if (r() < 0.6) {   // a twig off the fork
        const j = Math.floor(fork.length * (0.3 + 0.3 * r())), fp = fork[j], l2 = len * (0.3 + 0.2 * r()), h2 = r() * 6.283;
        lay(build(fp, [fp[0] + Math.cos(h2) * l2 * 0.6, Math.max(gy + 12, fp[1] - l2 * 0.75), fp[2] + Math.sin(h2) * l2 * 0.6], 3, 0.22), 0.8, 0.15, 0.45, 0.0, false);
      }
    }
    boltMesh.upload(n);
    boltS.n = n; boltS.age = 0; boltS.seed = seed; boltS.x = x; boltS.y = gy; boltS.z = z;
  }

  // ---------------------------------------------------------------- beacon kindling emitters
  const kind = [];
  for (let i = 0; i < 4; i++) kind.push({ active: false, index: 0, t: 0, dur: 0, acc: 0, mode: 0, big: 1 });
  const pulse = { t: 9, x: 0, y: 0, z: 0, big: 1 };   // the radial flare when a lamp takes the flame
  function startKindle(index, dur, mode, big) {
    let k = kind[0];
    for (let i = 0; i < kind.length; i++) { if (kind[i].active && kind[i].index === index) { k = kind[i]; break; } if (!kind[i].active) k = kind[i]; }
    k.active = true; k.index = index; k.t = 0; k.dur = dur; k.acc = 0; k.mode = mode || 0; k.big = big || 1;
  }

  // ---------------------------------------------------------------- init
  function init() {
    gl = TW.gl;
    rnd = TW.rng((TW.seed ^ 0x5f3759df) >>> 0);
    const q = TW.quality ? TW.quality.level : 1;
    const quad = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);

    rainProg = TW.glx.program(RAIN_VS, RAIN_FS, 'fx-rain');
    partProg = TW.glx.program(PART_VS, PART_FS, 'fx-particles');
    haloProg = TW.glx.program(HALO_VS, HALO_FS, 'fx-halo');
    boltProg = TW.glx.program(BOLT_VS, BOLT_FS, 'fx-bolt');
    mistProg = TW.glx.program(MIST_VS, MIST_FS, 'fx-mist');
    gullProg = TW.glx.program(GULL_VS, GULL_FS, 'fx-gulls');
    threadProg = TW.glx.program(THREAD_VS, THREAD_FS, 'fx-thread');

    // rain: seeds in a unit cube; w = sorted index so drawing the first N instances thins it evenly
    rainCount = [4000, 14000, 20000][q] || 14000;
    rainMesh = instMesh(new Float32Array([-1, 0, 1, 0, -1, 1, 1, 1]), 2, 4, [{ loc: 4, size: 4, off: 0 }], rainCount, gl.STATIC_DRAW);
    const rr = TW.rng(9173);
    for (let i = 0; i < rainCount; i++) { rainMesh.data[i * 4] = rr(); rainMesh.data[i * 4 + 1] = rr(); rainMesh.data[i * 4 + 2] = rr(); rainMesh.data[i * 4 + 3] = i / rainCount; }
    rainMesh.upload(rainCount);

    MAXP = [400, 1500, 2400][q] || 1500;
    partMesh = instMesh(quad, 2, 12, [{ loc: 4, size: 4, off: 0 }, { loc: 5, size: 4, off: 4 }, { loc: 6, size: 4, off: 8 }], MAXP, gl.DYNAMIC_DRAW);
    ['x', 'y', 'z', 'vx', 'vy', 'vz', 'life', 'inv', 'size', 'seed', 'tx', 'ty', 'tz'].forEach((k) => { PT[k] = new Float32Array(MAXP); });
    PT.type = new Uint8Array(MAXP); PT.tg = new Uint8Array(MAXP);

    boltMesh = instMesh(new Float32Array([0, -1, 1, -1, 0, 1, 1, 1]), 2, 8, [{ loc: 4, size: 4, off: 0 }, { loc: 5, size: 4, off: 4 }], MAXSEG, gl.DYNAMIC_DRAW);

    mistCount = [6, 12, 16][q] || 12;
    mistMesh = instMesh(quad, 2, 4, [{ loc: 4, size: 4, off: 0 }], mistCount, gl.STATIC_DRAW);
    for (let i = 0; i < mistCount * 4; i++) mistMesh.data[i] = rr();
    mistMesh.upload(mistCount);

    gullCount = 5;
    const gv = [];
    [-1, -0.55, 0, 0.55, 1].forEach((x) => { const c = 0.15 * (1 - 0.8 * Math.abs(x)) + 0.02; gv.push(x, c, x, -c); });
    gullMesh = instMesh(new Float32Array(gv), 2, 4, [{ loc: 4, size: 4, off: 0 }], gullCount, gl.STATIC_DRAW);
    for (let i = 0; i < gullCount; i++) {
      gullMesh.data[i * 4] = (i + rr()) / gullCount; gullMesh.data[i * 4 + 1] = 15 + rr() * 17; gullMesh.data[i * 4 + 2] = 5.5 + rr() * 6; gullMesh.data[i * 4 + 3] = (7 + rr() * 4) * (rr() < 0.5 ? -1 : 1);
    }
    gullMesh.upload(gullCount);

    threadCount = [110, 240, 320][q] || 240;
    threadMesh = instMesh(quad, 2, 4, [{ loc: 4, size: 4, off: 0 }], threadCount, gl.STATIC_DRAW);
    for (let i = 0; i < threadCount; i++) { threadMesh.data[i * 4] = rr(); threadMesh.data[i * 4 + 1] = rr(); threadMesh.data[i * 4 + 2] = rr(); threadMesh.data[i * 4 + 3] = (i + 0.5) / threadCount; }
    threadMesh.upload(threadCount);

    quadMesh = TW.glx.mesh({ attribs: [{ loc: 0, size: 2, data: quad }], mode: gl.TRIANGLE_STRIP });

    // events
    TW.on('lightning', (d) => { if (d && !(DBG_BOLT > 0)) bolt(d.x, d.y, d.z, TW.state.lightning.seed); });

    TW.on('beaconLit', (d) => {
      if (!d) return;
      const b = TW.world && TW.world.beacons && TW.world.beacons[d.index | 0];
      if (!b) return;
      const big = (d.isHeart || b.isHeart) ? 1.8 : 1;
      startKindle(d.index | 0, 2.5, 1, big);                                    // a couple of seconds of fine sparks shed down-wind
      resetIO(); io.n = Math.round(110 * big); io.spread = 5.5 * big; io.up = 1.5; io.size = 1.2; io.life = 1.5;
      emit(2, b.lamp[0], b.lamp[1], b.lamp[2], io);
    });
    TW.on('pickup', (d) => {
      if (!d) return;
      const y = TW.env.seaHeight(d.x, d.z) + 0.6;
      resetIO(); io.n = 36; emit(4, d.x, y, d.z, io);
      resetIO(); io.n = 8; emit(0, d.x, y - 0.3, d.z, io);
    });
    TW.on('bump', (d) => {
      if (!d) return;
      const s = TW.saturate(d.strength === undefined ? 0.5 : d.strength), y = TW.env.seaHeight(d.x, d.z) + 0.2;
      resetIO(); io.n = Math.round(30 + 70 * s); io.up = 2.5 + 3.5 * s; emit(1, d.x, y, d.z, io);
      resetIO(); io.n = Math.round(30 + 50 * s); emit(0, d.x, y, d.z, io);
    });
    TW.on('bigWave', (d) => {
      const bt = TW.state.boat, s = d && d.strength !== undefined ? TW.saturate(d.strength) : 0.8;
      const x = d && d.x !== undefined ? d.x : bt.x + Math.sin(bt.heading) * 2.6, z = d && d.z !== undefined ? d.z : bt.z + Math.cos(bt.heading) * 2.6;
      resetIO(); io.n = Math.round(24 + 40 * s); io.up = 1.8 + 1.6 * s; io.spread = 2.6; io.vx = bt.vx * 0.5; io.vz = bt.vz * 0.5; emit(1, x, bt.y + 0.3, z, io);
      resetIO(); io.n = Math.round(30 + 40 * s); io.up = 1.6; io.spread = 2.4; io.vx = bt.vx * 0.6; io.vz = bt.vz * 0.6; emit(0, x, bt.y + 0.4, z, io);
    });
    TW.on('respawn', () => { st.have = false; });
    TW.on('restart', () => { st.have = false; PT.n = 0; boltS.age = 9; for (let i = 0; i < kind.length; i++) kind[i].active = false; thr.idx = -1; });
    ready = true;
  }

  // ---------------------------------------------------------------- update
  const st = { have: false, imm: 0, bx: 0, bz: 0, sprayAcc: 0, sheetAcc: 0, lineAcc: 0, emberAcc: 0, driftAcc: 0, slamCool: 0, testDone: false };
  const bm = TW.M.create();
  const thr = { idx: -1, head: 0, cut: 0, lastP: 0, hold: 0, flow: 0, p: 0 };
  const hk = [0, 0, 0, -1, 0];   // Heartlight light front for the rain shaders: x, y, z, radius, gold strength
  const DBG_BOLT = TW.qf('testbolt', 0);   // look-dev: ?testbolt=N keeps a bolt standing in view (use with flash=1)
  const wv = { x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0 };

  function update(dt) {
    if (!ready) return;
    const S = TW.state, bt = S.boat;
    if (S.phase === 'paused' || !(dt > 0)) return;
    if (dt > 0.05) dt = 0.05;
    { const S0 = TW.state, ws0 = S0.wind.speed * (1 + S0.wind.gust), rn0 = TW.saturate(S0.rain) * (1 - TW.smoothstep(0.1, 0.8, S0.dawn));
      const hq = 1;   // (the held breath no longer slows the rain: slowed drops read as stars)
      rainTravel[0] += S0.wind.dirX * ws0 * 0.62 * dt * hq; rainTravel[1] -= (8.5 + 3 * rn0) * dt * hq; rainTravel[2] += S0.wind.dirZ * ws0 * 0.62 * dt * hq;
      mistDrift[0] += S0.wind.dirX * ws0 * 0.5 * dt; mistDrift[1] += S0.wind.dirZ * ws0 * 0.5 * dt;
      for (let i = 0; i < 3; i++) if (Math.abs(rainTravel[i]) > 60000) rainTravel[i] %= 6000; }
    const fwdx = Math.sin(bt.heading), fwdz = Math.cos(bt.heading), prtx = fwdz, prtz = -fwdx;   // port = local +X
    TW.boatMatrix(bm);

    // ---- wake
    const spd = Math.abs(bt.speed), s01 = TW.saturate(spd / 9);
    if (TW.ocean && TW.ocean.addWake && spd > 0.15) {
      TW.ocean.addWake(bt.x - fwdx * 2.7, bt.z - fwdz * 2.7, s01, 1.5 + spd * 0.13);
      TW.ocean.addWake(bt.x + fwdx * 2.5, bt.z + fwdz * 2.5, s01 * 0.55, 0.9 + spd * 0.05);
    }

    // ---- bow spray: how hard is the stem being driven into the sea?
    const lx = 0, ly = 0.12, lz = 2.85;
    const bwx = bm[0] * lx + bm[4] * ly + bm[8] * lz + bm[12], bwy = bm[1] * lx + bm[5] * ly + bm[9] * lz + bm[13], bwz = bm[2] * lx + bm[6] * ly + bm[10] * lz + bm[14];
    const sea = TW.env.seaHeight(bwx, bwz, wv);
    const imm = sea - bwy;
    const jumped = st.have && Math.hypot(bwx - st.bx, bwz - st.bz) > 12;
    let slam = 0;
    if (st.have && !jumped) slam = TW.clamp((imm - st.imm) / dt * 0.45, 0, 1.6) * TW.saturate((imm + 0.45) * 2.2) * TW.saturate(spd / 3);
    st.imm = imm; st.bx = bwx; st.bz = bwz; st.have = true;
    st.slamCool -= dt;
    st.sprayAcc += dt * (spd * 5.0 * TW.saturate((imm + 0.5) * 1.6) + slam * 380);
    let guard = 0;
    while (st.sprayAcc >= 1 && guard++ < 40) {
      st.sprayAcc -= 1;
      const sd = rnd() < 0.5 ? -1 : 1, out = 1.0 + rnd() * 2.8 + slam * 1.8;
      resetIO(); io.n = 1; io.spread = 0.7 + slam * 1.2;
      io.vx = fwdx * spd * 0.5 + prtx * sd * out; io.vz = fwdz * spd * 0.5 + prtz * sd * out; io.up = 1.4 + slam * 3.2;
      emit(0, bwx + prtx * sd * 0.18 - fwdx * rnd() * 0.5, Math.max(sea, bwy - 0.2) + 0.05, bwz + prtz * sd * 0.18 - fwdz * rnd() * 0.5, io);
    }
    if (st.sprayAcc > 6) st.sprayAcc = 0;
    // a thin sheet of water peeling off either side of the stem
    if (spd > 1.2 && imm > -0.55) {
      st.sheetAcc += dt * spd * 20;
      let g2 = 0;
      while (st.sheetAcc >= 1 && g2++ < 16) {
        st.sheetAcc -= 1;
        const sd = (g2 & 1) ? -1 : 1, f = rnd();
        resetIO(); io.n = 1; io.spread = 0.25; io.life = 0.55; io.size = 0.8;
        io.vx = fwdx * spd * 0.55 + prtx * sd * (0.9 + 1.3 * f); io.vz = fwdz * spd * 0.55 + prtz * sd * (0.9 + 1.3 * f); io.up = 0.9 + 1.0 * f;
        emit(0, bwx - fwdx * (0.15 + 0.5 * f) + prtx * sd * (0.06 + 0.2 * f), Math.max(sea, bwy - 0.25) + 0.03, bwz - fwdz * (0.15 + 0.5 * f) + prtz * sd * (0.06 + 0.2 * f), io);
      }
      if (st.sheetAcc > 4) st.sheetAcc = 0;
      // and a ragged line of it running aft along the waterline, both sides
      st.lineAcc += dt * spd * 13;
      let g3 = 0;
      while (st.lineAcc >= 1 && g3++ < 10) {
        st.lineAcc -= 1;
        const sd = (g3 & 1) ? -1 : 1, f = rnd(), lz2 = 2.55 - 2.3 * f, lx2 = sd * (0.12 + 0.72 * Math.pow(f, 0.7));
        const wx2 = bm[0] * lx2 + bm[8] * lz2 + bm[12], wy2 = bm[1] * lx2 + bm[9] * lz2 + bm[13], wz2 = bm[2] * lx2 + bm[10] * lz2 + bm[14];
        resetIO(); io.n = 1; io.spread = 0.3; io.life = 0.45; io.size = 0.8;
        io.vx = fwdx * spd * 0.35 + prtx * sd * (0.5 + 0.9 * rnd()); io.vz = fwdz * spd * 0.35 + prtz * sd * (0.5 + 0.9 * rnd()); io.up = 0.35 + 0.5 * (1 - f);
        emit(0, wx2, wy2 + 0.06, wz2, io);
      }
      if (st.lineAcc > 4) st.lineAcc = 0;
    }
    if (slam > 0.85 && st.slamCool <= 0) {
      st.slamCool = 1.1;
      resetIO(); io.n = 70; io.spread = 2.6; io.up = 3.4; io.vx = fwdx * spd * 0.55; io.vz = fwdz * spd * 0.55;
      emit(0, bwx, Math.max(sea, bwy) + 0.1, bwz, io);
      resetIO(); io.n = 30; io.spread = 3.0; io.up = 4.0; io.vx = fwdx * spd * 0.5; io.vz = fwdz * spd * 0.5;
      emit(1, bwx, Math.max(sea, bwy) + 0.1, bwz, io);
    }

    // ---- spindrift torn from crests near the camera
    if (S.storm > 0.4) {
      st.driftAcc += dt * (S.storm - 0.4) * 120 * (1 + 2.5 * TW.saturate(S.wind.gust)) * (1 - TW.smoothstep(0.2, 0.8, S.dawn));
      const cam = S.cam, thr = 1.25 * TW.env.seaScale + (S.tide || 0);
      const vdx = cam.target[0] - cam.pos[0], vdz = cam.target[2] - cam.pos[2], vl = Math.hypot(vdx, vdz) || 1;
      let tries = 0;
      while (st.driftAcc >= 1 && tries++ < 8) {
        st.driftAcc -= 1;
        // look mostly ahead of the camera, 10-90 m out
        const x = cam.pos[0] + vdx / vl * 38 + (rnd() - 0.5) * 120, z = cam.pos[2] + vdz / vl * 38 + (rnd() - 0.5) * 120;
        TW.env.wave(x, z, wv);
        if (wv.y > thr) {
          resetIO(); io.n = 3; io.vx = S.wind.dirX * S.wind.speed * 0.8; io.vz = S.wind.dirZ * S.wind.speed * 0.8;
          emit(5, x + wv.x, wv.y + 0.1, z + wv.z, io);
        }
      }
      if (st.driftAcc > 6) st.driftAcc = 0;
    }

    // ---- lantern embers
    const li = S.lantern.intensity;
    if (li > 0.05) {
      st.emberAcc += dt * li * (2.2 + 5 * S.wind.gust + 1.5 * S.storm);
      if (st.emberAcc >= 1) {
        st.emberAcc -= 1;
        const lw = TW.env.lanternWorld;
        resetIO(); io.n = 1; io.vx = bt.vx * 0.6; io.vz = bt.vz * 0.6;
        emit(2, lw[0], lw[1] + 0.2, lw[2], io);
      }
    }

    // ---- kindling: motes climb from the landing to the lamp
    for (let i = 0; i < kind.length; i++) {
      const k = kind[i];
      if (!k.active) continue;
      k.t += dt;
      const b = TW.world && TW.world.beacons && TW.world.beacons[k.index];
      if (!b || k.t > k.dur) { k.active = false; continue; }
      k.acc += dt * 22 * k.big * (1 - k.t / k.dur);    // sparks shed from the lamp room, small and brief
      while (k.acc >= 1) {
        k.acc -= 1;
        resetIO(); io.n = 1; io.spread = 2.4 * k.big; io.up = 0.6; io.size = 1.2; io.life = 1.3;
        io.vx = S.wind.dirX * 3; io.vz = S.wind.dirZ * 3;
        emit(2, b.lamp[0], b.lamp[1], b.lamp[2], io);
      }
    }

    // ---- the kindling thread: follows whichever beacon is taking the flame
    const hs = S.heart, hush = hs ? TW.saturate(hs.hush) : 0;
    {
      let ki = -1;
      for (let i = 0; i < S.beacons.length; i++) { const sb = S.beacons[i]; if (sb && !sb.kindled && sb.progress > 0.004) { ki = i; break; } }
      if (ki >= 0 && ki !== thr.idx) { thr.idx = ki; thr.head = 0; thr.cut = 0; thr.lastP = 0; thr.hold = 0; }
      if (thr.idx >= 0) {
        const sb = S.beacons[thr.idx], p = sb ? sb.progress : 0;
        if (p > thr.lastP + 1e-5) thr.hold = 0.5; else thr.hold -= dt;
        thr.lastP = p; thr.p = p;
        const on = !!sb && thr.hold > 0 && p < 0.999 && !sb.kindled;
        if (on) { if (thr.cut > 0) { thr.cut = 0; thr.head = 0; } thr.head = Math.min(1, thr.head + dt / 0.9); }
        else { thr.cut += dt / 0.42; if (thr.cut >= 1.1) thr.idx = -1; }   // the last sparks arrive, the thread thins to nothing
        thr.flow += dt * (1 + 0.6 * hush);
      }
    }

    // ---- the Heartlight's light front: a faint ring of spindrift lifted off the sea just behind it
    if (hs && hs.t > 0.15 && hs.t < 6) {
      const R = 70 * hs.t - 10, cp = S.cam.pos, cdx = cp[0] - hs.x, cdz = cp[2] - hs.z, cd = Math.hypot(cdx, cdz);
      if (Math.abs(cd - R) < 130) {
        const base = Math.atan2(cdz, cdx), arc = Math.asin(Math.min(1, 120 / Math.max(R, 1)));
        for (let i = 0; i < 2; i++) {
          const a = base + (rnd() * 2 - 1) * arc, x = hs.x + Math.cos(a) * R, z = hs.z + Math.sin(a) * R;
          TW.env.wave(x, z, wv);
          resetIO(); io.n = 1; io.spread = 1.0; io.up = 0.5; io.vx = Math.cos(a) * 9; io.vz = Math.sin(a) * 9; io.life = 0.7;
          emit(5, x + wv.x, wv.y + 0.15, z + wv.z, io);
        }
      }
    }

    // ---- debug: ?testbolt=1 strikes one bolt in view (use with flash=1)
    if (DBG_BOLT > 0 && S.frame >= 2 && (!st.testDone || boltS.age > 0.6)) {
      st.testDone = true;
      const c = S.cam, dx = c.target[0] - c.pos[0], dz = c.target[2] - c.pos[2], dl = Math.hypot(dx, dz) || 1;
      bolt(c.pos[0] + dx / dl * 330 - dz / dl * 70, 0, c.pos[2] + dz / dl * 330 + dx / dl * 70, DBG_BOLT);
    }

    boltS.age += dt;
    simulate(dt);
  }

  // ---------------------------------------------------------------- draw
  function draw() {
    if (!ready) return;
    const S = TW.state;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);

    // gulls at dawn
    const gv = TW.smoothstep(0.3, 0.75, S.dawn);
    if (gv > 0.01 && gullProg.ok) {
      gullProg.use();
      gullProg.set4f('uCtr', S.boat.x, (S.tide || 0), S.boat.z, gv);
      gullMesh.draw(gullCount);
    }

    // lightning: the channel restrikes two or three times as state.flash dies away
    if (boltS.n > 0 && boltS.age < 1.2 && S.flash > 0.03 && boltProg.ok) {
      const ag = boltS.age;
      const pat = ag < 0.07 ? 1 : ag < 0.11 ? 0.15 : ag < 0.19 ? 1 : ag < 0.24 ? 0.25 : ag < 0.32 ? 0.9 : 0.55;
      const hh = S.heart, vis = TW.saturate(S.flash * 1.7) * pat * (hh ? (1 - TW.saturate(hh.hush)) * (hh.t >= 0 && hh.t < 10 ? 0 : 1) : 1);
      boltProg.use();
      boltProg.set1f('uVis', vis);
      boltMesh.draw(boltS.n);
      if (haloProg.ok) {   // the strike point flares on the water
        const cp = S.cam.pos, dist = Math.hypot(boltS.x - cp[0], boltS.z - cp[2]);
        haloProg.use();
        haloProg.set4f('uPosSize', boltS.x, boltS.y + 3, boltS.z, Math.max(30, dist * 0.05));
        haloProg.set4f('uCol', 0.6 * vis * 7, 0.68 * vis * 7, 1.0 * vis * 7, 0);
        quadMesh.draw();
        haloProg.set4f('uPosSize', boltS.x, boltS.y + 8, boltS.z, Math.max(90, dist * 0.16));
        haloProg.set4f('uCol', 0.45 * vis * 0.9, 0.5 * vis * 0.9, 1.0 * vis * 0.9, 0);
        quadMesh.draw();
      }
    }

    // the Heartlight's expanding light front, for rain and curtains
    { const h = S.heart;
      if (h && h.t >= 0 && h.t < 9) { hk[0] = h.x; hk[1] = h.y; hk[2] = h.z; hk[3] = 70 * h.t; hk[4] = TW.smoothstep(9, 4, h.t); }
      else { hk[3] = -1; hk[4] = 0; } }
    const hushD = S.heart ? TW.saturate(S.heart.hush) : 0;

    // rain curtains in the mid-distance
    // in the held breath the weather must still read as heavy: keep a floor under the rain while the game thins it
    const rainAmt = Math.max(TW.saturate(S.rain), 0.65 * hushD) * (1 - TW.smoothstep(0.1, 0.8, S.dawn));
    if (mistProg.ok && rainAmt > 0.03) {
      const ws = S.wind.speed * (1 + S.wind.gust);
      const fx = S.wind.dirX * ws * 0.62, fy = -(8.5 + 3 * rainAmt), fz = S.wind.dirZ * ws * 0.62, fl = Math.hypot(fx, fy, fz) || 1;
      mistProg.use();
      mistProg.set3f('uBox', 330, 1, 330);
      gl.uniform2f(mistProg.loc('uDrift'), mistDrift[0], mistDrift[1]);
      mistProg.set4f('uHeart', hk[0], hk[1], hk[2], hk[3]); mistProg.set4f('uHeartK', hk[4], 1.3 * hushD, 0, 0);
      mistProg.set4f('uFall', fx / fl, fy / fl, fz / fl, rainAmt * (0.55 + 0.45 * TW.saturate(S.storm)) * (1 + 0.6 * TW.saturate(S.wind.gust)));
      gl.blendEquation(gl.MAX);
      gl.blendFunc(gl.ONE, gl.ONE);
      mistMesh.draw(mistCount);
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }

    // particles
    if (PT.n > 0 && partProg.ok) {
      partMesh.upload(PT.n);
      partProg.use();
      partMesh.draw(PT.n);
    }

    // rain
    const rain = Math.max(TW.saturate(S.rain), 0.65 * hushD) * (1 - TW.smoothstep(0.1, 0.8, S.dawn));
    if (rain > 0.01 && rainProg.ok) {
      const ws = S.wind.speed * (1 + S.wind.gust);
      const c = S.cam, dx = c.target[0] - c.pos[0], dy = c.target[1] - c.pos[1], dz = c.target[2] - c.pos[2], dl = Math.hypot(dx, dy, dz) || 1;
      rainProg.use();
      rainProg.set3f('uBox', 46, 30, 46);
      const hv = 1;   // full-length wind-driven hairlines in the hush: only dimmer and a little sparser
      rainProg.set3f('uVel', S.wind.dirX * ws * 0.62 * hv, -(8.5 + 3 * rain) * hv, S.wind.dirZ * ws * 0.62 * hv);
      rainProg.set4f('uHeart', hk[0], hk[1], hk[2], hk[3]); rainProg.set4f('uHeartK', hk[4], 1 - 0.45 * hushD, 1 + 1.4 * hushD, 0);   // hush: dimmer, but longer strokes so they can never read as stars
      rainProg.set3f('uOff', dx / dl * 14, dy / dl * 6 + 3, dz / dl * 14);
      rainProg.set3f('uTravel', rainTravel[0], rainTravel[1], rainTravel[2]);
      gl.blendEquation(gl.MAX);
      gl.blendFunc(gl.ONE, gl.ONE);
      rainMesh.draw(Math.max(1, Math.round(rainCount * Math.pow(rain, 1.3) * (1 - 0.2 * hushD))));
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }

    // lantern halo: a tight warm bloom and a faint wide veil in the wet air
    const li = Math.max(0, S.lantern.intensity) * S.lantern.flicker;
    if (li > 0.01 && haloProg.ok) {
      const lw = TW.env.lanternWorld, fl = 0.92 + 0.08 * Math.sin(S.time * 2.1) * Math.sin(S.time * 0.77);
      gl.blendFunc(gl.ONE, gl.ONE);
      haloProg.use();
      const k = li * fl;
      haloProg.set4f('uPosSize', lw[0], lw[1], lw[2], 0.34 + 0.10 * li);
      haloProg.set4f('uCol', 1.0 * k * 0.72, 0.52 * k * 0.72, 0.16 * k * 0.72, 0.22);
      quadMesh.draw();
      const veil = k * (0.022 + 0.03 * TW.saturate(S.rain));
      haloProg.set4f('uPosSize', lw[0], lw[1], lw[2], 3.0 + 0.8 * li);
      haloProg.set4f('uCol', 1.0 * veil, 0.50 * veil, 0.17 * veil, 0.3);
      quadMesh.draw();
      // the flame is the game's emblem: a faint part of its glow carries through sailcloth and rigging
      gl.disable(gl.DEPTH_TEST);
      haloProg.set4f('uPosSize', lw[0], lw[1], lw[2], 0.5 + 0.12 * li);
      haloProg.set4f('uCol', 1.0 * k * 0.11, 0.50 * k * 0.11, 0.15 * k * 0.11, 0.0);
      quadMesh.draw();
      gl.enable(gl.DEPTH_TEST);
    }

    // the kindling thread
    if (thr.idx >= 0 && threadProg.ok) {
      const b = TW.world && TW.world.beacons && TW.world.beacons[thr.idx];
      if (b) {
        const A = TW.env.lanternWorld, B = b.lamp, len = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
        const ws = Math.min(1.5, S.wind.speed / 14);
        gl.blendFunc(gl.ONE, gl.ONE);
        threadProg.use();
        threadProg.set3f('uA', A[0], A[1] + 0.1, A[2]);
        threadProg.set3f('uB', B[0], B[1], B[2]);
        // a gentle arc: lifted a little, leaning with the wind
        threadProg.set3f('uC', (A[0] + B[0]) * 0.5 + S.wind.dirX * len * 0.09 * ws, Math.min(Math.max(A[1], B[1]) - 1.5, (A[1] + B[1]) * 0.5 + len * 0.07), (A[2] + B[2]) * 0.5 + S.wind.dirZ * len * 0.09 * ws);
        threadProg.set4f('uTh', thr.head, thr.cut, 0.3 + 0.7 * TW.saturate(thr.p) , (1.7 + 2.2 * TW.saturate(thr.p)) * (1 + 0.8 * hushD));
        threadProg.set4f('uTh2', thr.flow, 1 - 0.6 * hushD, hushD, 0);
        threadMesh.draw(threadCount);
      }
    }

    gl.blendFunc(gl.ONE, gl.ZERO);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.bindVertexArray(null);
  }

  TW.fx = {
    _dbg() { const o = { n: PT.n, byType: {}, sample: [], kind: kind.map((k) => [k.active, k.index, +k.t.toFixed(1), k.dur, k.mode]), pulse: pulse.t, bolt: boltS.age }; for (let i = 0; i < PT.n; i++) { o.byType[PT.type[i]] = (o.byType[PT.type[i]] || 0) + 1; if (o.sample.length < 40) o.sample.push([PT.type[i], Math.round(PT.x[i]), Math.round(PT.y[i]), Math.round(PT.z[i]), +PT.life[i].toFixed(2), PT.tg[i]]); } return o; }, init, update, draw, emit, bolt, _bolt: boltS };
})();

