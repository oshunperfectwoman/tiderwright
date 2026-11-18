// ===== 20-sky.js =====
// ============================================================================
// TIDEWRIGHT — 20-sky.js
// The storm sky: a heavy, domain-warped cloud deck on a perspective plane with
// a low ragged scud layer racing beneath it (parallax), a torn gap around the
// moon with silver linings, sheet lightning inside the deck, slanted rain
// veils under the cloud base, sea-level haze at the horizon, and a clean
// peach -> pale-blue dawn with a few lit cloud bars.
// Provides the <sky> GLSL chunk:  vec3 twSky(vec3 dir)  /  vec3 twSkyReflect(vec3 dir)
// Both converge EXACTLY to twFogColor(dir) at dir.y <= 0.
// Cloud drift is integrated on the CPU (so its speed can follow the storm) and
// handed to every program that includes <sky> through `uniform vec4 uSkyDrift`
// (TW.sky.drift; a program that never sets it simply gets a still sky).
// OWNER: agent SKY-OCEAN.
// ============================================================================
(function () {
  'use strict';
  const TW = window.TW;

  TW.glsl.sky = `
#include <fog>
#include <noise>
// ---- <sky> ------------------------------------------------------------------
uniform vec4 uHeartA;     // the Heartlight ignition (TW.sky.heart): x, z of the lamp, R = radius of the front (m, 0 = none), hush
uniform vec4 uHeartB;     // flash on the cloud underside, flash on the sea, glitter-path ramp, brightness of the rim of the front
uniform vec4 uSkyDrift;   // xy = drift of the high deck, zw = drift of the low scud (noise-uv units)
// Cloud-plane coordinates: perspective toward the horizon (|p| ~ 8 there), lower deck in a gale.
vec2 twSkyUV(vec3 d){ return d.xz/(max(d.y, 0.0) + 0.115)*mix(1.12, 0.86, uStorm); }
// density threshold of the deck: a gale closes the sky, a calm opens it; the dawn leaves only a few bars
float twSkyThr(){ return mix(0.545, 0.375, uStorm) - 0.075*smoothstep(0.62, 0.84, uStorm) + 0.030*uDawn; }   // above ~0.8 the deck closes almost completely
// haze toward the horizon: the general fog, plus a thin band of sea-level spray in the first degree or two
float twSkyHorizon(float y){
  float e = max(mix(19.0, 11.5, uStorm) - 2.0*uRain*(1.0 - uDawn) + 7.0*uDawn, 4.0);
  return max(pow(1.0 - y, e), 0.97*exp(-y*mix(34.0, 22.0, uStorm)));
}
// clear sky behind the deck (no discs): indigo night with the moon's aureole -> peach / pale blue dawn
vec3 twSkyBack(float y, float md, float sd, float D){
  vec3 night = mix(vec3(0.020, 0.032, 0.060), vec3(0.006, 0.011, 0.030), smoothstep(0.0, 0.6, y));
  night += uMoonColor.rgb*(0.04*pow(md, 4.0) + 0.11*pow(md, 30.0) + 0.20*pow(md, 220.0));
  vec3 hor = mix(vec3(0.50, 0.235, 0.200), vec3(0.80, 0.350, 0.125), sd*sd);                         // peach all round, rose-gold toward the sun
  vec3 day = mix(hor, vec3(0.085, 0.235, 0.400), pow(smoothstep(0.0, 0.52, y), 0.80));                           // -> clear pale turquoise-blue overhead
  day += uSunColor.rgb*(0.030*pow(sd, 5.0) + 0.130*pow(sd, 60.0));
  return mix(night, day, D);
}
// radiance of the cloud itself. dens = density here, densL = density a step toward the light, tex = detail noise
vec3 twSkyCloud(vec3 d, float md, float sd, float D, float dens, float densL, float tex){
  float lit = exp(-densL*3.2);
  float belly = 1.0 - 0.68*dens;
  vec3 amb = mix(vec3(0.030, 0.034, 0.054)*mix(1.35, 0.66, uStorm), vec3(0.170, 0.125, 0.150), D);
  vec3 c = amb*belly;
  float lining = mix(0.30, 1.20, smoothstep(0.36, 0.66, tex));                                       // silver linings come and go along an edge
  c += uMoonColor.rgb*(lit*(mix(0.12, 0.065, uStorm) + 0.22*pow(md, 3.0) + 0.62*pow(md, 18.0)*lining)*(1.15 - 1.0*dens));
  c += uMoonColor.rgb*(0.20*pow(md, 40.0)*(1.0 - dens)*(1.0 - dens)*lining);
  c += uSunColor.rgb*(mix(lit, 1.0, 0.25)*(0.034 + 0.050*sd*sd + 0.20*pow(sd, 12.0))*(1.10 - 0.65*dens));
  // sheet lightning: the deck is lit from within, strongest around the bolt
  vec3 Lf = normalize(uLightningPos.xyz - uCamPos.xyz);
  float fd = max(dot(d, Lf), 0.0);
  c += vec3(0.55, 0.68, 1.0)*(uFlash*(0.050 + 0.32*pow(fd, 3.0) + 1.9*pow(fd, 20.0))*(0.06 + 2.3*smoothstep(0.36, 0.72, tex))*(1.2 - 0.9*dens));
  return c;
}
float twSkyStars(vec3 d){
  vec2 g = d.xz/(1.0 + d.y)*64.0; vec2 id = floor(g); vec2 h = twHash22(id);
  vec2 f = fract(g) - 0.5 - (h - 0.5)*0.7;
  return smoothstep(0.11, 0.0, length(f))*step(0.93, twHash(id + 7.31))*(0.25 + 0.75*h.x*h.x);
}

// Full-quality sky radiance for a unit view direction (10 noise fetches).
vec3 twSky(vec3 dir){
  vec3 d = normalize(dir);
  vec3 fogc = twFogColor(d);
  float y = clamp(d.y, 0.0, 1.0);
  float mdr = dot(d, uMoonDir.xyz), sdr = dot(d, uSunDir.xyz);
  float md = max(mdr, 0.0), sd = max(sdr, 0.0);
  float D = smoothstep(0.05, 0.9, uDawn);
  float St = uStorm;
  vec2 p = twSkyUV(d);
  vec2 wv = uSkyDrift.xy, ws = uSkyDrift.zw;

  // --- the high deck: heavy, turbulent, domain-warped
  vec4 w0 = twTexNoise(p*0.019 + wv*0.4 + vec2(0.31, 0.77));
  vec2 pc = p + (w0.rg - 0.5)*mix(3.0, 4.8, St);
  float base = twTexNoise(pc*0.050 + wv).r;
  vec4 det = twTexNoise(pc*0.163 + wv*1.8 + vec2(0.5, 0.1));
  float fine = twTexNoise(pc*0.59 + wv*3.3).g;
  vec2 lxz = normalize(mix(uMoonDir.xz, uSunDir.xz, D) + vec2(1e-4));
  float baseL = twTexNoise((pc + lxz*1.1)*0.050 + wv).r;
  float thr = twSkyThr();
  // the torn gap around the moon: erode the density so the hole has ragged, noisy edges
  int hbi = int(uMisc.x) - 1;
  vec4 HB = uBeacons[max(hbi, 0)]; float hlit = hbi >= 0 ? clamp(HB.w, 0.0, 1.0) : 0.0;
  float hnear = hbi >= 0 ? 1.0 - smoothstep(260.0, 750.0, length(HB.xz - uCamPos.xz)) : 0.0;      // the gale sits heaviest over the Heartlight
  float gale = smoothstep(0.70, 0.86, St);
  float hgale = hnear*smoothstep(0.55, 0.80, St)*(1.0 - smoothstep(0.10, 0.45, uDawn));        // over the Heartlight the deck stays shut until the lamp opens it
  float gapK = (1.0 - 0.5*D)*(1.0 - 0.94*hgale);
  float gap = pow(smoothstep(mix(0.895, 0.925, gale), 0.998, md + (w0.b - 0.45)*0.09 + (det.g - 0.5)*0.11), 1.7)*gapK;
  // The Heartlight breaks the gale as an EVENT: from the moment the lamp catches a circular front races out through the
  // deck from the point above it (radius uHeartA.z, the same front that sweeps the sea). Inside it the deck is gone;
  // AT it the cloud is piled into a ragged rim, lit warm gold from the lamp side; outside it the storm stands untouched,
  // its underside warmed by the lamp. Before ignition there is no clearing at all.
  float hR = uHeartA.z, hush = uHeartA.w, hon = step(1.0, hR);
  vec2 hQ = d.xz/max(d.y, 0.03)*340.0 - (uHeartA.xy - uCamPos.xz);              // metres along the deck from the point above the lamp
  float hrd = length(hQ);
  // Near the Heartlight the deck is looked at from right underneath, where the sky's own (perspective) noise is stretched
  // smooth; so there it gets three more octaves laid out in metres on the deck plane (billows ~300 m, ~90 m, wisps ~25 m),
  // and a fourth tap a step toward the lamp that says which faces of the billows are turned to it.
  float wl = hnear*smoothstep(0.07, 0.30, d.y);
  vec4 n1 = vec4(0.5), n2 = vec4(0.5), n3 = vec4(0.5); float n2L = 0.5;
  if (hnear > 0.001){
    n1 = mix(n1, twTexNoise(hQ*(1.0/2600.0) + wv*0.6), wl);
    n2 = mix(n2, twTexNoise(hQ*(1.0/760.0) + wv*1.7 + vec2(0.37, 0.11)), wl);
    n3 = mix(n3, twTexNoise(hQ*(1.0/230.0) + wv*4.0 + vec2(0.71, 0.53)), wl);
    n2L = mix(0.5, twTexNoise((hQ - hQ*(85.0/max(hrd, 1.0)))*(1.0/760.0) + wv*1.7 + vec2(0.37, 0.11)).r, wl);
  }
  float hbil = (n2.r - 0.5)*0.30 + (n3.g - 0.5)*0.16 + (n1.g - 0.5)*0.16;       // the churning ceiling
  float hfc = clamp(0.5 + (n2.r - n2L)*7.5 + (n3.g - 0.5)*0.9, 0.0, 1.0);       // billow faces turned to the lamp
  // the front: its radius wanders by a fifth along its length, and it does not CUT the cloud, it erodes it over a wide
  // band: thin cloud opens first (holes ahead of the front), thick cloud lasts (veils and islands trailing into the hole)
  float hrn = hrd*(1.0 + (n1.r - 0.5)*0.95 + (w0.b - 0.45)*0.30 + (det.g - 0.5)*0.26 + (fine - 0.5)*0.14) + (n2.r - 0.5)*150.0 + (n3.g - 0.5)*60.0;
  float hclear = hon*(1.0 - smoothstep(hR*0.55 - 20.0, hR*1.12 + 20.0, hrn));
  float hex = smoothstep(0.04, 0.50, hclear);                                   // how open this cloud stands to the lamp
  float hfl = uHeartB.x*exp(-hrd*hrd/(270.0*270.0));                            // T0: a pool of gold in the cloud right above the lamp, like a ceiling above a fire
  float hglow = hlit*exp(-hrd/330.0);                                           // the lamp lights the cloud above it
  float hi = det.r*0.30 + fine*0.10 - gap*0.27 - hclear*0.72 - 0.40*D*smoothstep(0.955, 0.998, sd) + hbil + (0.20*hnear*gale + 0.16*hush)*(1.0 - hclear);
  float hsoft = 0.16*wl*hon;                                 // the torn edge thins out through veils
  float dens = smoothstep(thr - 0.03, thr + 0.17 + hsoft, base*0.60 + hi);
  float densL = smoothstep(thr - 0.03, thr + 0.17 + hsoft, baseL*0.60 + hi);
  float aDeck = smoothstep(0.0, 0.60, dens);                 // a wide, soft edge: no hard rim round the gaps

  // --- low scud: a nearer plane of ragged rags racing downwind under the deck (the parallax sells the gale)
  vec2 qs = d.xz/(y + 0.20)*0.60;
  vec4 s0 = twTexNoise(qs*0.105 + ws + (w0.gb - 0.5)*0.22);
  float s1 = twTexNoise(qs*0.36 + ws*2.2 + vec2(0.7, 0.2)).g;
  float sthr = mix(0.700, 0.545, St) + 0.10*D;
  float sn = s0.r*0.62 + s1*0.38 - gap*0.16 - hclear*0.50 + hbil*0.5;
  float scud = smoothstep(sthr, sthr + 0.15, sn);
  float scudL = smoothstep(sthr - 0.07, sthr + 0.06, sn)*(1.0 - scud);     // the thin torn rim

  // --- what is behind everything: stars only show through true holes, never through thin cloud
  float Dc = max(D, hclear*smoothstep(0.03, 0.45, uDawn)*0.60);
  vec3 back = twSkyBack(y, md, sd, Dc);
  float hole = (1.0 - aDeck)*(1.0 - smoothstep(0.0, 0.25, scud + scudL));
  back += vec3(0.75, 0.85, 1.0)*(twSkyStars(d)*(1.0 - Dc)*hole*hole*hole*mix(0.42, 0.16, St)*(1.0 - hush)*(1.0 - 0.9*hgale*(1.0 - hclear)));
  // the moon: a limb-darkened disc with faint maria (fixed to the disc), a soft edge and a tight inner glow
  vec3 mU = normalize(cross(vec3(0.0, 1.0, 0.0), uMoonDir.xyz)); vec3 mV = cross(uMoonDir.xyz, mU);
  vec2 mp = vec2(dot(d, mU), dot(d, mV))/0.040; float mr = length(mp); float mfront = step(0.0, mdr);
  float mdisc = smoothstep(1.0, 0.93, mr)*mfront;
  float limb = mix(0.72, 1.0, sqrt(max(1.0 - mr*mr, 0.0)));
  float maria = 1.0 - 0.29*smoothstep(0.38, 0.66, twNoise(mp*1.7 + 4.3)*0.6 + twNoise(mp*3.9 + 9.1)*0.4);
  // the disc sits UNDER the tonemap shoulder (its face and limb survive); the light round it is a three-stop corona
  float mg = max(uMoonColor.g, 1e-3), mo = max(mr - 1.0, 0.0);
  back += uMoonColor.rgb*vec3(1.10, 1.0, 0.86)*(min(2.2, 1.12/mg)*mdisc*limb*maria*(1.0 - 0.92*smoothstep(0.10, 0.30, uDawn)));   // the setting moon pales as the sun comes (never two discs)
  back += uMoonColor.rgb*((0.21*exp(-mo*3.2) + 0.12*exp(-mo*0.85) + 0.06*exp(-mo*0.26))*(1.0 - mdisc)*mfront*(1.0 - 0.85*smoothstep(0.10, 0.30, uDawn)));
  // the sun: a soft hot core with limb falloff, and the same kind of smooth corona
  float sr = sqrt(max(2.0*(1.0 - sdr), 0.0))/0.0235, so = max(sr - 1.0, 0.0), sK = uSunColor.r*(1.0/5.2);
  float sdisc = smoothstep(1.0, 0.88, sr);
  back += vec3(1.0, 0.88, 0.66)*(sK*sdisc*mix(6.0, 16.0, sqrt(max(1.0 - sr*sr, 0.0))));
  back += vec3(1.0, 0.70, 0.40)*(sK*(2.6*exp(-so*2.4) + 1.1*exp(-so*0.75) + 0.46*exp(-so*0.22))*(1.0 - sdisc));

  vec3 cl = twSkyCloud(d, md, sd, D, dens, densL, det.g);
  // a heavy ceiling has form: paler underbellies, darker folds (small range, but present)
  cl *= mix(1.0, 0.58 + 0.90*smoothstep(0.30, 0.72, n2.r*0.6 + n3.g*0.4), wl*(1.0 - 0.7*D));
  vec3 hcol = uBeaconCol[max(hbi, 0)].rgb*hglow;
  // the lamp's light on the cloud is SHADED by the billows: faces turned to it glow, the rest stays storm
  cl += mix(hcol, vec3(dot(hcol, vec3(0.333))), 0.12)*(0.11*(0.16 + 1.25*hfc*hfc)*(1.0 - 0.5*dens));
  cl += vec3(1.0, 0.60, 0.24)*(hfl*0.66*(0.14 + 1.30*hfc*hfc)*(1.0 - 0.45*dens));
  // the torn edge of the retreating storm: cloud that the front has opened to the lamp is lit cream-gold on the faces
  // turned to it, orange in the turn, and falls to deep storm blue-grey within a front-width; brightest where it is
  // thick. Later the gold cools to moonlit silver, and to rose as the dawn comes.
  float hsil = smoothstep(650.0, 1700.0, hR);
  vec3 hrc = mix(vec3(1.0, 0.48, 0.18)*0.50, vec3(1.0, 0.89, 0.66), hfc*hex);
  hrc = mix(mix(hrc, vec3(0.62, 0.72, 0.90)*(0.45*dot(hrc, vec3(0.333))), hsil), vec3(1.0, 0.60, 0.55)*dot(hrc, vec3(0.333)), D);
  cl += hrc*(hon*hex*uHeartB.w*0.85*(0.07 + 0.93*hfc*hfc)*(0.30 + 0.70*dens));
  cl *= 1.0 - 0.42*hush;                                                             // the breath before: darker, flatter
  vec3 col = mix(back, cl, aDeck);
  col += vec3(1.0, 0.70, 0.40)*(sK*(1.2*exp(-so*2.4) + 0.55*exp(-so*0.75) + 0.22*exp(-so*0.22))*aDeck);   // the sun's glare comes through thin cloud too

  // scud: dark bellies against whatever is behind, a bright torn rim where the moon (or the low sun) is behind it
  vec3 sc = mix(vec3(0.020, 0.023, 0.036)*mix(1.25, 0.70, St), vec3(0.200, 0.140, 0.150), D)*(1.0 - 0.35*s1)*(1.0 - 0.40*hush);
  sc += uMoonColor.rgb*(0.018 + 0.20*pow(md, 4.0)) + uSunColor.rgb*(0.030 + 0.10*pow(sd, 4.0));
  vec3 Lf = normalize(uLightningPos.xyz - uCamPos.xyz);
  sc += vec3(0.55, 0.68, 1.0)*(uFlash*(0.03 + 0.5*pow(max(dot(d, Lf), 0.0), 6.0)));
  vec3 rim = uMoonColor.rgb*(0.03 + 0.55*pow(md, 10.0)*(0.4 + 1.2*s1)) + uSunColor.rgb*(0.06 + 0.45*pow(sd, 8.0));
  sc += hcol*0.12 + vec3(1.0, 0.60, 0.24)*(hfl*0.20);
  col = mix(col, sc, smoothstep(0.0, 0.7, scud)*0.94);
  col += rim*(scudL*0.26*(0.35 + 1.3*s0.g));

  // --- dawn: a few thin cloud bars low toward the sun, gold along their edges, violet in their shadow
  vec2 az = d.xz/max(length(d.xz), 1e-3);
  vec2 sh = normalize(uSunDir.xz + vec2(1e-4)); float saz = dot(az, sh);
  vec4 cb = twTexNoise(vec2((az.x*sh.y - az.y*sh.x)*0.55 + wv.x*0.3, y*5.5 + 0.17));
  float bars = smoothstep(0.455, 0.60, cb.r*0.7 + cb.g*0.3)*D*smoothstep(0.035, 0.09, y)*smoothstep(0.40, 0.16, y)*smoothstep(-0.2, 0.75, saz);
  bars *= 1.0 - smoothstep(0.975, 0.998, sd);                  // nothing hangs across the sun's face
  col = mix(col, vec3(0.24, 0.15, 0.27) + uSunColor.rgb*0.010, bars*0.74);
  col += uSunColor.rgb*(bars*(1.0 - bars)*4.0*0.15*(0.35 + 0.65*max(saz, 0.0)*max(saz, 0.0)));

  // --- rain: veils hanging from the cloud base toward the horizon, leaning downwind; some darker, some catching the light
  vec4 rn = twTexNoise(az*0.80 + vec2(0.5, 0.8660254)*(y*mix(0.35, 0.80, St)) + ws*0.10);
  float veil = smoothstep(0.42, 0.72, rn.r*0.75 + rn.g*0.25)*smoothstep(mix(0.20, 0.30, St), 0.03, y)*uRain*(1.0 - 0.85*D);
  // broad curtains, mostly a shade darker than what hangs behind them, a few catching a little haze-light
  vec3 veilc = col*mix(0.58, 0.80, smoothstep(0.40, 0.70, rn.b)) + fogc*0.10;
  col = mix(col, veilc, veil*0.62);

  return mix(col, fogc, twSkyHorizon(y));
}

// Cheaper, softer sky for water reflections (2 fetches): fewer octaves, no scud / stars / discs / veils.
vec3 twSkyReflect(vec3 dir){
  vec3 d = normalize(dir);
  vec3 fogc = twFogColor(d);
  float y = clamp(d.y, 0.0, 1.0);
  float md = max(dot(d, uMoonDir.xyz), 0.0), sd = max(dot(d, uSunDir.xyz), 0.0);
  float D = smoothstep(0.05, 0.9, uDawn);
  vec2 p = twSkyUV(d);
  vec2 wv = uSkyDrift.xy;
  vec4 w0 = twTexNoise(p*0.019 + wv*0.4 + vec2(0.31, 0.77));
  vec2 pc = p + (w0.rg - 0.5)*3.4;
  float base = twTexNoise(pc*0.050 + wv).r;
  // Deliberately soft: a rough sea mirrors the sky's broad values, never a readable picture of the cloud edges or of
  // the torn gap round the moon (that showed up as pale hard-edged sheets on the water). The moon itself arrives as glints.
  float gap = smoothstep(0.78, 1.0, md)*(1.0 - 0.5*D);
  float dens = smoothstep(twSkyThr() - 0.20, twSkyThr() + 0.36, base*0.60 + 0.20 - gap*0.22);
  float mds = min(md, 0.94), sds = min(sd, 0.92);          // the discs' tight halos are left to the water's own glints
  vec3 back = twSkyBack(y, mds, sds, D);
  vec3 cl = twSkyCloud(d, mds, sds, D, dens, dens*0.75, 0.5);
  vec3 col = mix(back, cl, smoothstep(0.0, 0.9, dens));
  return mix(col, fogc, twSkyHorizon(y));
}
`;

  let prog = null;
  const drift = new Float32Array(4);
  const heart = new Float32Array(8);
  // radius (m) of the ignition front, t seconds after the Heartlight catches: ~70 m/s by the island, the horizon by ~22 s
  function heartR(t) { const te = Math.max(t - 0.2, 0); return 70 * te + 4.5 * te * te; }
  function heartU() {
    const H = TW.state && TW.state.heart;
    heart.fill(0);
    if (!H) return heart;
    const t = +H.t;
    heart[0] = +H.x || 0; heart[1] = +H.z || 0; heart[3] = TW.saturate(+H.hush || 0);
    if (!heart[0] && !heart[1]) { const bs = TW.state.beacons, b = bs && bs[bs.length - 1]; if (b && b.lamp) { heart[0] = b.lamp[0]; heart[1] = b.lamp[2]; } }
    if (t >= 0) {
      const R = heartR(t);
      heart[2] = R;
      heart[4] = (1 - Math.exp(-t / 0.10)) * Math.exp(-t / 1.5);
      heart[5] = (1 - Math.exp(-t / 0.12)) * Math.exp(-t / 2.0);
      heart[6] = TW.saturate(t / 1.0);
      heart[7] = 0.16 + 1.25 * Math.exp(-R / 1300);
    }
    return heart;
  }
  TW.sky = {
    heart, heartR, heartU,   // uHeartA / uHeartB (first / last four floats); heartR(t) = radius of the ignition front
    drift,   // xy = high deck, zw = low scud; set as `uSkyDrift` by every program that includes <sky>
    init() {
      prog = TW.glx.program(TW.glsl.fsvs, `
#include <sky>
in vec2 vUV; out vec4 o;
void main(){
  vec4 p = uInvViewProj*vec4(vUV*2.0 - 1.0, 1.0, 1.0);
  vec3 d = normalize(p.xyz/p.w - uCamPos.xyz);
  vec3 c = twSky(d);
  // static dither: keeps the dark gradients from banding on 8-bit fallback targets
  c *= 1.0 + (twHash(gl_FragCoord.xy*0.731) - 0.5)*0.035;
  o = vec4(max(c, vec3(0.0)), 1.0);
}`, 'sky');
    },
    update(dt) {
      // the deck drifts downwind; the scud beneath it races. Both speed up with the gale and ease as the storm breaks.
      const S = TW.state;
      if (S.phase === 'paused' || !(dt > 0)) return;
      const st = TW.saturate(S.storm), sp = (0.0030 + 0.0085 * st) * dt, ss = (0.010 + 0.034 * st) * dt;
      drift[0] += 0.5 * sp; drift[1] += 0.8660254 * sp;
      drift[2] += 0.5 * ss; drift[3] += 0.8660254 * ss;
      for (let i = 0; i < 4; i++) if (drift[i] > 50) drift[i] -= 50;      // 50 is a whole number of tiles for every layer's multiplier
    },
    draw() {
      if (!prog || !prog.ok) return;
      const gl = TW.gl;
      gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
      prog.use();
      gl.uniform4fv(prog.loc('uSkyDrift'), drift);
      heartU(); gl.uniform4fv(prog.loc('uHeartA'), heart.subarray(0, 4)); gl.uniform4fv(prog.loc('uHeartB'), heart.subarray(4, 8));
      TW.glx.drawFS();
      gl.depthMask(true); gl.enable(gl.DEPTH_TEST);
    },
  };
})();

