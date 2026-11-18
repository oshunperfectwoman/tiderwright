// ===== 70-game.js =====
// ============================================================================
// TIDEWRIGHT — 70-game.js
// The game itself: input, sailing physics, wave riding, collisions, the weather
// director, objectives / progression, respawn, hints, the camera and the HUD model.
// OWNER: agent GAME. This module is the only writer of TW.state.
//
// Sign conventions used here (see CONTRACT.md "World conventions"):
//   heading h: forward = (sin h, 0, cos h); port = (cos h, 0, -sin h); "turn right" DEcreases h.
//   boat.rudder : +1 = helm hard over to turn RIGHT (same sign as touch.steer).
//   boat.boom   : signed sail angle; POSITIVE = boom swung out to STARBOARD (-X local), i.e. the
//                 angle of an Ry(boom) rotation applied to an aft-pointing boom. Wind over the port
//                 side -> boom > 0 and roll > 0 (heeling to starboard / leeward).
// ============================================================================
(function () {
  'use strict';
  const TW = window.TW, SETTINGS = TW.settings;
  const clamp = TW.clamp, lerp = TW.lerp, sat = TW.saturate, smooth = TW.smoothstep, damp = TW.damp, wrap = TW.wrapAngle;
  const PI = Math.PI, DEG = PI / 180, hyp = Math.hypot;
  const approach = (a, b, d) => (a < b ? Math.min(b, a + d) : Math.max(b, a - d));
  const s01 = (x) => x * x * (3 - 2 * x);

  // ---------------------------------------------------------------------------
  // Tuning
  // ---------------------------------------------------------------------------
  const T = {
    VMAX: 11.0,          // m/s, full sail on a broad reach in a 17 m/s gale
    SAIL_RATE: 0.6,      // sail set / struck per second
    ACCEL: 0.42, DECEL: 0.30, BRAKE: 0.9,   // 1/s approach rates of forward speed
    LAT_DAMP: 2.8,       // 1/s decay of side-slip
    TURN: 0.95,          // rad/s at speed, helm hard over
    TURN_REST: 0.38,     // fraction of TURN available at rest (sculling the stern round)
    YAW_RESP: 5.0,       // 1/s yaw-rate response
    TURN_BLEED: 0.22,    // speed lost per rad turned
    SURF: 3.2,           // m/s^2 per unit of wave slope along the keel
    HEAVE_K: 55, HEAVE_C: 8.0, PITCH_K: 42, PITCH_C: 7.2, ROLL_K: 30, ROLL_C: 5.6,
    SLAM: 0.85,          // slam metric threshold for 'bigWave'
    HIT_MIN: 3.0,        // m/s of impact (normal component) before the hull takes damage
    OIL_TIME: SETTINGS.navigation.oilTime,       // s for a full lantern at rain 0
    OIL_RAIN: SETTINGS.navigation.oilRain,       // extra drain per unit of rain
    TITLE_VIEW: 'isles', // title poster looks toward the 'isles' or the 'moon' (they lie in opposite directions from the spawn)
    FLOAT_OIL: SETTINGS.navigation.floatOil, FLOAT_R: SETTINGS.navigation.floatRadius,
    KINDLE_TIME: SETTINGS.navigation.kindleTime, KINDLE_SPEED: SETTINGS.navigation.kindleSpeed,
    BOUNDS: SETTINGS.navigation.bounds,
    END_TIME: SETTINGS.navigation.endTime,
    STORM_STEPS: SETTINGS.weather.stormSteps,
    CAM_MIN_CLEAR: SETTINGS.navigation.cameraMinClear,
  };

  // ---------------------------------------------------------------------------
  // Module state (all allocated once)
  // ---------------------------------------------------------------------------
  let S = null, B = null, L = null, WN = null, W = null;   // TW.state, boat, lantern, wind, TW.world
  let raceMode = false;                                    // regatta active: suppress adventure objectives / kindling
  let rnd = Math.random;
  const sea = { x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0 };

  const touch = { steer: 0, trim: 0, kindle: false };
  const hudTarget = { index: 0, name: '', dist: 0, bearing: 0, isHeart: false };
  const hudRing = { index: 0, inRing: false, progress: 0 };
  const hud = {
    oil: 1, hull: 1, speed: 0, sail: 0, heading: 0, windAngle: 0, windSpeed: 0, pointOfSail: 'run', inIrons: false,
    target: null, ring: null, objective: '', lit: 0, total: 6, heartOpen: false, danger: 0, fade: 0,
  };
  const stats = { time: 0, floats: 0, floatsTotal: 0, knocks: 0, respawns: 0, distance: 0 };
  const debug = { events: [], autoLog: [], autopilot: null, minCamClear: 99, maxSlam: 0, slams: 0, maxDy: 0, maxDPitch: 0, maxDRoll: 0, go: null };

  const inp = { steer: 0, trim: 0, kindle: false };
  const keys = Object.create(null);
  const USED = { KeyA: 1, KeyD: 1, KeyW: 1, KeyS: 1, ArrowLeft: 1, ArrowRight: 1, ArrowUp: 1, ArrowDown: 1, Space: 1 };

  // boat dynamics scratch
  const bs = { u: 0, yawRate: 0, vy: 0, pv: 0, rv: 0, boomSide: 1, gybe: 0, slope: 0, slamCd: 0, gnx: 0, gnz: 1, immune: 0, bumpCd: 0, sink: 0, list: 0, theta: 180, side: 0, maw: 0, inner: 0 };
  const assist = { on: false, x: 0, z: 0, cap: 2 };       // kindling-ring auto-brake / centring
  const moor = { on: false, x: 0, z: 0 };                 // title anchor / ending mooring
  const respawnPt = { x: 0, z: 0, heading: 0, index: -1 };
  const resp = { mode: 0, t: 0, kind: '' };               // 0 none, 1 fading out, 2 fading in
  const spawnTmp = { x: 0, z: 0, heading: 0 };

  // weather director
  const WX = { stormBase: SETTINGS.weather.directorBase, squallT: -1, squallDur: 22, nextSquall: 80, gustT: -1, gustDur: 6, gustPeak: 0.3, nextGust: 14,
    boltT: 6, fury: 0, flashT: -1, flashAmp: 1, flashN: 2, f1: 0.08, f2: 0.18, ended: false, endT: 0, endStorm: 0.5 };

  // progression flags
  const G = { outerTotal: 5, heartIdx: -1, outerLit: 0, heartOpen: false, heartOpenSent: false, kindleIdx: -1, ringIdx: -1, moorIdx: -1, heartHold: -1, hushT: 0,
    tutT: 0, tutStep: 0, tipIrons: false, tipOil: false, tipHull: false, tipMaw: false, tipFloat: false, ironsT: 0,
    lowArmed: true, boundsCd: 0, heartCd: 0, prevPhase: 'sailing', autoSail: -1, flare: 0, introFade: 1, introRate: 0.7,
    objKey: '', hintCd: 0, dangerS: 0 };
  const hintQ = [];

  // camera rig
  const CK = { yaw: 0, yawVel: 0, by: 0, zoom: 1, oYaw: 0, oPitch: 0, drag: false, pid: -1, lastX: 0, lastY: 0, relT: 0,
    floor: 3, pull: 1, trauma: 0, wTitle: 1, wEnd: 0, wKin: 0, kinHold: 0, kinIdx: -1, snap: true, endIdx: -1, endYaw: 0,
    titleYaw: 0, titleHeart: 1e9, titleSea: 0, endD: 90, endAL: 0, endAxis: 0, endYawC: 0, heroOff: 0.3, heroSide: 0, heroMag: 0.3, heroR: 15, byF: 0, slow: 0, fov: 55, kick: 0, endSweep: 0 };

  // ===========================================================================
  // INPUT
  // ===========================================================================
  function clearKeys() { for (const k in keys) keys[k] = false; }

  // En multijoueur, un onglet peut perdre le focus pendant que l’autre joueur
  // est observé. La simulation doit donc rester active en arrière-plan ; la
  // pause manuelle (Échap/P) reste disponible comme avant.
  function keepRunningWhenHidden() { return TW.q && TW.q.get('multi') === '1'; }

  function onKeyDown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey || !S) return;
    const c = e.code, ph = S.phase;
    const inPlay = ph === 'sailing' || ph === 'free' || ph === 'ending';
    if (USED[c] && inPlay) e.preventDefault();          // arrows / space would scroll the page
    if (e.repeat) return;
    if (c === 'Escape' || c === 'KeyP') {
      // Deferred so that if another listener (the UI) toggles pause on this same key press we don't toggle twice.
      const p0 = ph;
      setTimeout(() => { if (S.phase !== p0) return; if (p0 === 'paused') resume(); else pause(); }, 0);
      return;
    }
    if (USED[c]) keys[c] = true;
    if (ph === 'title' && (c === 'Space' || c === 'Enter') && TW.ui && TW.ui.stub) start();   // dev convenience when the UI is stubbed
  }
  function onKeyUp(e) { if (USED[e.code]) keys[e.code] = false; }

  function gatherInput(dt) {
    let s = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
    let t = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
    const ts = +touch.steer || 0, tt = +touch.trim || 0;
    inp.steer = clamp(s + ts, -1, 1);
    inp.trim = clamp(t + tt, -1, 1);
    inp.kindle = !!(keys.Space || touch.kindle);
    if (AP.on) autopilot(dt);
  }

  // ---------------------------------------------------------------------------
  // Autopilot (play-testing only): a crude helmsman that sails the whole game unattended.
  // Steers for hud.target, feels ahead with whiskers for land / rocks / the Maw, tacks out of irons.
  // ---------------------------------------------------------------------------
  const AP = { on: false, tack: 1, tackT: 0, side: 1, stuckT: 0, flipT: 0, logged: false };
  function apBlocked(x, z, a, len, tx, tz) {
    const sx = Math.sin(a), sz = Math.cos(a), vo = W.vortex, rocks = W.rocks;
    for (let d = 6; d <= len; d += 6) {
      const px = x + sx * d, pz = z + sz * d;
      if (W.heightAt(px, pz) > -1.6) return true;
      if (W.heightAt(px + sz * 4, pz - sx * 4) > -1.2 || W.heightAt(px - sz * 4, pz + sx * 4) > -1.2) return true;   // keep a boat-width off
      if (hyp(px, pz) > T.BOUNDS - 20 && hyp(px, pz) > hyp(x, z)) return true;
    }
    if (vo && S.vortexStrength > 0.3) {
      // closest approach of the whisker to the Maw
      const ox = vo.x - x, oz = vo.z - z, t = clamp(ox * sx + oz * sz, 0, len), R = vo.r * 1.25;
      if (hyp(ox - sx * t, oz - sz * t) < R && hyp(ox, oz) > R * 0.9) return true;
    }
    if (rocks) for (let i = 0; i < rocks.length; i++) {
      const r = rocks[i], ox = r.x - x, oz = r.z - z, t = clamp(ox * sx + oz * sz, 0, len);
      if (hyp(ox - sx * t, oz - sz * t) < r.r + 7) return true;
    }
    return false;
  }
  function autopilot(dt) {
    const b = B, ph = S.phase;
    if (ph === 'title') { start(); return; }
    inp.steer = 0; inp.trim = 0; inp.kindle = false;
    if (ph !== 'sailing' || resp.mode !== 0) return;
    const tg = hud.target;
    if (!tg) return;
    let tx = W.beacons[tg.index].dock.x, tz = W.beacons[tg.index].dock.z, floatRun = false;
    // top up from a nearby float when the lantern runs low
    if (L.oil < 0.45 && W.floats) {
      let bd = Math.min(320, tg.dist);
      for (let i = 0; i < W.floats.length; i++) { const f = W.floats[i]; if (f.taken) continue; const d = hyp(f.x - b.x, f.z - b.z); if (d < bd) { bd = d; tx = f.x; tz = f.z; floatRun = true; } }
    }
    const dist = hyp(tx - b.x, tz - b.z);
    let want = Math.atan2(tx - b.x, tz - b.z);
    // out of irons: beat to windward on alternating tacks
    const windFrom = Math.atan2(-WN.dirX, -WN.dirZ), rel = wrap(want - windFrom);
    AP.tackT += dt;
    if (Math.abs(rel) < 46 * DEG && dist > 60) {
      if (rel * AP.tack < -0.3 || AP.tackT > 30) { AP.tack = -AP.tack; AP.tackT = 0; }
      want = windFrom + AP.tack * 50 * DEG;
    } else { AP.tack = rel >= 0 ? 1 : -1; AP.tackT = 0; }
    // whiskers: the free heading nearest the wanted one
    const len = clamp(dist - 4, 24, 150);
    AP.flipT -= dt;
    let best = want, found = false;
    for (let k = 0; k <= 14 && !found; k++) {
      for (let s = 0; s < 2 && !found; s++) {
        if (k === 0 && s === 1) continue;
        const a = want + (s === 0 ? AP.side : -AP.side) * k * 12 * DEG;
        if (!apBlocked(b.x, b.z, a, k > 9 ? Math.min(len, 60) : len, tx, tz)) { best = a; found = true; if (k > 0) AP.side = s === 0 ? AP.side : -AP.side; }
      }
    }
    const err = wrap(best - b.heading);
    inp.steer = clamp(-err * 2.5, -1, 1);
    // sail: everything she has, eased near the ring and in tight turns
    const sailWant = !floatRun && dist < 75 ? 0.35 : Math.abs(err) > 1.2 ? 0.6 : 1;
    inp.trim = b.sail < sailWant - 0.03 ? 1 : b.sail > sailWant + 0.03 ? -1 : 0;
    // stuck? flip the preferred side
    const inRing = G.ringIdx >= 0;
    AP.stuckT = b.speed < 0.7 && !inRing ? AP.stuckT + dt : 0;
    if (AP.stuckT > 6 && AP.flipT <= 0) { AP.side = -AP.side; AP.flipT = 8; AP.stuckT = 0; apLog('stuck', -1); }
  }
  function apLog(ev, index) {
    if (debug.autoLog.length > 300) return;
    debug.autoLog.push({ ev: ev, t: Math.round(stats.time * 10) / 10, index: index, name: index >= 0 && W.beacons[index] ? W.beacons[index].name : '',
      x: Math.round(B.x), z: Math.round(B.z), oil: Math.round(L.oil * 100) / 100, hull: Math.round(B.hull * 100) / 100 });
  }
  function setAutopilot(on) { AP.on = !!on; return AP.on; }

  // pointer orbit + wheel zoom on the canvas
  function canOrbit() { return S.phase === 'sailing' || S.phase === 'free'; }
  function onPointerDown(e) {
    if ((e.button !== undefined && e.button > 0) || (CK.pid !== -1 && CK.pid !== e.pointerId) || !canOrbit()) return;
    CK.drag = true; CK.pid = e.pointerId; CK.lastX = e.clientX; CK.lastY = e.clientY;
    try { TW.canvas.setPointerCapture(e.pointerId); } catch (err) { /* not capturable: fine */ }
  }
  function onPointerMove(e) {
    if (!CK.drag || e.pointerId !== CK.pid) return;
    const dx = e.clientX - CK.lastX, dy = e.clientY - CK.lastY;
    CK.lastX = e.clientX; CK.lastY = e.clientY;
    CK.oYaw -= dx * 0.0065;                      // drag right: the world follows the finger
    CK.oPitch = clamp(CK.oPitch + dy * 0.004, -0.28, 0.8);
  }
  function onPointerUp(e) {
    if (e.pointerId !== CK.pid) return;
    CK.drag = false; CK.pid = -1; CK.relT = 2.6; CK.oYaw = wrap(CK.oYaw);
  }
  function onWheel(e) {
    if (!canOrbit()) return;
    e.preventDefault();
    CK.zoom = clamp(CK.zoom * Math.exp(clamp(e.deltaY, -240, 240) * 0.0012), 0.65, 1.9);
  }

  // ===========================================================================
  // WEATHER DIRECTOR
  // ===========================================================================
  function stormTarget() {
    if (G.heartOpen) return 0.84;   // five lights burn: the gale gathers its last fury over the Heartlight, so its lighting can break it
    const st = T.STORM_STEPS, f = (G.outerTotal > 0 ? G.outerLit / G.outerTotal : 0) * (st.length - 1);
    const i = Math.min(st.length - 2, Math.floor(f));
    return lerp(st[i], st[i + 1], f - i);
  }

  function startGust(peak) {
    WX.gustT = 0; WX.gustDur = 5 + rnd() * 3.5; WX.gustPeak = peak;
    TW.emit('gust');
  }

  function strike() {
    const b = B, c = S.cam, r = rnd();
    const camYaw = Math.atan2(c.target[0] - c.pos[0], c.target[2] - c.pos[2]);
    let x = 0, z = 0, ok = false;
    if (r < 0.14 && W.islands && W.islands.length) {
      // behind an island that is in the shot, for a silhouette
      const n = W.islands.length, i0 = (rnd() * n) | 0;
      for (let k = 0; k < n && !ok; k++) {
        const is = W.islands[(i0 + k) % n], dx = is.x - b.x, dz = is.z - b.z, d = hyp(dx, dz) || 1;
        if (d < 250 || d > 1300 || Math.abs(wrap(Math.atan2(dx, dz) - camYaw)) > 0.7) continue;
        const beyond = (is.r || 100) + 100 + rnd() * 220;
        x = is.x + (dx / d) * beyond; z = is.z + (dz / d) * beyond;
        ok = true;
      }
    }
    if (!ok) {
      // mostly ahead of the lens (within +-35 deg) and far enough to read as a whole bolt against the sky
      const front = r < 0.92;
      const ang = front ? camYaw + (rnd() - 0.5) * 1.2 : rnd() * 2 * PI;
      const dist = front ? 400 + rnd() * 700 : 450 + rnd() * 750;
      x = b.x + Math.sin(ang) * dist; z = b.z + Math.cos(ang) * dist;
    }
    let dd = hyp(x - b.x, z - b.z);
    if (dd < 300) { const k = 300 / Math.max(dd, 1); x = b.x + (x - b.x) * k; z = b.z + (z - b.z) * k; dd = 300; }   // never on top of the skiff
    const lt = S.lightning;
    lt.x = x; lt.y = 0; lt.z = z; lt.seed = 1 + ((rnd() * 9973) | 0);
    WX.flashT = 0; WX.flashAmp = 1 + rnd() * 0.4;
    WX.flashN = rnd() < 0.45 ? 3 : 2; WX.f1 = 0.06 + rnd() * 0.05; WX.f2 = 0.15 + rnd() * 0.08;
    if (dd < 500) CK.trauma = Math.min(1, CK.trauma + 0.05 + 0.1 * (1 - (dd - 300) / 200));   // only the near ones rattle the lens, and only just
    TW.emit('lightning', { x: x, y: 0, z: z, dist: dd });
  }

  function updateWeather(dt) {
    const ph = S.phase, t = S.time, sailing = ph === 'sailing';
    let es = 0;
    if (WX.ended) { WX.endT += dt; es = smooth(0, T.END_TIME, WX.endT); }

    // storm level: steps down with each light, breathes, and peaks in squalls
    // (the ending front-loads the drop, ~0.45 by 10 s, so the sky is seen to open while the camera is still on the tower)
    if (WX.ended) WX.stormBase = lerp(WX.endStorm, 0.12, 0.54 * smooth(4, 14, WX.endT) + 0.46 * smooth(10, T.END_TIME, WX.endT));   // hold the gale ~4 s so the sky is seen to tear open over the lamp
    else WX.stormBase = damp(WX.stormBase, stormTarget(), 0.12, dt);
    // the gale's last fury: once the outer lights burn it gathers over the Heartlight until that light breaks it
    const furyOn = G.heartOpen && !WX.ended && G.heartIdx >= 0 && sailing;
    WX.fury = WX.ended ? WX.fury * (1 - smooth(1.5, 6, WX.endT)) : damp(WX.fury, furyOn ? 1 : 0, 0.2, dt);
    const fury = WX.fury;
    let sq = 0;
    if (WX.squallT >= 0) {
      WX.squallT += dt;
      const q = WX.squallT, D = WX.squallDur;
      sq = smooth(0, 5, q) * (1 - smooth(D - 8, D, q));
      if (WX.ended) sq *= 1 - smooth(0, 6, WX.endT);
      if (q >= D) { WX.squallT = -1; WX.nextSquall = SETTINGS.weather.squallCooldown[0] + rnd() * SETTINGS.weather.squallCooldown[1]; }
    } else if (sailing && !WX.ended) {
      WX.nextSquall -= dt;
      if (WX.nextSquall <= 0) { WX.squallT = 0; WX.squallDur = SETTINGS.weather.squallDuration[0] + rnd() * SETTINGS.weather.squallDuration[1]; startGust(0.5); }
    }
    const breath = TW.noise2(t * 0.035, 7.7, 21) * 2 - 1;
    S.storm = sat(WX.stormBase + breath * 0.05 * (1 - 0.8 * es) + sq * 0.07);
    const rb = lerp(SETTINGS.weather.rainBaseMin, SETTINGS.weather.rainBaseMax, TW.noise2(t * 0.05, 3.1, 22));
    const rf = lerp(rb, SETTINGS.weather.furyRainBase + SETTINGS.weather.furyRainNoise * TW.noise2(t * 0.11, 5.9, 24), sat(fury));          // driving rain for the finale
    const hush = S.heart.hush;
    // the hush thins the rain to ~35 %; after T0 it drives on for 1.5 s, then the ring of light kills it (gone by T0+6)
    S.rain = sat((rf + sq * (1 - rf)) * (WX.ended ? 1 - smooth(1.5, 6, WX.endT) : 1) * lerp(1, 0.62, hush));
    const RT = SETTINGS.runtime || {};
    if (RT.manualWeather) {
      if (RT.storm !== null && RT.storm !== undefined) S.storm = sat(RT.storm);
      if (RT.rain !== null && RT.rain !== undefined) S.rain = sat(RT.rain);
    }
    S.dawn = WX.ended ? es : 0;
    S.vortexStrength = WX.ended ? 1 - smooth(0, 20, WX.endT) : 1;
    S.tide = 0;

    // wind: wanders slowly +-25 deg about the NE-to-E trade-wind sector
    const wob = clamp((TW.noise2(t * 0.012, 1.3, 23) * 2 - 1) * 1.5, -1, 1);
    const wa = TW.env.prevailing + wob * SETTINGS.wind.wobbleDegrees * DEG;
    WN.dirX = Math.sin(wa); WN.dirZ = Math.cos(wa);
    WN.speed = lerp(SETTINGS.wind.speedMin, SETTINGS.wind.speedMax, S.storm) * lerp(1, SETTINGS.wind.hushSpeedScale, hush);
    if (RT.manualWind) {
      if (RT.windAngle !== null && RT.windAngle !== undefined) { WN.dirX = Math.sin(RT.windAngle); WN.dirZ = Math.cos(RT.windAngle); }
      if (RT.windSpeed !== null && RT.windSpeed !== undefined) WN.speed = Math.max(0, RT.windSpeed);
    }            // the gale holds its breath
    if (WX.gustT >= 0) {
      WX.gustT += dt;
      const q = WX.gustT, D = WX.gustDur;
      WN.gust = WX.gustPeak * smooth(0, 1.5, q) * (1 - smooth(D - 3.5, D, q));
      if (q >= D) { WX.gustT = -1; WN.gust = 0; WX.nextGust = (15 + rnd() * 25) * lerp(1, 0.55, sat(fury)); }
    } else {
      WN.gust = 0;
      WX.nextGust -= dt;
      if (WX.nextGust <= 0) startGust(Math.min(0.5, (0.2 + rnd() * 0.3) * lerp(0.5, 1, sat(S.storm * 1.6)) * (1 + 0.5 * fury)));
    }

    if (hush > 0) WN.gust *= 1 - hush;
    // lightning: none once the Heartlight kindle is under way, none in the hush, none at all during the ending
    const heartKindling = G.heartIdx >= 0 && (G.kindleIdx === G.heartIdx || G.heartHold >= 0);
    if (heartKindling || hush > 0.02 || WX.ended) {
      if (hush > 0.02 || WX.ended) { WX.flashT = -1; S.flash = S.flash > 0.004 ? S.flash * Math.exp(-dt * 28) : 0; }   // nothing in flight survives
      if (WX.boltT < 4) WX.boltT = 4;
    } else if (S.dawn < 0.3 && S.storm > 0.58 && !(TW.multiplayer && TW.multiplayer.isConnected && TW.multiplayer.isConnected() && !TW.multiplayer.isWeatherHost())) {
      WX.boltT -= dt;
      if (WX.boltT <= 0) {
        WX.boltT = (6 + 12 * rnd()) * lerp(1.3, 0.85, sat((S.storm - 0.4) / 0.5)) * lerp(1, 0.6, sat(fury));
        strike();
      }
    }
    if (WX.flashT >= 0) {
      WX.flashT += dt;
      const ft = WX.flashT;
      let f = Math.exp(-ft * 15);
      if (ft >= WX.f1) f = Math.max(f, 0.6 * Math.exp(-(ft - WX.f1) * 15));
      if (WX.flashN > 2 && ft >= WX.f2) f = Math.max(f, 0.85 * Math.exp(-(ft - WX.f2) * 13));
      S.flash = WX.flashAmp * f;
      if (ft > 0.6) { WX.flashT = -1; S.flash = 0; }
    } else if (!(hush > 0.02 || WX.ended)) S.flash = 0;
  }

  // ===========================================================================
  // BOAT PHYSICS
  // ===========================================================================
  // Speed polar: fraction of top speed vs. angle off the wind (deg; 0 = head to wind, 180 = dead run).
  const POLAR_A = [0, 30, 38, 50, 70, 90, 115, 140, 160, 180];
  const POLAR_V = [0, 0, 0.36, 0.74, 0.90, 0.97, 1.0, 0.97, 0.89, 0.82];
  function polar(deg) {
    for (let i = 1; i < POLAR_A.length; i++) {
      if (deg <= POLAR_A[i]) return lerp(POLAR_V[i - 1], POLAR_V[i], (deg - POLAR_A[i - 1]) / (POLAR_A[i] - POLAR_A[i - 1]));
    }
    return POLAR_V[POLAR_V.length - 1];
  }

  function placeBoat(x, z, heading, speed) {
    const b = B;
    speed = speed || 0;
    b.x = x; b.z = z; b.heading = wrap(heading);
    b.vx = Math.sin(heading) * speed; b.vz = Math.cos(heading) * speed; b.speed = speed;
    b.y = TW.env.seaHeight(x, z, sea) + 0.04; b.pitch = 0; b.roll = 0; b.rudder = 0; b.aground = 0;
    bs.u = speed; bs.yawRate = 0; bs.vy = 0; bs.pv = 0; bs.rv = 0; bs.sink = 0; bs.list = 0; bs.slope = 0; bs.gybe = 0;
    CK.snap = true; CK.oYaw = 0; CK.oPitch = 0;
  }

  function isLive() { return (S.phase === 'sailing' || S.phase === 'free') && resp.mode === 0 && G.heartHold < 0; }

  function stepBoat(h) {
    const b = B, ph = S.phase, live = isLive(), E = TW.env;
    const steerIn = live ? inp.steer : 0, trimIn = live ? inp.trim : 0;
    bs.slamCd -= h; bs.immune -= h; bs.bumpCd -= h;

    // ---- sail & helm ----
    if (live) {
      if (trimIn !== 0) { b.sail = clamp(b.sail + trimIn * T.SAIL_RATE * h, 0, 1); G.autoSail = -1; }
      else if (G.autoSail >= 0) { b.sail = approach(b.sail, G.autoSail, T.SAIL_RATE * h); if (b.sail === G.autoSail) G.autoSail = -1; }
    } else if (ph === 'title') b.sail = damp(b.sail, 0.1, 2, h);
    else if (ph === 'ending') b.sail = damp(b.sail, 0.3, 0.8, h);
    b.rudder = damp(b.rudder, steerIn, Math.abs(steerIn) > Math.abs(b.rudder) ? 7 : 9, h);

    // ---- currents and forced turns (the Maw, the edge of the world, moorings) ----
    let cx = 0, cz = 0, autoYaw = 0;
    bs.maw = 0; bs.inner = 0;
    const vs = S.vortexStrength, vo = W.vortex;
    if (vs > 0.01 && vo) {
      const ox = b.x - vo.x, oz = b.z - vo.z, d = hyp(ox, oz), R = vo.r * 2.2;
      if (d < R) {
        const t = 1 - d / R, k = 1 / Math.max(d, 1);
        const tang = vs * 7.0 * Math.pow(t, 1.5) * sat(d / (vo.r * 0.15));
        const inw = vs * (0.5 * t + 5.0 * t * t) * sat(d / (vo.r * 0.1));
        cx += -oz * k * tang - ox * k * inw;
        cz += ox * k * tang - oz * k * inw;
        bs.maw = t * vs;
        autoYaw += tang * k * 0.8;                             // the swirl carries the bow round with it
        const inner = vs * (1 - smooth(vo.r * 0.08, vo.r * 0.25, d));
        if (inner > 0) {
          bs.inner = inner;
          autoYaw += 1.1 * inner;                              // the funnel spins the skiff with the current
          if (CK.trauma < 0.4 * inner) CK.trauma = 0.4 * inner;
          if (live && ph === 'sailing') {
            b.hull -= 0.11 * inner * h;
            if (b.hull <= 0) { b.hull = 0; stats.knocks++; beginRespawn('wreck'); }
          }
        }
      }
    }
    const dc = hyp(b.x, b.z);
    if (dc > T.BOUNDS) {
      const p = sat((dc - T.BOUNDS) / 160);
      cx -= (b.x / dc) * 9 * p; cz -= (b.z / dc) * 9 * p;
      autoYaw -= clamp(wrap(Math.atan2(-b.x, -b.z) - b.heading), -1, 1) * 0.75 * p;   // swing the bow home
      if (live && G.boundsCd <= 0) { G.boundsCd = 25; hint('Van-fò-la ka viré-w dèyè, an direksyon zil-yo.', true); }
    }
    if (assist.on && live) {
      const dx = assist.x - b.x, dz = assist.z - b.z, d = hyp(dx, dz);
      if (d > 0.5) { const pull = Math.min(1.5, d * 0.12) / d; cx += dx * pull; cz += dz * pull; }
    }
    if (moor.on && !live) { cx += (moor.x - b.x) * 0.45; cz += (moor.z - b.z) * 0.45; }

    // ---- yaw ----
    const au = Math.abs(bs.u);
    const auth = T.TURN_REST + (1 - T.TURN_REST) * sat(au / 5.5) - 0.12 * sat((au - 8) / 4);
    bs.yawRate = damp(bs.yawRate, b.rudder * T.TURN * auth + autoYaw, T.YAW_RESP, h);
    b.heading = wrap(b.heading - bs.yawRate * h);
    const fx = Math.sin(b.heading), fz = Math.cos(b.heading);

    // ---- wind & point of sail ----
    const wspd = WN.speed * (1 + WN.gust);
    const theta = Math.acos(clamp(-(fx * WN.dirX + fz * WN.dirZ), -1, 1)) / DEG;   // 0 = head to wind
    const side = WN.dirX * fz - WN.dirZ * fx;        // > 0: wind blows toward port (comes over the starboard side)
    bs.theta = theta; bs.side = side;
    const windF = Math.pow(clamp(wspd / 17, 0.25, 1.2), 0.45);
    const sailEff = Math.pow(b.sail, 0.75);
    b.luff = damp(b.luff, b.sail > 0.05 && ph !== 'title' ? 1 - smooth(30, 44, theta) : 0, 5, h);

    // boom: swings to leeward, eased further out as the wind comes aft; gybes cost a little way
    const want = side > 0 ? -1 : 1;
    if (want !== bs.boomSide && Math.abs(side) > 0.12) {
      bs.boomSide = want;
      if (live) TW.emit('sailing:maneuver', { kind: theta > 100 && b.sail > 0.2 ? 'gybe' : 'tack', side: want });
      if (theta > 100 && b.sail > 0.2 && live) { bs.gybe = 1; CK.trauma = Math.min(1, CK.trauma + 0.12); }
    }
    bs.gybe = Math.max(0, bs.gybe - h * 1.1);
    const boomMag = lerp(0.14, 80 * DEG, smooth(35, 172, theta)) * (0.15 + 0.85 * sat(b.sail * 1.6));
    b.boom = damp(b.boom, bs.boomSide * boomMag, 4.5, h);

    // ---- drive: world velocity resolved on the (new) keel line, so turning produces real side-slip ----
    let u = b.vx * fx + b.vz * fz, v = b.vx * fz - b.vz * fx;
    let vT = 0, rate = 1.0;
    if (live) {
      vT = T.VMAX * polar(theta) * windF * sailEff * (1 - 0.3 * bs.gybe);
      rate = vT > u ? T.ACCEL : T.DECEL;
      if (trimIn < 0 && b.sail < 0.05) rate = T.BRAKE;
      if (assist.on && vT > assist.cap) { vT = assist.cap; if (u > vT) rate = 1.3; }
    }
    u += (vT - u) * (1 - Math.exp(-rate * h));
    if (live) u -= clamp(bs.slope, -0.3, 0.3) * T.SURF * h * sat(au * 0.5 + 0.25);   // surf down faces, labour up them
    u -= u * Math.abs(bs.yawRate) * T.TURN_BLEED * h;
    const vLee = live ? side * 0.55 * sailEff * windF * (1 - b.luff) : 0;
    v = damp(v, vLee, T.LAT_DAMP, h);
    b.vx = fx * u + fz * v; b.vz = fz * u - fx * v;
    b.speed = hyp(b.vx, b.vz);
    bs.u = u;
    b.x += (b.vx + cx) * h; b.z += (b.vz + cz) * h;
    if (live) stats.distance += b.speed * h;

    // ---- land and rocks ----
    b.aground = Math.max(0, b.aground - 2 * h);
    collide(h);
    if (b.aground > 0.05) {
      // while touching, let the bow fall off toward open water so nobody stays pinned on a lee shore
      const fn = fx * bs.gnx + fz * bs.gnz;                 // bow . n  (< 0: still pointing at the obstacle)
      if (fn < 0.35) {
        const pn = fz * bs.gnx - fx * bs.gnz;               // port . n
        const turn = Math.abs(pn) < 0.45 ? (b.rudder > 0.15 ? -0.45 : b.rudder < -0.15 ? 0.45 : pn < 0 ? -0.45 : 0.45) : pn;   // head-on: pick a side (the helm's, if any)
        b.heading = wrap(b.heading + clamp(turn * 1.6, -1, 1) * 1.1 * b.aground * h);
      }
    }

    // ---- wave riding: four hull samples -> heave / pitch / roll springs ----
    const hb = E.seaHeight(b.x + fx * 2.5, b.z + fz * 2.5, sea);
    const hs = E.seaHeight(b.x - fx * 2.3, b.z - fz * 2.3, sea);
    const hp = E.seaHeight(b.x + fz * 1.05, b.z - fx * 1.05, sea);
    const hq = E.seaHeight(b.x - fz * 1.05, b.z + fx * 1.05, sea);
    bs.slope = (hb - hs) / 4.8;
    const yT = (hb + hs) * 0.27 + (hp + hq) * 0.23 + 0.04 - bs.sink;
    const y0 = b.y, p0 = b.pitch, r0 = b.roll;
    bs.vy += (T.HEAVE_K * (yT - b.y) - T.HEAVE_C * bs.vy) * h; b.y += bs.vy * h;
    const pT = -Math.atan2(hb - hs, 4.8) * 0.92;
    bs.pv += (T.PITCH_K * (pT - b.pitch) - T.PITCH_C * bs.pv) * h; b.pitch += bs.pv * h;
    const heel = -side * 0.2 * sailEff * windF * (1 - 0.75 * b.luff) * (live ? 1 : 0.5);   // lee rail down
    const lean = clamp(bs.yawRate * u * 0.011, -0.14, 0.14);                              // lean into the turn
    const rT = Math.atan2(hp - hq, 2.1) * 0.62 + heel + lean + bs.list;
    bs.rv += (T.ROLL_K * (rT - b.roll) - T.ROLL_C * bs.rv) * h; b.roll += bs.rv * h;
    b.pitch = clamp(b.pitch, -0.7, 0.7); b.roll = clamp(b.roll, -0.9, 0.9);

    // slams: the bow dropping hard at speed
    const slam = bs.pv * (0.35 + 0.085 * Math.abs(u)) + Math.max(0, -bs.vy) * 0.12;
    if (slam > debug.maxSlam) debug.maxSlam = slam;
    debug.slam = slam;
    const dy = Math.abs(b.y - y0), dp = Math.abs(b.pitch - p0), dr = Math.abs(b.roll - r0);
    if (dy > debug.maxDy) debug.maxDy = dy;
    if (dp > debug.maxDPitch) debug.maxDPitch = dp;
    if (dr > debug.maxDRoll) debug.maxDRoll = dr;
    if (slam > T.SLAM && bs.slamCd <= 0 && live) {
      const strength = sat((slam - T.SLAM) / T.SLAM);
      bs.slamCd = 2.4; debug.slams++;
      CK.trauma = Math.min(1, CK.trauma + 0.14 + 0.26 * strength); CK.kick = Math.min(1, CK.kick + 0.4 + 0.6 * strength);
      if (ph === 'sailing') L.oil = Math.max(0, L.oil - (0.001 + 0.004 * strength));   // green water over the bow swamps the lantern
      b.vx *= 1 - 0.05 * strength; b.vz *= 1 - 0.05 * strength;
      TW.emit('bigWave', { strength: strength, x: b.x + fx * 2.5, z: b.z + fz * 2.5 });
    }
  }

  // ===========================================================================
  // COLLISIONS
  // ===========================================================================
  const PROBE_F = [2.7, -2.5, 0.3, 0.3, 0.0];   // along the keel (m)
  const PROBE_S = [0.0, 0.0, 1.15, -1.15, 0.0]; // to port (m)

  function hit(impact, x, z) {
    const b = B, playing = S.phase === 'sailing' || S.phase === 'free';
    const hurts = impact > T.HIT_MIN && bs.immune <= 0 && playing && resp.mode === 0;
    if (impact > 1.1 && (bs.bumpCd <= 0 || hurts)) {
      const strength = sat((impact - 0.8) / 8);
      bs.bumpCd = 0.4;
      CK.trauma = Math.min(1, CK.trauma + 0.25 + 0.6 * strength);
      TW.emit('bump', { strength: strength, x: x, z: z });
    }
    if (hurts) {
      b.hull -= Math.min(0.4, 0.05 + (impact - T.HIT_MIN) * 0.045);
      bs.immune = 1.0; stats.knocks++;
      if (S.phase === 'free') b.hull = Math.max(b.hull, 0.15);       // no wrecks after the dawn
      if (b.hull <= 0) { b.hull = 0; beginRespawn('wreck'); }
      else if (!G.tipHull && b.hull < 0.75) { G.tipHull = true; hint('Kò bato-la fann. I ka réparé lè ou mare bò on baliz ki ja limé.'); }
    }
  }

  // Push the hull out along unit normal (nx, nz) by `push` metres and resolve the velocity against it.
  function resolve(nx, nz, push, px, pz, h) {
    const b = B;
    b.x += nx * push; b.z += nz * push;
    const vn = b.vx * nx + b.vz * nz;
    if (vn < 0) {
      const impact = -vn, fr = 1 - 0.4 * sat(impact / 5);
      const tx = b.vx - vn * nx, tz = b.vz - vn * nz;         // tangential part survives (scraped down)
      b.vx = tx * fr + nx * impact * 0.18; b.vz = tz * fr + nz * impact * 0.18;
      bs.u = b.vx * Math.sin(b.heading) + b.vz * Math.cos(b.heading);
      b.speed = hyp(b.vx, b.vz);
      hit(impact, px, pz);
    }
    // let the bow fall off toward open water so nobody stays pinned
    bs.gnx = nx; bs.gnz = nz;
    b.aground = 1;
  }

  function collide(h) {
    const b = B, tide = S.tide;
    const fx = Math.sin(b.heading), fz = Math.cos(b.heading);
    // --- terrain: deepest-grounded probe wins ---
    let worst = 0, wx = 0, wz = 0;
    for (let i = 0; i < 5; i++) {
      const px = b.x + fx * PROBE_F[i] + fz * PROBE_S[i], pz = b.z + fz * PROBE_F[i] - fx * PROBE_S[i];
      const d = W.heightAt(px, pz) - tide + 0.5;
      if (d > worst) { worst = d; wx = px; wz = pz; }
    }
    if (worst > 0) {
      const e = 1.5;
      let gx = W.heightAt(wx + e, wz) - W.heightAt(wx - e, wz), gz = W.heightAt(wx, wz + e) - W.heightAt(wx, wz - e);
      let gl = hyp(gx, gz);
      if (gl < 1e-4) { gx = fx; gz = fz; gl = 1; }          // flat ground: back out the way we came
      const nx = -gx / gl, nz = -gz / gl, slope = Math.max(gl / (2 * e), 0.15);
      resolve(nx, nz, Math.min(worst / slope, 1.2) + 0.02, wx, wz, h);
    }
    // --- sea stacks: circles against three points along the keel ---
    const rocks = W.rocks;
    if (rocks) {
      for (let i = 0; i < rocks.length; i++) {
        const r = rocks[i], R = r.r + 1.0, ddx = b.x - r.x, ddz = b.z - r.z;
        if (Math.abs(ddx) > R + 3 || Math.abs(ddz) > R + 3) continue;
        for (let k = -1; k <= 1; k++) {
          const px = b.x + fx * 2.1 * k, pz = b.z + fz * 2.1 * k;
          const dx = px - r.x, dz = pz - r.z, d = hyp(dx, dz);
          if (d < R) {
            const il = d > 1e-3 ? 1 / d : 0;
            resolve(il ? dx * il : -fx, il ? dz * il : -fz, R - d + 0.02, px - dx * il * 1.0, pz - dz * il * 1.0, h);
            break;
          }
        }
      }
    }
  }

  function applyNetworkCollision(contact) {
    if (!contact || !B || !isFinite(contact.impact)) return false;
    const ix = clamp(Number(contact.impulseX) || 0, -6, 6), iz = clamp(Number(contact.impulseZ) || 0, -6, 6);
    const px = clamp(Number(contact.pushX) || 0, -1.5, 1.5), pz = clamp(Number(contact.pushZ) || 0, -1.5, 1.5);
    B.x += px; B.z += pz; B.vx += ix; B.vz += iz; B.speed = hyp(B.vx, B.vz);
    bs.u = B.vx * Math.sin(B.heading) + B.vz * Math.cos(B.heading);
    hit(clamp(Number(contact.impact), 0, 10), Number(contact.x) || B.x, Number(contact.z) || B.z);
    return true;
  }

  function applyNetworkObjectives(snapshot) {
    if (!snapshot || !S) return;
    if (Array.isArray(snapshot.beacons) && Array.isArray(S.beacons)) {
      for (let i = 0; i < Math.min(snapshot.beacons.length, S.beacons.length); i++) if (snapshot.beacons[i]) {
        S.beacons[i].kindled = true; S.beacons[i].lit = 1; S.beacons[i].progress = 1;
      }
    }
    if (Array.isArray(snapshot.floats) && W && Array.isArray(W.floats)) {
      for (let i = 0; i < Math.min(snapshot.floats.length, W.floats.length); i++) if (snapshot.floats[i]) W.floats[i].taken = true;
    }
  }

  function applyNetworkWeather(weather) {
    if (!weather || !S || !S.wind) return;
    const unit = (value, fallback) => isFinite(Number(value)) ? Number(value) : fallback;
    S.time = Math.max(0, unit(weather.time, S.time));
    S.storm = clamp(unit(weather.storm, S.storm), 0, 1); S.rain = clamp(unit(weather.rain, S.rain), 0, 1);
    S.flash = clamp(unit(weather.flash, S.flash), 0, 1.6); S.dawn = clamp(unit(weather.dawn, S.dawn), 0, 1);
    S.daylight = clamp(unit(weather.daylight, S.daylight), 0, 1); S.tide = clamp(unit(weather.tide, S.tide), -10, 10);
    S.vortexStrength = clamp(unit(weather.vortexStrength, S.vortexStrength), 0, 1);
    if (weather.wind) {
      const dx = unit(weather.wind.dirX, WN.dirX), dz = unit(weather.wind.dirZ, WN.dirZ), len = hyp(dx, dz) || 1;
      WN.dirX = dx / len; WN.dirZ = dz / len; WN.speed = clamp(unit(weather.wind.speed, WN.speed), 0, 40);
      WN.gust = clamp(unit(weather.wind.gust, WN.gust), 0, 1.5);
    }
    if (weather.lightning && S.lightning) {
      S.lightning.x = unit(weather.lightning.x, S.lightning.x); S.lightning.y = unit(weather.lightning.y, S.lightning.y);
      S.lightning.z = unit(weather.lightning.z, S.lightning.z); S.lightning.seed = unit(weather.lightning.seed, S.lightning.seed);
    }
    if (weather.heart && S.heart) { S.heart.hush = clamp(unit(weather.heart.hush, S.heart.hush), 0, 1); S.heart.t = unit(weather.heart.t, S.heart.t); }
  }

  // ===========================================================================
  // PROGRESSION: beacons, kindling, floats, lantern, respawn
  // ===========================================================================
  function logEvents() {
    const names = ['start', 'beaconKindling', 'beaconLit', 'pickup', 'bump', 'wreck', 'lanternOut', 'respawn', 'lightning', 'gust',
      'lanternLow', 'pause', 'resume', 'heartOpen', 'ending', 'restart', 'hint', 'bigWave'];
    names.forEach((n) => TW.on(n, (d) => { if (debug.events.length < 400) debug.events.push(n === 'hint' ? 'hint:' + d.text : n); }));
  }

  function hint(text, urgent) {
    if (hintQ.indexOf(text) >= 0) return;
    if (urgent) { hintQ.unshift(text); if (G.hintCd > 0.6) G.hintCd = 0.6; } else if (hintQ.length < 6) hintQ.push(text);
  }

  // Where the skiff wakes at beacon i: on its landing, bow toward open water.
  function dockSpawn(i, out) {
    const wb = W.beacons[i], d = wb.dock;
    let ax = d.x - wb.x, az = d.z - wb.z, l = hyp(ax, az);
    if (l < 1) { ax = 0; az = -1; l = 1; }
    ax /= l; az /= l;
    let x = d.x, z = d.z;
    for (let k = 0; k < 14 && W.heightAt(x, z) > -2; k++) { x += ax * 5; z += az * 5; }
    const base = Math.atan2(ax, az), tries = [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.4, -2.4, PI];
    let best = base;
    for (let k = 0; k < tries.length; k++) {
      const a = base + tries[k], sx = Math.sin(a), sz = Math.cos(a);
      let clear = W.heightAt(x + sx * 25, z + sz * 25) < -3 && W.heightAt(x + sx * 60, z + sz * 60) < -3 && W.heightAt(x + sx * 110, z + sz * 110) < -3;
      if (clear && W.rocks) for (let q = 0; q < W.rocks.length && clear; q++) {      // no sea stack dead ahead either
        const r = W.rocks[q], ox = r.x - x, oz = r.z - z, t = clamp(ox * sx + oz * sz, 0, 160);
        if (hyp(ox - sx * t, oz - sz * t) < r.r + 9) clear = false;
      }
      if (clear) { best = a; break; }
    }
    out.x = x; out.z = z; out.heading = wrap(best);
    return out;
  }

  function nearestUnlit(includeLockedHeart) {
    const wb = W.beacons, sb = S.beacons;
    let bi = -1, bd = 1e12;
    for (let i = 0; i < wb.length; i++) {
      if (sb[i].kindled) continue;
      if (wb[i].isHeart && !G.heartOpen && !includeLockedHeart) continue;
      let d = hyp(wb[i].dock.x - B.x, wb[i].dock.z - B.z);
      // prefer lights that are not a dead beat to windward (prevailing wind blows toward (0.5, 0.866))
      d *= 1 + 0.9 * Math.max(0, -((wb[i].dock.x - B.x) * 0.5 + (wb[i].dock.z - B.z) * 0.866) / (d || 1));
      if (d < bd) { bd = d; bi = i; }
    }
    return bi;
  }

  function setHeartPos() {
    const hb = G.heartIdx >= 0 ? W.beacons[G.heartIdx] : null, H = S.heart;
    if (hb) { H.x = hb.lamp[0]; H.y = hb.lamp[1]; H.z = hb.lamp[2]; }
  }

  // The Heartlight ignition clock (CONTRACT addendum v12): hush = the held breath before the lamp catches, t = s since.
  function updateHeart(dt) {
    const H = S.heart;
    setHeartPos();
    if (H.t >= 0) H.t += dt;
    if (G.heartHold >= 0) {
      // kindle complete: 0.45 s with the lamp still dark, everything held, then it catches (T0)
      G.heartHold += dt; H.hush = 1;
      if (G.heartHold >= 0.45) {
        G.heartHold = -1;
        CK.kick = Math.max(CK.kick, 0.3);              // the faintest jolt as it catches
        lightBeacon(G.heartIdx);                       // 'beaconLit' + 'ending' fire here; beginEnding starts H.t
      }
      return;
    }
    const hi = G.heartIdx, kind = hi >= 0 && G.kindleIdx === hi && H.t < 0 && G.hushT > 0;
    if (kind) H.hush = Math.min(G.hushT, H.hush + dt * 1.5);          // smooth in the kindle's last ~1.8 s
    else H.hush = Math.max(0, H.hush - dt / (H.t >= 0 ? 0.3 : 0.6));  // caught: gone in 0.3 s; abandoned: 0.6 s
    G.hushT = 0;
  }

  function lightBeacon(i) {
    const wb = W.beacons[i], sb = S.beacons[i];
    sb.kindled = true; sb.progress = 1;
    L.oil = 1; B.hull = Math.min(1, B.hull + 0.35); G.flare = 1; G.lowArmed = true;
    dockSpawn(i, respawnPt); respawnPt.index = i;
    let lit = 0, outer = 0;
    for (let k = 0; k < S.beacons.length; k++) if (S.beacons[k].kindled) { lit++; if (!W.beacons[k].isHeart) outer++; }
    S.litCount = lit; G.outerLit = outer; G.heartOpen = outer >= G.outerTotal;
    G.kindleIdx = -1; assist.on = false;
    G.moorIdx = i;                                    // she lies moored in the ring until the helm is touched
    CK.kinIdx = i; CK.kinHold = 4.6;                 // hold the shot through the 2.5 s ignition ramp and ~2 s beyond
    if (!wb.isHeart) { EX.t = 0; EX.amp = 0.18; }     // the eye catches the flare (the Heartlight has its own exposure score)
    TW.emit('beaconLit', { index: i, count: lit, total: S.beacons.length, isHeart: !!wb.isHeart });
    if (wb.isHeart || lit >= S.beacons.length) beginEnding(i);
  }

  function beginEnding(i) {
    if (WX.ended) return;
    WX.ended = true; WX.endT = 0; WX.endStorm = WX.stormBase;
    S.phase = 'ending';
    moor.on = true; moor.x = B.x; moor.z = B.z;
    const idx = i >= 0 ? i : G.heartIdx >= 0 ? G.heartIdx : 0;
    CK.endIdx = idx;
    const lp = W.beacons[idx] ? W.beacons[idx].lamp : null;
    const sd = TW.env.look.sunDir, aS = hyp(sd[0], sd[2]) > 0.2 ? Math.atan2(sd[0], sd[2]) : Math.atan2(0.90, -0.40);   // toward the sunrise
    const aL = lp ? Math.atan2(lp[0] - B.x, lp[2] - B.z) : B.heading;                                                    // toward the lamp
    const aspect = TW.env.sceneW / Math.max(1, TW.env.sceneH), tfC = Math.tan(30 * DEG);
    const sgn = wrap(aL - aS) >= 0 ? 1 : -1;                         // which side of the sun the tower stands
    CK.endAL = aL;
    if (CK.wKin < 0.05) CK.heroSide = 0;                            // no kindle shot running: choose the quarter afresh
    CK.endAxis = aS + sgn * Math.atan(0.38 * tfC * aspect);          // final view axis: sun on a rule-of-thirds line, tower on the other
    CK.endYawC = CK.endAxis - sgn * Math.atan(0.2 * tfC * aspect);   // ... with the skiff in the foreground between them, by the glitter path
    CK.endD = 90;                                                    // far enough for the wide, near enough that she still reads
    if (S.heart.t < 0) S.heart.t = 0;                                // T0
    if (CK.wKin > 0.85 && CK.kinIdx === idx) CK.wEnd = 1;            // the kindle shot IS the opening of the ending: no blend, no cut
    hintQ.length = 0;
    TW.emit('ending');
  }

  function updateProgress(dt) {
    const wb = W.beacons, sb = S.beacons, b = B, ph = S.phase;
    if (raceMode) { assist.on = false; G.kindleIdx = -1; G.ringIdx = -1; G.objKey = 'race'; hud.objective = ''; return; }
    // light levels + counts (robust to debug overrides that kindle beacons behind our back)
    let lit = 0, outer = 0;
    for (let i = 0; i < sb.length; i++) {
      if (!sb[i].kindled) continue;
      lit++; if (!wb[i].isHeart) outer++;
      if (sb[i].lit < 1) sb[i].lit = Math.min(1, sb[i].lit + dt / 2.5);
    }
    S.litCount = lit; G.outerLit = outer; G.heartOpen = outer >= G.outerTotal;
    if (G.heartOpen && !G.heartOpenSent && G.heartIdx >= 0 && !sb[G.heartIdx].kindled) {
      G.heartOpenSent = true;
      TW.emit('heartOpen');
      let isle = 'Limyè-Kè-la';
      if (W.islands) { const hb = wb[G.heartIdx]; let bd = 1e12; for (let i = 0; i < W.islands.length; i++) { const is = W.islands[i], d = hyp(is.x - hb.x, is.z - hb.z); if (d < bd) { bd = d; isle = is.name; } } }
      hint((NUM[G.outerTotal] || G.outerTotal) + ' limyè ka limé. Van-fò-la ka sanblé anlè ' + isle + '.', true);
    }
    G.heartCd -= dt; G.boundsCd -= dt;

    assist.on = false;
    let ki = -1;
    if (ph === 'sailing' && resp.mode === 0 && G.heartHold >= 0) ki = G.heartIdx;    // the held breath: nothing else happens
    else if (ph === 'sailing' && resp.mode === 0) {
      // which unlit landing ring (if any) holds the skiff?
      let kd = 1e12;
      for (let i = 0; i < wb.length; i++) {
        if (sb[i].kindled) continue;
        const d = hyp(wb[i].dock.x - b.x, wb[i].dock.z - b.z);
        if (d < wb[i].dock.r && d < kd) { kd = d; ki = i; }
      }
      if (ki >= 0) {
        if (wb[ki].isHeart && !G.heartOpen) {
          if (G.heartCd <= 0) { G.heartCd = 16; hint('Limyè-Kè-la pé ké pran flanm-la avan tout limyè alantou-y limé.', true); }
        } else {
          const p = sb[ki];
          assist.on = true; assist.x = wb[ki].dock.x; assist.z = wb[ki].dock.z;
          assist.cap = inp.kindle || p.progress > 0.02 ? 0.9 : 1.9;
          if (inp.kindle || b.speed < T.KINDLE_SPEED) {
            if (G.kindleIdx !== ki) { G.kindleIdx = ki; CK.kinIdx = ki; TW.emit('beaconKindling', { index: ki }); }
            p.progress += dt / T.KINDLE_TIME;
            if (wb[ki].isHeart) {
              G.hushT = smooth(1 - 1.8 / T.KINDLE_TIME, 1, p.progress);
              if (p.progress >= 1) { p.progress = 1; G.heartHold = 0; moor.on = true; moor.x = b.x; moor.z = b.z; }   // do not light it yet
            } else if (p.progress >= 1) lightBeacon(ki);
          } else p.progress = Math.max(0, p.progress - 0.12 * dt);
        }
      }
      // pickups
      const fl = W.floats;
      if (fl) {
        for (let i = 0; i < fl.length; i++) {
          const f = fl[i];
          if (f.taken) continue;
          const dx = f.x - b.x, dz = f.z - b.z;
          if (dx * dx + dz * dz < T.FLOAT_R * T.FLOAT_R) {
            f.taken = true;
            L.oil = Math.min(1, L.oil + T.FLOAT_OIL); G.flare = Math.max(G.flare, 0.7); stats.floats++;
            TW.emit('pickup', { index: i, x: f.x, z: f.z, oil: L.oil });
            if (!G.tipFloat) { G.tipFloat = true; hint('Vè-tanpèt. Lanp-la ka bwè limyè a-y.'); }
          }
        }
      }
    }
    // freshly lit: stay moored in the ring (no surprise run at the shore) until the player takes the helm again
    if (G.moorIdx >= 0) {
      const d = wb[G.moorIdx].dock;
      if (ph !== 'sailing' || resp.mode !== 0 || Math.abs(inp.steer) > 0.15 || inp.trim !== 0 || hyp(d.x - b.x, d.z - b.z) > d.r + 6) G.moorIdx = -1;
      else { assist.on = true; assist.x = d.x; assist.z = d.z; assist.cap = 0.5; }
    }
    if (G.kindleIdx >= 0 && ki !== G.kindleIdx) G.kindleIdx = -1;
    G.ringIdx = ki;
    for (let i = 0; i < sb.length; i++) if (!sb[i].kindled && i !== ki && sb[i].progress > 0) sb[i].progress = Math.max(0, sb[i].progress - 0.25 * dt);

    // the hull mends while moored at a lit beacon
    if ((ph === 'sailing' || ph === 'free') && b.hull < 1 && b.speed < 3) {
      for (let i = 0; i < wb.length; i++) {
        if (!sb[i].kindled) continue;
        const d = wb[i].dock;
        if (hyp(d.x - b.x, d.z - b.z) < d.r) { b.hull = Math.min(1, b.hull + 0.03 * dt); break; }
      }
    }
  }

  function beginRespawn(kind) {
    if (resp.mode !== 0) return;
    resp.mode = 1; resp.t = 0; resp.kind = kind;
    TW.emit(kind === 'wreck' ? 'wreck' : 'lanternOut');
  }

  function updateRespawn(dt) {
    let f = 0;
    if (resp.mode === 1) {
      resp.t += dt;
      f = sat(resp.t / 1.2);
      if (resp.kind === 'wreck') { bs.sink = damp(bs.sink, 0.9, 1.5, dt); bs.list = damp(bs.list, 0.45, 1.5, dt); }
      if (resp.t >= 1.55) {
        placeBoat(respawnPt.x, respawnPt.z, respawnPt.heading, 0);
        B.hull = Math.max(B.hull, 0.6); L.oil = 1; L.intensity = 0.2;
        B.sail = 0.3; G.autoSail = 0.7; G.flare = 0.6; G.lowArmed = true; G.kindleIdx = -1;
        stats.respawns++;
        endExposure();
        resp.mode = 2; resp.t = 0; f = 1;
        TW.emit('respawn');
        hint(respawnPt.index >= 0 ? 'Flanm-la ka lévé ankò bò ' + W.beacons[respawnPt.index].name + '.' : 'Flanm-la ka lévé ankò la koté vwayaj-la té koumansé.', true);
      }
    } else if (resp.mode === 2) {
      resp.t += dt;
      f = 1 - smooth(0.15, 1.6, resp.t);
      if (resp.t >= 1.6) { resp.mode = 0; f = 0; }
    }
    G.introFade = Math.max(0, G.introFade - dt * G.introRate);
    hud.fade = Math.max(f, s01(sat(G.introFade)));
    if (TW.post && TW.post.params) TW.post.params.fade = hud.fade;
  }

  // Exposure score. A brief lift when an outer light catches; for the Heartlight: down ~1.25 stops through the hush,
  // overshoot to 1.55x within 0.12 s of ignition, settle to 1.0x by T0+1.9. Restores TW.post.params.exposure exactly.
  const EX = { t: -1, amp: 0, base: 0, active: false, h0: 1 };
  function endExposure() {
    if (EX.active && TW.post && TW.post.params) TW.post.params.exposure = EX.base;
    EX.active = false; EX.t = -1;
  }
  function updateExposure(dt) {
    const P = TW.post && TW.post.params;
    if (!P || typeof P.exposure !== 'number') { EX.t = -1; return; }
    let m = 1, on = false;
    if (EX.t >= 0) {
      EX.t += dt;
      if (EX.t >= 2.3) EX.t = -1;
      else { m *= 1 + EX.amp * (EX.t < 0.3 ? s01(EX.t / 0.3) : 1 - smooth(0.3, 2.3, EX.t)); on = true; }
    }
    const ht = S.heart.t, hu = S.heart.hush;
    if (ht >= 0 && ht < 1.95) { m *= ht < 0.10 ? lerp(EX.h0, 1.28, s01(ht / 0.10)) : lerp(1.28, 1, smooth(0.10, 1.25, ht)); on = true; }
    else if (ht < 0 && hu > 0.0005) { EX.h0 = lerp(1, 0.42, s01(hu)); m *= EX.h0; on = true; }
    else if (ht < 0) EX.h0 = 1;
    if (on) { if (!EX.active) { EX.active = true; EX.base = P.exposure; } P.exposure = EX.base * m; }
    else if (EX.active) endExposure();
  }

  function updateLantern(dt) {
    const ph = S.phase, t = S.time;
    if (ph === 'sailing' && resp.mode === 0) {
      L.oil -= (dt / T.OIL_TIME) * (1 + T.OIL_RAIN * S.rain);
      if (G.lowArmed && L.oil < 0.2) { G.lowArmed = false; TW.emit('lanternLow'); hint('Lanp-la ka febli. Chaché vè-tanpèt oben on baliz pou limé flanm-la.', true); }
      else if (!G.lowArmed && L.oil > 0.3) G.lowArmed = true;
      if (!G.tipOil && L.oil < 0.6) { G.tipOil = true; hint('Luil lanp-la ka fini, pli vit lè lapli ka tonbé. Vè-tanpèt ki ka kléré ka wouplen lanp-la.'); }
      if (L.oil <= 0) { L.oil = 0; beginRespawn('lanternOut'); }
    }
    G.flare = Math.max(0, G.flare - dt * 0.7);
    let target = L.oil <= 0 ? 0 : (0.22 + 0.78 * smooth(0, 0.15, L.oil)) * (1 + 0.3 * G.flare);   // bright until ~15 %, then it gutters
    if (resp.mode === 1) target *= resp.kind === 'lanternOut' ? 0 : 0.4;
    L.intensity = damp(L.intensity, target, L.oil <= 0 ? 2.5 : 4, dt);
    const gut = 1 - smooth(0.03, 0.2, L.oil);
    const n1 = TW.noise2(t * 7.3, 1.7, 11) - 0.5, n2 = TW.noise2(t * 19.1, 4.2, 12) - 0.5, n3 = TW.noise2(t * 2.1, 9.9, 13) - 0.5;
    const amp = 0.2 + 0.45 * WN.gust + 0.7 * gut;
    const dip = gut * 0.35 * smooth(0.62, 0.9, TW.noise2(t * 3.7, 6.6, 14));        // guttering dips when nearly dry
    L.flicker = clamp(1 + (n1 * 0.9 + n2 * 0.5 + n3 * 0.6) * amp - dip, 0.3, 1.5);
  }

  function updateHints(dt) {
    const ph = S.phase, b = B;
    if (raceMode) { hud.objective = ''; return; }
    if (ph === 'sailing' && resp.mode === 0) {
      G.tutT += dt;
      if (G.tutStep === 0 && G.tutT > 1.4) {
        G.tutStep = 1;
        hint(TW.isTouch ? 'Gwo pous a goch: viré bar-la pou dirijé, pousé anlè pou ouvè plis vwal.' : 'A / D pou dirijé  ·  W / S pou ouvè oben bésé vwal-la');
      } else if (G.tutStep === 1 && G.tutT > 7.5) {
        G.tutStep = 2;
        const ti = nearestUnlit(false);
        if (ti >= 0) hint('Swiv sèk boué-yo jis koté ' + W.beacons[ti].name + ' pou limé flanm-la.');
      }
      // in irons for the first time
      const irons = b.sail > 0.15 && bs.theta < 38;
      G.ironsT = irons ? G.ironsT + dt : 0;
      if (!G.tipIrons && G.ironsT > 2.2 && G.tutStep >= 1) { G.tipIrons = true; hint('On vwal pa ka plen dwèt anfas van-la. Viré bato-la lwen van-la pou vwal-la plen; bato-la ké ralanti natirèlman lè i rété anfas van-la.'); }
      if (!G.tipMaw && bs.maw > 0.25) { G.tipMaw = true; hint('Gwo Gòj-la! Kenbé vwal-la anlè é dirijé travès kouran-la.', true); }
    }
    G.hintCd -= dt;
    if (hintQ.length && G.hintCd <= 0 && ph !== 'title') { G.hintCd = 5.2; TW.emit('hint', { text: hintQ.shift() }); }
  }

  // ===========================================================================
  // CAMERA
  // ===========================================================================
  // The payoff shot. Lens `dist` behind the skiff along yawCam (the direction lens -> skiff) and `hgt` above her.
  // FOV and tilt are solved so the lamp sits at NDC y = +kHi and the hull at -kLo; if even the widest lens cannot hold
  // both, the lens backs off. The view axis is the lamp's bearing nudged toward the skiff, or blended (w) to `axis`.
  const HP = { px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 0, fov: 55 };
  // Which quarter does the lens take, and how far round? The smallest swing that keeps the moon at least ~16 deg from
  // the lamp as seen from the lens (two lights stacked behind one another fight; side by side they compose).
  function chooseHero(lamp) {
    const b = B, md = TW.env.look.moonDir;
    let mx = md[0], my = md[1], mz = md[2];
    if (hyp(mx, mz) < 0.05) { mx = 0.319; my = 0.319; mz = -0.892; }
    const aL = Math.atan2(lamp[0] - b.x, lamp[2] - b.z), pref = wrap(Math.atan2(mx, mz) - aL) >= 0 ? -1 : 1;
    let bestS = pref, bestM = 0.3, bestA = -1, done = false;
    for (let k = 0; k < 11 && !done; k++) {
      const mag = 0.3 + k * 0.1, R = 15 + 12 * sat((mag - 0.3) / 0.9);
      for (let j = 0; j < 2 && !done; j++) {
        const sd = j === 0 ? pref : -pref, ya = aL + sd * (mag + 0.06);          // worst case of the drift
        const vx = lamp[0] - (b.x - Math.sin(ya) * R), vy = lamp[1] - (b.y + 1.9), vz = lamp[2] - (b.z - Math.cos(ya) * R);
        const ang = Math.acos(clamp((vx * mx + vy * my + vz * mz) / (hyp(vx, vy, vz) || 1), -1, 1));
        if (ang > bestA) { bestA = ang; bestS = sd; bestM = mag; }
        if (ang >= 0.28) { bestS = sd; bestM = mag; done = true; }
      }
    }
    CK.heroSide = bestS; CK.heroMag = bestM; CK.heroR = 15 + 12 * sat((bestM - 0.3) / 0.9);
  }
  function heroShot(lamp, dist, hgt, yawCam, kHi, kLo, fovMin, fovMax, axis, w) {
    const b = B, by = CK.byF, sy = Math.sin(yawCam), cy = Math.cos(yawCam);   // ride her heave, so she sits still in frame
    // a tall tower close by may push the pair out toward the frame edges (up to 1.25x) before the lens backs off
    const tfMax = Math.tan(fovMax * 0.5 * DEG), spanMax = Math.atan(1.25 * kHi * tfMax) + Math.atan(1.25 * kLo * tfMax);
    let px = 0, py = 0, pz = 0, eLo = 0, eHi = 0;
    for (let k = 0; k < 24; k++) {
      px = b.x - sy * dist; pz = b.z - cy * dist; py = by + hgt;
      eLo = Math.atan2(by + 0.4 - py, dist); eHi = Math.atan2(lamp[1] - py, hyp(lamp[0] - px, lamp[2] - pz) || 1);
      if (eHi - eLo <= spanMax) break;
      dist *= 1.12; hgt += 0.012 * dist;
    }
    // the lens never goes nearer the water than this, so solve the framing from where it will really be
    const fl = TW.env.seaHeight(px, pz, sea) + T.CAM_MIN_CLEAR + 0.15;
    if (py < fl) { py = fl; eLo = Math.atan2(by + 0.4 - py, dist); eHi = Math.atan2(lamp[1] - py, hyp(lamp[0] - px, lamp[2] - pz) || 1); }
    const span = Math.max(0.05, eHi - eLo);
    let lo = 0.15, hi = tfMax;
    for (let k = 0; k < 14; k++) { const m = (lo + hi) * 0.5; if (Math.atan(kHi * m) + Math.atan(kLo * m) > span) hi = m; else lo = m; }
    const fov = clamp((2 * Math.atan((lo + hi) * 0.5)) / DEG, fovMin, fovMax), tf = Math.tan(fov * 0.5 * DEG);
    const aCL = Math.atan2(lamp[0] - px, lamp[2] - pz);
    let vy = aCL + wrap(yawCam - aCL) * 0.45;
    if (w > 0) vy += wrap(axis - vy) * w;
    // tilt: share any misfit between the two (m scales both placements), so neither leaves the frame
    let mlo = 0.3, mhi = 1.5;
    for (let k = 0; k < 12; k++) { const m = (mlo + mhi) * 0.5; if (Math.atan(m * kHi * tf) + Math.atan(m * kLo * tf) > span) mhi = m; else mlo = m; }
    let p = eHi - Math.atan((mlo + mhi) * 0.5 * kHi * tf);
    const vis = 1 - smooth(0.75, 1.15, Math.abs(wrap(aCL - vy)) / Math.max(0.2, Math.atan(tf * TW.env.sceneW / Math.max(1, TW.env.sceneH))));
    p = lerp(eLo + Math.atan(0.5 * tf), p, vis);                      // lamp out of shot sideways: just keep the skiff low
    const cp = Math.cos(p) * 40;
    HP.px = px; HP.py = py; HP.pz = pz; HP.fov = fov;
    HP.tx = px + Math.sin(vy) * cp; HP.ty = py + Math.sin(p) * 40; HP.tz = pz + Math.cos(vy) * cp;
  }

  // View axis of the title shot. 'isles': the first landfall in the midground with the Heartlight's isle beyond;
  // 'moon': straight down the moon-path. (From the real spawn these are ~150 deg apart, so it is one or the other.)
  function titleYaw() {
    const aM = Math.atan2(0.30, -0.84);
    const mode = TW.qs('gtitle', T.TITLE_VIEW);
    CK.titleHeart = 1e9;
    if (mode === 'moon' || !W.beacons.length) return aM;
    let ni = 0, nd = 1e12;
    for (let i = 0; i < W.beacons.length; i++) { const d = hyp(W.beacons[i].x - B.x, W.beacons[i].z - B.z); if (d < nd && !W.beacons[i].isHeart) { nd = d; ni = i; } }
    // aim at the near isle's centre (not its tower) when the world lists it
    let nx = W.beacons[ni].x, nz = W.beacons[ni].z;
    if (W.islands) { let bd = 1e12; for (let i = 0; i < W.islands.length; i++) { const is = W.islands[i], d = hyp(is.x - W.beacons[ni].x, is.z - W.beacons[ni].z); if (d < bd) { bd = d; nx = is.x; nz = is.z; } } }
    const aN = Math.atan2(nx - B.x, nz - B.z);
    if (G.heartIdx < 0) return aN;
    const hb = W.beacons[G.heartIdx];
    CK.titleHeart = Math.atan2(hb.x - B.x, hb.z - B.z);            // per-frame: the Heartlight is placed just left of the skiff
    return aN;
  }

  function updateCamera(dt) {
    const b = B, c = S.cam, ph = S.phase, time = S.time, E = TW.env;
    const snap = CK.snap;
    // --- springs that follow the skiff ---
    CK.byF = snap ? b.y : damp(CK.byF, b.y, 6, dt);
    if (snap) { CK.yaw = b.heading; CK.yawVel = 0; CK.by = b.y; }
    else {
      const om = 3.4, diff = wrap(b.heading - CK.yaw);                 // critically damped yaw follow
      CK.yawVel += (om * om * diff - 2 * om * CK.yawVel) * dt;
      CK.yaw = wrap(CK.yaw + CK.yawVel * dt);
      CK.by = damp(CK.by, b.y, 2.2, dt);
    }
    // --- mode weights ---
    CK.wTitle = approach(CK.wTitle, ph === 'title' ? 1 : 0, dt / 3.6);
    CK.wEnd = approach(CK.wEnd, ph === 'ending' ? 1 : 0, dt / (ph === 'ending' ? 7 : 3.5));
    CK.kinHold -= dt;
    if (CK.kinHold > 0.3 && G.moorIdx < 0 && G.kindleIdx < 0 && ph === 'sailing' && b.speed > 3) CK.kinHold = 0.3;   // helm taken: give the view back
    const kinOn = (G.kindleIdx >= 0 && S.beacons[G.kindleIdx].progress > 0.01) || CK.kinHold > 0;
    // (the Heartlight shot settles sooner, so the tower is framed before the hush begins)
    CK.wKin = damp(CK.wKin, kinOn ? 1 : 0, kinOn ? (G.kindleIdx >= 0 && G.kindleIdx === G.heartIdx ? 2.6 : 1.5) : 0.8, dt);
    const wt = s01(CK.wTitle), we = s01(CK.wEnd), wk = CK.wKin;
    // --- player orbit eases home a few seconds after release ---
    if (!CK.drag) {
      CK.relT -= dt;
      if (CK.relT <= 0) { CK.oYaw = damp(CK.oYaw, 0, 1.6, dt); CK.oPitch = damp(CK.oPitch, 0, 1.6, dt); }
    }

    // --- chase ---
    const sp = sat(b.speed / 10);
    const fovC = lerp(55, 64, Math.pow(sp, 1.3));
    const lamp = wk > 0.002 && CK.kinIdx >= 0 && W.beacons[CK.kinIdx] ? W.beacons[CK.kinIdx].lamp : null;
    const yaw = CK.yaw + CK.oYaw;
    // drifting or moored: ease back and up a little so the whole rig (mast and yard, ~6.8 m) sits under the HUD strip
    CK.slow = snap ? 1 - smooth(2.4, 5.2, b.speed) : damp(CK.slow, 1 - smooth(2.4, 5.2, b.speed), 1.4, dt);
    let dist = (lerp(9.8, 11.8, sp) + 3.6 * CK.slow) * CK.zoom * CK.pull, hgt = (lerp(3.2, 3.9, sp) + 0.8 * CK.slow) * CK.zoom;
    const R = hyp(dist, hgt), el = clamp(Math.atan2(hgt, dist) + CK.oPitch, 0.07, 1.15);
    dist = R * Math.cos(el); hgt = R * Math.sin(el);
    let px = b.x - Math.sin(yaw) * dist, pz = b.z - Math.cos(yaw) * dist, py = CK.by + hgt;
    const fx = Math.sin(b.heading), fz = Math.cos(b.heading), la = 3.2 + b.speed * 0.28;
    let tx = b.x + fx * la, ty = CK.by + 2.45 + 0.15 * CK.slow, tz = b.z + fz * la;
    if (hud.target && wk < 0.5) {                                        // lean the frame toward the next light
      const k = 1.3 * (1 - wk * 2) * sat(hud.target.dist / 60);
      tx += Math.sin(hud.target.bearing) * k; tz += Math.cos(hud.target.bearing) * k;
    }
    let fov = fovC;
    // --- kindling / ignition: low behind the skiff, looking up; lamp in the upper third, hull in the lower third ---
    {
      const hl = lamp || (we > 0 && W.beacons[CK.endIdx] ? W.beacons[CK.endIdx].lamp : null);
      if (hl && wk < 0.05 && we <= 0) CK.heroSide = 0;                   // re-decide for each new shot
      if (hl && CK.heroSide === 0) chooseHero(hl);
      CK.heroOff = (CK.heroSide || 1) * (CK.heroMag + 0.06 * Math.sin(time * 0.21));   // plus a slow drift round her quarter
    }
    if (lamp) {
      const aL = Math.atan2(lamp[0] - b.x, lamp[2] - b.z);
      const isH = CK.kinIdx === G.heartIdx;
      // the Heartlight: one slow continuous push (12 %) and tilt up through the kindle, strongest in the hush
      const hk = isH ? (S.heart.t >= 0 ? 1 : s01(sat(0.3 * S.beacons[CK.kinIdx].progress + 0.7 * S.heart.hush))) : 0;
      const push = isH ? 1 - 0.12 * hk : 1 - 0.1 * sat(1 - CK.kinHold / 4.6);     // others: creep in while the lamp catches
      // a wide swing (moon behind the tower) needs a lens wide enough to hold skiff and tower side by side
      const fmin = Math.max(44, (2 * Math.atan(Math.tan(Math.abs(CK.heroOff) * 0.5) / 0.5 / Math.max(0.6, E.sceneW / Math.max(1, E.sceneH)))) / DEG);
      heroShot(lamp, CK.heroR * push, 1.9 - 0.3 * hk, aL + CK.heroOff, 0.6 - 0.1 * hk, 0.58 + 0.06 * hk, Math.min(fmin, 70), 78, 0, 0);
      const k = s01(sat(wk));
      px = lerp(px, HP.px, k); py = lerp(py, HP.py, k); pz = lerp(pz, HP.pz, k);
      tx = lerp(tx, HP.tx, k); ty = lerp(ty, HP.ty, k); tz = lerp(tz, HP.tz, k);
      fov = lerp(fov, HP.fov, k);
    }

    // --- title: a slow low arc around the anchored skiff, moon and isles beyond ---
    if (wt > 0) {
      // The view axis sways only a little so the composition holds. Landscape: skiff in the right third (the title
      // wordmark owns the lower left), horizon near the middle. Portrait: skiff centred in the upper half.
      const aspect = E.sceneW / Math.max(1, E.sceneH), wide = aspect > 1.25;
      const tf = Math.tan(24 * DEG);                                  // title fov = 48
      const offX = wide ? Math.atan(0.40 * tf * aspect) : 0;          // skiff sits this far right of the view axis
      let axis = CK.titleYaw;
      if (CK.titleHeart < 1e8) {
        // near isle left / centre, the Heartlight's isle just left of the skiff (landscape) or behind her (portrait)
        const lim = Math.atan(0.72 * tf * aspect);
        axis = CK.titleHeart + (wide ? Math.atan(0.12 * tf * aspect) : 0);
        axis += clamp(wrap(CK.titleYaw - axis), -lim, lim) - wrap(CK.titleYaw - axis);   // ... but never push the near isle out of frame
        if (!wide) axis = CK.titleYaw;
      }
      const ta = axis + 0.10 * Math.sin(time * 0.06) + 0.025 * Math.sin(time * 0.17);
      const tb = ta - offX, dist = wide ? 12.5 : 23;
      const bx = Math.sin(tb), bz = Math.cos(tb);
      const qx = b.x - bx * dist, qz = b.z - bz * dist;
      // float just above the highest water between the lens and the skiff, so a crest never hides her
      let top = E.seaHeight(qx, qz, sea);
      const mid = E.seaHeight(b.x - bx * dist * 0.5, b.z - bz * dist * 0.5, sea);
      // ride the skiff's own heave (so she and the horizon both sit still in frame), lifting only for a crest in the way
      top = Math.max(b.y, mid - 1.3, top - 1.6);
      CK.titleSea = snap ? top : damp(CK.titleSea, top, 7, dt);
      const qy = CK.titleSea + (wide ? 4.0 : 3.0);
      const eB = Math.atan2(1.2 - (wide ? 4.0 : 3.0), dist);          // elevation of the skiff from the lens
      const pt = clamp(eB + Math.atan((wide ? 0.50 : -0.17) * tf), -0.5, 0.25);
      const cp = Math.cos(pt) * 30;
      px = lerp(px, qx, wt); py = lerp(py, qy, wt); pz = lerp(pz, qz, wt);
      tx = lerp(tx, qx + Math.sin(ta) * cp, wt); ty = lerp(ty, qy + Math.sin(pt) * 30, wt); tz = lerp(tz, qz + Math.cos(ta) * cp, wt);
      fov = lerp(fov, 48, wt);
    }
    // --- ending: open low behind the moored skiff looking up at the Heartlight, then a slow rising orbit and
    //     pull-back to a wide of tower + sunrise + glitter path with the skiff still readable in the foreground ---
    if (we > 0) {
      const lp = W.beacons[CK.endIdx] ? W.beacons[CK.endIdx].lamp : null;
      // 0-1.5 s: the pushed-in kindle shot holds as the lamp catches.  1.5-16 s: the crane, one continuous rise and
      // pull-back while orbiting toward the sunrise side, out to a wide of tower, whole island and open sea.
      // 16-34 s: float down and in to the composed final wide (tower + sunrise + glitter path, skiff in the foreground).
      const t = WX.endT, u1 = Math.pow(smooth(1.5, 16, t), 0.75), u2 = smooth(16, 34, t), s = smooth(1.5, 24, t);   // (the crane gets under way at once)
      const yawA = CK.endAL + CK.heroOff;
      const yawCam = yawA + wrap(CK.endYawC - yawA) * s + 0.03 * Math.sin(t * 0.07) * s;
      const D = lerp(lerp(CK.heroR * 0.88, 125, u1), CK.endD, u2), H = lerp(lerp(1.6, 40, u1), 4 + 0.11 * CK.endD, u2);
      const kk = sat(u1 * 3);
      if (lp) heroShot(lp, D, H, yawCam, lerp(0.5, 0.7, kk), lerp(0.64, 0.7, kk), 48, 78, CK.endAxis, s);
      else { HP.px = b.x - Math.sin(yawCam) * D; HP.pz = b.z - Math.cos(yawCam) * D; HP.py = CK.by + H; HP.tx = b.x; HP.ty = CK.by + 2 + 6 * s; HP.tz = b.z; HP.fov = 55; }
      px = lerp(px, HP.px, we); py = lerp(py, HP.py, we); pz = lerp(pz, HP.pz, we);
      tx = lerp(tx, HP.tx, we); ty = lerp(ty, HP.ty, we); tz = lerp(tz, HP.tz, we);
      fov = lerp(fov, HP.fov, we);
    }

    // --- never under water, never inside an island ---
    const seaY = E.seaHeight(px, pz, sea);
    let floor = seaY + T.CAM_MIN_CLEAR;
    const th = W.heightAt(px, pz);
    if (th + 2.2 > floor) floor = th + 2.2;
    CK.pull = snap ? 1 : damp(CK.pull, th > py - 1.0 && wt < 0.5 && we < 0.5 ? 0.5 : 1, 2.5, dt);   // tuck in when the land is in the way
    const soft = lerp(0.7, 0.12, Math.max(we, lamp ? s01(sat(wk)) : 0));   // (the low staged shots may skim closer to the water)
    CK.floor = snap ? floor + soft : damp(CK.floor, floor + soft, 5, dt);  // soft floor rides above the hard one

    // --- shake (thunder, slams, knocks) ---
    CK.trauma = Math.max(0, CK.trauma - dt * 1.5); CK.kick = Math.max(0, CK.kick - dt * 2.2);
    const sh = CK.trauma * CK.trauma;
    let roll = clamp(-CK.yawVel * 0.03, -0.035, 0.035) * (1 - wt) * (1 - we);
    if (sh > 0.0004) {
      tx += (TW.noise2(time * 19, 0.5, 31) - 0.5) * sh * 2.6; ty += (TW.noise2(time * 23, 3.5, 32) - 0.5) * sh * 2.0; tz += (TW.noise2(time * 21, 7.5, 33) - 0.5) * sh * 2.6;
      py += (TW.noise2(time * 17, 5.5, 34) - 0.5) * sh * 0.5;
      roll += (TW.noise2(time * 15, 9.5, 35) - 0.5) * sh * 0.09;
    }
    py -= CK.kick * 0.22;
    if (py < CK.floor) py = CK.floor;
    if (py < floor) py = floor;

    // (the staged shots solve lens and tilt together, so there the lens must not lag its tilt)
    CK.fov = snap ? fov : damp(CK.fov, fov, lerp(2.5, 30, Math.max(we, lamp ? sat(wk * 3) : 0)), dt);
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    c.pos[0] = px; c.pos[1] = py; c.pos[2] = pz;
    c.target[0] = tx; c.target[1] = ty; c.target[2] = tz;
    c.up[0] = -cy * roll; c.up[1] = 1; c.up[2] = sy * roll;      // a hint of bank into the turn, horizon otherwise level
    c.fov = CK.fov + CK.kick * 1.5;
    CK.snap = false;
    const clear = py - seaY;
    if (clear < debug.minCamClear) debug.minCamClear = clear;
  }

  // ===========================================================================
  // HUD
  // ===========================================================================
  const NUM = ['Zewo', 'Yonn', 'Dé', 'Twa', 'Kat', 'Senk', 'Sis', 'Sèt', 'Uit'];
  function updateHud(dt) {
    const b = B, ph = S.phase, wb = W.beacons, sb = S.beacons;
    if (raceMode) { hud.objective = ''; hud.target = null; hud.ring = null; G.objKey = 'race'; }
    hud.oil = L.oil; hud.hull = b.hull; hud.speed = b.speed; hud.sail = b.sail; hud.heading = b.heading;
    hud.windAngle = Math.atan2(WN.dirX, WN.dirZ); hud.windSpeed = WN.speed * (1 + WN.gust);
    const th = bs.theta;
    hud.pointOfSail = th < 38 ? 'irons' : th < 65 ? 'close' : th < 110 ? 'beam' : th < 155 ? 'broad' : 'run';
    hud.inIrons = th < 38 && b.sail > 0.15 && !assist.on;
    hud.lit = S.litCount; hud.total = sb.length; hud.heartOpen = G.heartOpen;

    const ti = raceMode ? -1 : ph === 'ending' || ph === 'free' ? -1 : nearestUnlit(false);
    let key = raceMode ? 'race' : ph, dist = 0;
    if (ti >= 0) {
      const d = wb[ti].dock, dx = d.x - b.x, dz = d.z - b.z;
      dist = hyp(dx, dz);
      hudTarget.index = ti; hudTarget.name = wb[ti].name; hudTarget.dist = dist; hudTarget.bearing = Math.atan2(dx, dz); hudTarget.isHeart = !!wb[ti].isHeart;
      hud.target = hudTarget;
    } else hud.target = null;
    const lockedRing = G.ringIdx >= 0 && wb[G.ringIdx].isHeart && !G.heartOpen;
    const ri = G.ringIdx >= 0 && !lockedRing ? G.ringIdx : ti >= 0 && dist < 120 ? ti : -1;
    if (ri >= 0 && (ph === 'sailing' || ph === 'paused')) {
      hudRing.index = ri; hudRing.inRing = G.ringIdx === ri; hudRing.progress = sat(sb[ri].progress);
      hud.ring = hudRing;
    } else hud.ring = null;

    // objective line (rebuilt only when it would read differently)
    const kindling = ti >= 0 && G.kindleIdx === ti;
    const dq = dist < 100 ? Math.round(dist / 5) * 5 : Math.round(dist / 10) * 10;
    key += '|' + ti + '|' + (kindling ? 'k' : '') + '|' + (G.heartOpen ? 1 : 0);
    if (key !== G.objKey) {
      G.objKey = key;
      let o = '';
      if (raceMode) o = '';
      else if (ph === 'title') o = 'Tout limyè adan Achipèl Gwadloup-la étenn.';
      else if (ph === 'ending') o = 'Gwo Van-la kasé.';
      else if (ph === 'free') o = 'Zil-yo limé. Kontinyé navigé.';
      else if (ti >= 0) {
        const heart = wb[ti].isHeart;
        if (kindling) o = heart ? 'Kenbé fò. Limyè-Kè-la ka lévé.' : 'Kenbé fò. Flanm-la ka monté anlè ' + wb[ti].name + '.';
        else if (heart) o = (NUM[G.outerTotal] || G.outerTotal) + ' limyè ka limé. Pòté flanm-la ba Limyè-Kè-la.';
        else o = 'Limé baliz-la bò ' + wb[ti].name + '.';
      } else o = hud.objective;
      hud.objective = o;
    }
    let dg = Math.max(sat(1 - L.oil / 0.25), sat(1 - b.hull / 0.4), sat(bs.maw * 1.4));
    if (ph !== 'sailing') dg = 0;
    G.dangerS = damp(G.dangerS, dg, 3, dt);
    hud.danger = G.dangerS;
  }

  // ===========================================================================
  // LIFECYCLE
  // ===========================================================================
  function resetRun() {
    const sp = W.spawn || { x: 0, z: 0, heading: 0 };
    S.beacons = W.beacons.map(() => ({ lit: 0, kindled: false, progress: 0 }));
    if (W.floats) for (let i = 0; i < W.floats.length; i++) W.floats[i].taken = false;
    G.outerTotal = 0; G.heartIdx = -1;
    W.beacons.forEach((wb, i) => { if (wb.isHeart) G.heartIdx = i; else G.outerTotal++; });
    stats.time = 0; stats.floats = 0; stats.knocks = 0; stats.respawns = 0; stats.distance = 0;
    stats.floatsTotal = W.floats ? W.floats.length : 0;
    debug.autoLog.length = 0;
    rnd = TW.rng((TW.seed + 7707) | 0);
    L.oil = 1; L.intensity = 1; L.flicker = 1;
    B.hull = 1; B.sail = 0.1; B.boom = 0.1; B.luff = 0; B.aground = 0;
    S.dawn = 0; S.daylight = SETTINGS.weather.daylight; S.storm = SETTINGS.weather.initialStorm; S.rain = SETTINGS.weather.initialRain; S.flash = 0; S.vortexStrength = 1; S.litCount = 0; S.tide = 0;
    WX.stormBase = SETTINGS.weather.resetBase; WX.squallT = -1; WX.nextSquall = SETTINGS.weather.squallInitialDelay[0] + rnd() * SETTINGS.weather.squallInitialDelay[1]; WX.gustT = -1; WX.nextGust = 10 + rnd() * 10;
    WX.boltT = 3.5 + rnd() * 4; WX.flashT = -1; WX.ended = false; WX.endT = 0; WX.fury = 0;
    WN.gust = 0;
    G.outerLit = 0; G.heartOpen = false; G.heartOpenSent = false; G.kindleIdx = -1; G.ringIdx = -1; G.moorIdx = -1; G.heartHold = -1; G.hushT = 0;
    S.heart.hush = 0; S.heart.t = -1; setHeartPos();
    G.tutT = 0; G.tutStep = 0; G.ironsT = 0; G.lowArmed = true; G.boundsCd = 0; G.heartCd = 0; G.autoSail = -1; G.flare = 0;
    G.tipIrons = G.tipOil = G.tipHull = G.tipMaw = G.tipFloat = false;
    G.objKey = ''; G.hintCd = 0; G.dangerS = 0; hintQ.length = 0;
    resp.mode = 0; resp.t = 0; assist.on = false;
    endExposure();
    respawnPt.x = sp.x; respawnPt.z = sp.z; respawnPt.heading = sp.heading; respawnPt.index = -1;
    moor.on = true; moor.x = sp.x; moor.z = sp.z;
    bs.boomSide = 1; bs.immune = 0; bs.bumpCd = 0; bs.slamCd = 1; bs.maw = 0; bs.inner = 0; bs.theta = 180;
    placeBoat(sp.x, sp.z, sp.heading, 0);
    CK.zoom = 1; CK.trauma = 0; CK.kick = 0; CK.wEnd = 0; CK.wKin = 0; CK.kinHold = 0; CK.kinIdx = -1; CK.pull = 1; CK.drag = false; CK.pid = -1;
    CK.titleYaw = titleYaw();
  }

  function init() {
    S = TW.state; B = S.boat; L = S.lantern; WN = S.wind; W = TW.world;
    resetRun();
    S.phase = 'title';
    CK.wTitle = 1; G.introFade = 1; G.introRate = 0.7;
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', () => { clearKeys(); CK.drag = false; CK.pid = -1; if (!AP.on && !keepRunningWhenHidden()) pause(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && !AP.on && !keepRunningWhenHidden()) { clearKeys(); pause(); } });
    const cv = TW.canvas;
    if (cv && cv.addEventListener) {
      cv.addEventListener('pointerdown', onPointerDown);
      cv.addEventListener('pointermove', onPointerMove);
      cv.addEventListener('pointerup', onPointerUp);
      cv.addEventListener('pointercancel', onPointerUp);
      cv.addEventListener('lostpointercapture', onPointerUp);
      cv.addEventListener('contextmenu', (e) => e.preventDefault());
      cv.addEventListener('wheel', onWheel, { passive: false });
      if (cv.style) cv.style.touchAction = 'none';
    }
    if (TW.q.has('glog')) logEvents();
    if (TW.q.has('gauto')) AP.on = true;
    TW.on('beaconLit', (d) => apLog('lit', d.index));
    TW.on('wreck', () => apLog('wreck', -1));
    TW.on('lanternOut', () => apLog('lanternOut', -1));
    TW.on('ending', () => apLog('ending', -1));
    updateWeather(0); updateCamera(0); updateHud(0);
  }

  function beginSailing() {
    S.phase = 'sailing';
    moor.on = false;
    if (B.sail < 0.25) B.sail = 0.25;
    G.autoSail = 0.7;
    G.tutT = 0;
  }

  function start() {
    if (!S || S.phase !== 'title') return;
    beginSailing();
    TW.emit('start');
    applyDebugQuery();
  }

  function pause() {
    if (!S || (S.phase !== 'sailing' && S.phase !== 'free')) return;
    G.prevPhase = S.phase; S.phase = 'paused';
    endExposure();                                   // never leave the grade pulled while paused; it re-engages on resume
    clearKeys();
    TW.emit('pause');
  }

  function resume() {
    if (!S || S.phase !== 'paused') return;
    S.phase = G.prevPhase === 'free' ? 'free' : 'sailing';
    TW.emit('resume');
  }

  function restart() {
    if (!S) return;
    resetRun();
    beginSailing();
    G.tutStep = 1; G.tutT = 4;                 // skip the control reminder, keep the first objective line
    CK.wTitle = 0; G.introFade = 1; G.introRate = 1.1;
    clearKeys();
    TW.emit('restart');
  }

  function sailOn() {
    if (!S || S.phase !== 'ending') return;
    S.phase = 'free';
    moor.on = false;
    if (B.sail < 0.3) B.sail = 0.3;
    G.autoSail = 0.7;
    CK.snap = false;
  }

  // Called by 73-regatta.js. While a race is active the adventure objectives,
  // kindling rings and pickups stay out of the way; sailing physics is untouched.
  function setRaceMode(on) {
    raceMode = !!on;
    if (raceMode) {
      assist.on = false; G.kindleIdx = -1; G.ringIdx = -1; G.objKey = 'race';
      hud.objective = ''; hud.target = null; hud.ring = null; moor.on = false;
    } else {
      G.objKey = '';
    }
  }

  function update(dt) {
    if (!S) return;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.1) dt = 0.1;
    if (S.beacons.length !== W.beacons.length) S.beacons = W.beacons.map(() => ({ lit: 0, kindled: false, progress: 0 }));
    if (S.phase === 'paused') { hud.fade = Math.max(hud.fade, 0); return; }    // the world holds its breath
    gatherInput(dt);
    updateWeather(dt);
    // semi-fixed sub-steps: never longer than 1/60 s, at most 4 a frame
    let n = Math.ceil(dt * 60 - 1e-6);
    if (n < 1) n = 1; else if (n > 4) n = 4;
    const h = dt / n;
    if (h > 0) for (let i = 0; i < n; i++) stepBoat(h);
    updateProgress(dt);
    updateHeart(dt);
    updateLantern(dt);
    updateRespawn(dt);
    updateExposure(dt);
    updateHints(dt);
    if (S.phase === 'sailing' && resp.mode === 0) stats.time += dt;
    updateHud(dt);
    updateCamera(dt);
  }

  // ===========================================================================
  // DEBUG (query params / TW.game.debug.go) — harmless in production
  // ===========================================================================
  function dbgGo(name) {
    const b = B, wb = W.beacons;
    if (name === 'kindle' || name === 'ring') {
      const i = Math.max(0, nearestUnlit(true)), d = wb[i].dock;
      let ax = d.x - wb[i].x, az = d.z - wb[i].z; const l = hyp(ax, az) || 1; ax /= l; az /= l;
      if (name === 'ring') { placeBoat(d.x, d.z, Math.atan2(ax, az), 0); b.sail = 0; G.autoSail = -1; }
      else { placeBoat(d.x + ax * 75, d.z + az * 75, Math.atan2(-ax, -az), 6); b.sail = 0.7; }
    } else if (name === 'heart') {
      for (let i = 0; i < wb.length; i++) if (!wb[i].isHeart) { S.beacons[i].kindled = true; S.beacons[i].lit = 1; S.beacons[i].progress = 1; }
    } else if (name === 'heartlit') {
      // five lit, skiff at rest in the Heartlight's ring, kindling just beginning (ignition ~3 s later)
      for (let i = 0; i < wb.length; i++) if (!wb[i].isHeart) { S.beacons[i].kindled = true; S.beacons[i].lit = 1; S.beacons[i].progress = 1; }
      const i = G.heartIdx >= 0 ? G.heartIdx : 0, d = wb[i].dock;
      G.heartOpenSent = true; WX.stormBase = SETTINGS.weather.heartOpenBase;
      placeBoat(d.x, d.z, dockSpawn(i, spawnTmp).heading, 0); b.sail = 0.2; G.autoSail = -1;
      updateProgress(0);
    } else if (name === 'ending') {
      for (let i = 0; i < wb.length; i++) { S.beacons[i].kindled = true; S.beacons[i].lit = 1; S.beacons[i].progress = 1; }
      const i = G.heartIdx >= 0 ? G.heartIdx : 0, d = wb[i].dock;
      placeBoat(d.x, d.z, dockSpawn(i, spawnTmp).heading, 0);
      updateProgress(0); beginEnding(i);
    } else if (name === 'oil') { L.oil = 0.012; }
    else if (name === 'ground' && W.islands && W.islands.length) {
      let bi = 0, bd = 1e12;
      for (let i = 0; i < W.islands.length; i++) { const d = hyp(W.islands[i].x - b.x, W.islands[i].z - b.z); if (d < bd) { bd = d; bi = i; } }
      const is = W.islands[bi], a = Math.atan2(b.x - is.x, b.z - is.z);
      let r = is.r + 80; const sx = Math.sin(a), sz = Math.cos(a);
      while (r > 5 && W.heightAt(is.x + sx * (r - 30), is.z + sz * (r - 30)) < -1) r -= 5;   // 30 m off the true shoreline
      placeBoat(is.x + sx * r, is.z + sz * r, a + PI, 9); b.sail = 1;
    } else if (name === 'rock' && W.rocks && W.rocks.length) {
      const r = W.rocks[0]; placeBoat(r.x, r.z - r.r - 30, 0, 9); b.sail = 1;
    } else if (name === 'maw' && W.vortex) {
      placeBoat(W.vortex.x + W.vortex.r * 1.2, W.vortex.z, 0, 4); b.sail = 0.7;
    } else if (name === 'float' && W.floats && W.floats.length) {
      const f = W.floats[0]; placeBoat(f.x, f.z - 25, 0, 6); b.sail = 0.7;
    } else if (name === 'irons') { placeBoat(b.x, b.z, Math.atan2(-WN.dirX, -WN.dirZ), 0); b.sail = 1; }
    else if (name === 'edge') { placeBoat(0, -(T.BOUNDS + 60), PI, 8); b.sail = 1; }
  }
  debug.go = dbgGo;
  debug.autopilot = setAutopilot;

  function applyDebugQuery() {
    const q = TW.q;
    if (q.has('gpos')) { const a = q.get('gpos').split(',').map(Number); if (a.length >= 2 && isFinite(a[0]) && isFinite(a[1])) placeBoat(a[0], a[1], B.heading, 0); }
    if (q.has('ghead')) placeBoat(B.x, B.z, TW.qf('ghead', 0) * DEG, 0);
    if (q.has('gsail')) { B.sail = clamp(TW.qf('gsail', 0.7), 0, 1); G.autoSail = -1; }
    if (q.has('gtest')) q.get('gtest').split(',').forEach(dbgGo);
    if (q.has('gcam')) { CK.wTitle = 0; }      // skip the title -> chase glide (for screenshots)
  }

  TW.game = { init: init, update: update, start: start, pause: pause, resume: resume, restart: restart, sailOn: sailOn, setRaceMode: setRaceMode,
    applyNetworkCollision: applyNetworkCollision, applyNetworkObjectives: applyNetworkObjectives, applyNetworkWeather: applyNetworkWeather,
    touch: touch, input: inp, hud: hud, stats: stats, debug: debug, tuning: T };
})();
