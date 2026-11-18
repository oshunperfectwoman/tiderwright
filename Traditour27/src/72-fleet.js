// ===== 72-fleet.js =====
// ============================================================================
// TIDEWRIGHT — 72-fleet.js
// Three autonomous race opponents. Independent state and physics; reads the
// shared wind/world/ocean only. The player physics in 70-game.js is untouched.
// ============================================================================
(function () {
  'use strict';
  const TW = window.TW;
  const PI = Math.PI, DEG = PI / 180;
  const clamp = TW.clamp, sat = TW.saturate, damp = TW.damp, wrap = TW.wrapAngle;
  const hyp = Math.hypot;
  const T = { VMAX: 11, SAIL_RATE: 0.6, ACCEL: 0.42, DECEL: 0.30, BRAKE: 0.9, LAT_DAMP: 2.8, TURN: 0.95, TURN_REST: 0.38, YAW_RESP: 5, TURN_BLEED: 0.22, SURF: 3.2, HEAVE_K: 55, HEAVE_C: 8, PITCH_K: 42, PITCH_C: 7.2, ROLL_K: 30, ROLL_C: 5.6, BOUNDS: (TW.settings.navigation && TW.settings.navigation.bounds) || 1250 };
  const POLAR_A = [0, 30, 38, 50, 70, 90, 115, 140, 160, 180];
  const POLAR_V = [0, 0, 0.36, 0.74, 0.90, 0.97, 1.0, 0.97, 0.89, 0.82];
  const profiles = [
    { id: 'prudent', name: 'PRUDENT', tint: [0.33, 0.72, 0.62], risk: 1.55, look: 150, steer: 1.0, trim: 0.8 },
    { id: 'competitor', name: 'COMPÉTITEUR', tint: [0.94, 0.48, 0.20], risk: 0.92, look: 115, steer: 1.2, trim: 1.0 },
    { id: 'aggressive', name: 'AGRESSIF', tint: [0.55, 0.45, 0.95], risk: 0.58, look: 82, steer: 1.45, trim: 1.15 },
  ];
  const F = { active: false, running: false, gate: null, stage: null, courseGates: [], bots: [], pairContacts: 0, updateMs: 0 };
  const seaOut = () => ({ x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0 });

  function polar(deg) {
    for (let i = 1; i < POLAR_A.length; i++) if (deg <= POLAR_A[i]) return TW.lerp(POLAR_V[i - 1], POLAR_V[i], (deg - POLAR_A[i - 1]) / (POLAR_A[i] - POLAR_A[i - 1]));
    return POLAR_V[POLAR_V.length - 1];
  }
  function makeBot(p, i) {
    return { id: p.id, name: p.name, tint: p.tint.slice(), profile: p, active: true, finished: false, finishTime: 0, finishRank: 0, falseStart: false, gateIndex: 0, checkpointIndex: 0, passTimes: [],
      x: 0, z: 0, y: 0, heading: 0, vx: 0, vz: 0, speed: 0, sail: 0.18, rudder: 0, boom: 0.1, luff: 0, pitch: 0, roll: 0, hull: 1, previousX: 0, previousZ: 0,
      p: { u: 0, yawRate: 0, vy: 0, pv: 0, rv: 0, boomSide: 1, gybe: 0, slope: 0, gnx: 0, gnz: 1, aground: 0, immune: 0, bumpCd: 0, slamCd: 0 },
      ai: { think: i * 0.17, targetHeading: 0, targetSail: 0.7, state: 'PRESTART', tack: i % 2 ? 1 : -1, stuck: 0 } };
  }

  function placeBot(b, x, z, heading, offset) {
    b.x = x + offset[0]; b.z = z + offset[1]; b.heading = heading; b.vx = b.vz = b.speed = 0; b.rudder = 0; b.sail = 0.12; b.boom = 0.1; b.luff = 0; b.pitch = b.roll = 0; b.hull = 1; b.previousX = b.x; b.previousZ = b.z;
    b.y = TW.env.seaHeight(b.x, b.z, seaOut());
    b.p.u = b.p.yawRate = b.p.vy = b.p.pv = b.p.rv = b.p.gybe = b.p.aground = 0; b.p.boomSide = 1; b.p.gnx = 0; b.p.gnz = 1;
    b.ai.state = 'PRESTART'; b.ai.stuck = 0; b.finished = false; b.finishTime = 0; b.finishRank = 0; b.gateIndex = 0; b.checkpointIndex = 0; b.passTimes = [];
  }

  function start(state) {
    if (!state || !state.gate || !state.stage) return false;
    if (TW.multiplayer && TW.multiplayer.isConnected && TW.multiplayer.isConnected()) { reset(); return true; }
    F.active = true; F.running = false; F.gate = state.gate; F.stage = state.stage; F.courseGates = (state.courseGates || []).slice(); F.pairContacts = 0;
    if (F.bots.length !== profiles.length) F.bots = profiles.map(makeBot);
    const g = state.gate, spacing = Math.min(18, g.half * 0.34);
    const offsets = [-spacing, 0, spacing].map((s) => [g.px * s - g.ux * (8 + Math.abs(s) * 0.25), g.pz * s - g.uz * (8 + Math.abs(s) * 0.25)]);
    F.bots.forEach((b, i) => placeBot(b, g.sx - g.ux * 18, g.sz - g.uz * 18, Math.atan2(g.ux, g.uz), offsets[i]));
    return true;
  }
  function go() { if (F.active) { F.running = true; F.bots.forEach((b) => { b.ai.state = 'SAILING'; b.sail = 0.3; }); } }
  function reset() { F.active = false; F.running = false; F.gate = null; F.stage = null; F.courseGates = []; F.bots.forEach((b) => { b.active = false; }); }

  function gateTarget(b) { const g = F.courseGates[b.checkpointIndex] || F.courseGates[F.courseGates.length - 1]; return g ? { x: g.x, z: g.z } : { x: F.gate.fx, z: F.gate.fz }; }
  function blocked(x, z, a, len, margin) {
    const W = TW.world, sx = Math.sin(a), sz = Math.cos(a), m = margin || 7;
    for (let d = 8; d <= len; d += 8) {
      const px = x + sx * d, pz = z + sz * d;
      if (W.heightAt(px, pz) > -1.6) return true;
      if (hyp(px, pz) > T.BOUNDS - 18 && hyp(px, pz) > hyp(x, z)) return true;
      if (W.rocks) for (let i = 0; i < W.rocks.length; i++) { const r = W.rocks[i]; if (hyp(px - r.x, pz - r.z) < r.r + m) return true; }
    }
    return false;
  }
  function chooseHeading(b) {
    const t = gateTarget(b), dist = hyp(t.x - b.x, t.z - b.z), direct = Math.atan2(t.x - b.x, t.z - b.z), windFrom = Math.atan2(-TW.state.wind.dirX, -TW.state.wind.dirZ);
    let best = direct, bestScore = -Infinity;
    for (let k = -8; k <= 8; k++) {
      const a = direct + k * 10 * DEG, rel = Math.abs(wrap(a - windFrom)) / DEG;
      if (rel < 34) continue;
      const look = Math.min(b.profile.look, Math.max(35, dist));
      if (blocked(b.x, b.z, a, look, 8 * b.profile.risk)) continue;
      const theta = Math.acos(clamp(-(Math.sin(a) * TW.state.wind.dirX + Math.cos(a) * TW.state.wind.dirZ), -1, 1)) / DEG;
      const progress = Math.cos(wrap(a - direct));
      const speed = polar(theta);
      const risk = Math.abs(k) * 0.015 * b.profile.risk;
      const score = progress * speed - risk;
      if (score > bestScore) { bestScore = score; best = a; }
    }
    if (b.ai.stuck > 4) { b.ai.tack = -b.ai.tack; b.ai.stuck = 0; }
    return best;
  }
  function think(b, dt) {
    b.ai.think -= dt;
    if (b.ai.think > 0) return;
    b.ai.think = 0.16 + b.profile.risk * 0.12;
    if (!F.running) { b.ai.state = 'PRESTART'; b.ai.targetHeading = b.heading; b.ai.targetSail = 0.12; return; }
    b.ai.state = b.finished ? 'FINISHED' : 'SAILING';
    if (b.finished) { b.ai.targetSail = 0.15; return; }
    b.ai.targetHeading = chooseHeading(b);
    const fx = Math.sin(b.ai.targetHeading), fz = Math.cos(b.ai.targetHeading), theta = Math.acos(clamp(-(fx * TW.state.wind.dirX + fz * TW.state.wind.dirZ), -1, 1)) / DEG;
    b.ai.targetSail = theta < 45 ? 0.55 : theta > 135 ? 0.92 : 0.76;
  }

  function step(b, input, h) {
    const wind = TW.state.wind, p = b.p, ph = F.running && !b.finished, steer = ph ? input.steer : 0, trim = ph ? input.trim : 0;
    p.immune -= h; p.bumpCd -= h; p.slamCd -= h;
    if (ph) b.sail = clamp(b.sail + trim * T.SAIL_RATE * h, 0, 1); else b.sail = damp(b.sail, 0.12, 2, h);
    b.rudder = damp(b.rudder, steer, Math.abs(steer) > Math.abs(b.rudder) ? 7 : 9, h);
    let cx = 0, cz = 0, autoYaw = 0;
    const dc = hyp(b.x, b.z);
    if (dc > T.BOUNDS) { const q = sat((dc - T.BOUNDS) / 160); cx -= b.x / dc * 9 * q; cz -= b.z / dc * 9 * q; autoYaw -= clamp(wrap(Math.atan2(-b.x, -b.z) - b.heading), -1, 1) * 0.75 * q; }
    const fx = Math.sin(b.heading), fz = Math.cos(b.heading), au = Math.abs(p.u), auth = 0.38 + 0.62 * sat(au / 5.5) - 0.12 * sat((au - 8) / 4);
    p.yawRate = damp(p.yawRate, b.rudder * T.TURN * auth + autoYaw, T.YAW_RESP, h); b.heading = wrap(b.heading - p.yawRate * h);
    const nfx = Math.sin(b.heading), nfz = Math.cos(b.heading), theta = Math.acos(clamp(-(nfx * wind.dirX + nfz * wind.dirZ), -1, 1)) / DEG, side = wind.dirX * nfz - wind.dirZ * nfx;
    const wspd = wind.speed * (1 + wind.gust), windF = Math.pow(clamp(wspd / 17, 0.25, 1.2), 0.45), sailEff = Math.pow(Math.max(b.sail, 0), 0.75);
    b.luff = damp(b.luff, b.sail > 0.05 ? 1 - TW.smoothstep(30, 44, theta) : 0, 5, h);
    const wantBoom = side > 0 ? -1 : 1;
    if (wantBoom !== p.boomSide && Math.abs(side) > 0.12) { p.boomSide = wantBoom; if (theta > 100 && b.sail > 0.2 && ph) p.gybe = 1; }
    p.gybe = Math.max(0, p.gybe - h * 1.1); b.boom = damp(b.boom, p.boomSide * TW.lerp(0.14, 80 * DEG, TW.smoothstep(35, 172, theta)) * (0.15 + 0.85 * sat(b.sail * 1.6)), 4.5, h);
    let u = b.vx * nfx + b.vz * nfz, v = b.vx * nfz - b.vz * nfx, vT = 0, rate = 1;
    if (ph) { vT = T.VMAX * polar(theta) * windF * sailEff * (1 - 0.3 * p.gybe); rate = vT > u ? T.ACCEL : T.DECEL; if (trim < 0 && b.sail < 0.05) rate = T.BRAKE; }
    u += (vT - u) * (1 - Math.exp(-rate * h)); u -= u * Math.abs(p.yawRate) * T.TURN_BLEED * h; const vLee = ph ? side * 0.55 * sailEff * windF * (1 - b.luff) : 0; v = damp(v, vLee, T.LAT_DAMP, h);
    b.vx = nfx * u + nfz * v; b.vz = nfz * u - nfx * v; b.speed = hyp(b.vx, b.vz); p.u = u; b.x += (b.vx + cx) * h; b.z += (b.vz + cz) * h;
    resolveTerrain(b, h); updateWavePose(b, h);
  }
  function resolveTerrain(b, h) {
    const W = TW.world, fx = Math.sin(b.heading), fz = Math.cos(b.heading), probes = [[2.7, 0], [-2.5, 0], [0.3, 1.15], [0.3, -1.15], [0, 0]]; let worst = 0, wx = b.x, wz = b.z;
    for (let i = 0; i < probes.length; i++) { const px = b.x + fx * probes[i][0] + fz * probes[i][1], pz = b.z + fz * probes[i][0] - fx * probes[i][1], d = W.heightAt(px, pz) + 0.5; if (d > worst) { worst = d; wx = px; wz = pz; } }
    if (worst > 0) { const e = 1.5; let gx = W.heightAt(wx + e, wz) - W.heightAt(wx - e, wz), gz = W.heightAt(wx, wz + e) - W.heightAt(wx, wz - e), gl = hyp(gx, gz) || 1; const nx = -gx / gl, nz = -gz / gl, push = Math.min(worst / Math.max(gl / (2 * e), 0.15), 1.2) + 0.02; b.x += nx * push; b.z += nz * push; const vn = b.vx * nx + b.vz * nz; if (vn < 0) { b.vx -= vn * nx * 1.1; b.vz -= vn * nz * 1.1; } b.p.aground = 1; } else b.p.aground = Math.max(0, b.p.aground - h * 2);
    if (W.rocks) for (let i = 0; i < W.rocks.length; i++) { const r = W.rocks[i], Rr = r.r + 1.8, dx = b.x - r.x, dz = b.z - r.z, d = hyp(dx, dz); if (d < Rr) { const inv = 1 / Math.max(d, 0.001), nx = dx * inv, nz = dz * inv; b.x = r.x + nx * Rr; b.z = r.z + nz * Rr; const vn = b.vx * nx + b.vz * nz; if (vn < 0) { b.vx -= vn * nx * 1.2; b.vz -= vn * nz * 1.2; } b.hull = Math.max(0.35, b.hull - Math.min(0.12, Math.max(0, -vn) * 0.008)); } }
  }
  function updateWavePose(b, h) {
    const fx = Math.sin(b.heading), fz = Math.cos(b.heading), o1 = seaOut(), o2 = seaOut(), o3 = seaOut(), o4 = seaOut();
    const hb = TW.env.seaHeight(b.x + fx * 2.5, b.z + fz * 2.5, o1), hs = TW.env.seaHeight(b.x - fx * 2.3, b.z - fz * 2.3, o2), hp = TW.env.seaHeight(b.x + fz * 1.05, b.z - fx * 1.05, o3), hq = TW.env.seaHeight(b.x - fz * 1.05, b.z + fx * 1.05, o4);
    b.p.slope = (hb - hs) / 4.8;
    // Same four-point wave-riding model as the player, including an explicit
    // recovery impulse for a bot that falls too far below a steep swell.
    const yT = (hb + hs) * 0.27 + (hp + hq) * 0.23 + 0.04;
    const buoyancyRecovery = b.y < yT - 0.45 ? 1.8 : 1;
    b.p.vy += (T.HEAVE_K * (yT - b.y) * buoyancyRecovery - T.HEAVE_C * b.p.vy) * h; b.y += b.p.vy * h;
    if (b.y < yT - 1.35) { b.y = yT - 1.35; b.p.vy = Math.max(0, b.p.vy); }
    const pT = -Math.atan2(hb - hs, 4.8) * 0.92; b.p.pv += (T.PITCH_K * (pT - b.pitch) - T.PITCH_C * b.p.pv) * h; b.pitch += b.p.pv * h;
    const side = TW.state.wind.dirX * fz - TW.state.wind.dirZ * fx, heel = -side * 0.2 * Math.pow(Math.max(b.sail, 0), 0.75) * Math.pow(clamp(TW.state.wind.speed / 17, 0.25, 1.2), 0.45) * 0.5, rT = Math.atan2(hp - hq, 2.1) * 0.62 + heel; b.p.rv += (T.ROLL_K * (rT - b.roll) - T.ROLL_C * b.p.rv) * h; b.roll += b.p.rv * h; b.pitch = clamp(b.pitch, -0.7, 0.7); b.roll = clamp(b.roll, -0.9, 0.9);
  }
  function solvePair(a, b, min) {
    const dx = b.x - a.x, dz = b.z - a.z, d = hyp(dx, dz); if (d >= min) return false;
    const inv = 1 / Math.max(d, 0.001), nx = dx * inv, nz = dz * inv, push = (min - d) * 0.52;
    a.x -= nx * push; a.z -= nz * push; b.x += nx * push; b.z += nz * push;
    const rv = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
    if (rv < 0) { const imp = -rv * 0.5; a.vx -= nx * imp; a.vz -= nz * imp; b.vx += nx * imp; b.vz += nz * imp; }
    a.speed = hyp(a.vx, a.vz); b.speed = hyp(b.vx, b.vz); return true;
  }
  function solvePairs() {
    F.pairContacts = 0;
    for (let i = 0; i < F.bots.length; i++) for (let j = i + 1; j < F.bots.length; j++) if (solvePair(F.bots[i], F.bots[j], 6.2)) F.pairContacts++;
    // The player is a fourth physical hull during a race. Resolve the contact
    // without routing it through the player's adventure hit()/respawn events.
    const player = TW.state && TW.state.boat;
    if (player) for (let i = 0; i < F.bots.length; i++) {
      const b = F.bots[i], dx = b.x - player.x, dz = b.z - player.z, d = hyp(dx, dz);
      if (d >= 6.2) continue;
      const inv = 1 / Math.max(d, 0.001), nx = dx * inv, nz = dz * inv, push = (6.2 - d) * 0.52;
      player.x -= nx * push; player.z -= nz * push; b.x += nx * push; b.z += nz * push;
      const rv = (b.vx - player.vx) * nx + (b.vz - player.vz) * nz;
      if (rv < 0) { const imp = -rv * 0.5; player.vx -= nx * imp; player.vz -= nz * imp; b.vx += nx * imp; b.vz += nz * imp; }
      player.speed = hyp(player.vx, player.vz); b.speed = hyp(b.vx, b.vz); F.pairContacts++;
    }
  }
  function update(dt, raceState) {
    if (TW.multiplayer && TW.multiplayer.isConnected && TW.multiplayer.isConnected()) { if (F.active) reset(); return; }
    if (!F.active || !raceState || raceState.phase === 'idle') return;
    const t0 = performance.now();
    for (let i = 0; i < F.bots.length; i++) { const b = F.bots[i]; if (!b.active) continue; b.previousX = b.x; b.previousZ = b.z;
      if (raceState.phase === 'racing') {
        think(b, dt); const err = wrap(b.ai.targetHeading - b.heading), input = { steer: clamp(-err * b.profile.steer, -1, 1), trim: b.sail < b.ai.targetSail - 0.03 ? 1 : b.sail > b.ai.targetSail + 0.03 ? -1 : 0 }; let n = Math.ceil(Math.max(0, Math.min(dt, 0.1)) * 60 - 1e-6); n = clamp(n, 1, 4); const h = dt / n; for (let k = 0; k < n; k++) step(b, input, h); b.ai.stuck = b.speed < 0.55 ? b.ai.stuck + dt : 0;
        if (!b.finished && TW.regatta && TW.regatta.checkCompetitorCrossing) { const cs = TW.regatta.checkCompetitorCrossing(b.id, b.previousX, b.previousZ, b.x, b.z, raceState.elapsed); b.checkpointIndex = cs.checkpointIndex; b.passTimes = cs.passTimes.slice(); if (cs.finished) { b.finished = true; b.finishTime = cs.finishTime; b.finishRank = F.bots.filter((q) => q.finished).length; b.ai.state = 'FINISHED'; } }
      } else if (raceState.phase === 'countdown') {
        b.ai.targetSail = 0.12; step(b, { steer: 0, trim: 0 }, Math.min(dt, 0.05));
      } else if (raceState.phase === 'finished') {
        // Navigation is over, but the hull remains in the shared sea and must
        // continue riding the same waves as the player's boat.
        updateWavePose(b, Math.min(Math.max(dt, 0), 0.05));
      }
    }
    if (raceState.phase === 'racing') solvePairs();
    F.updateMs = performance.now() - t0;
  }
  function draw() {
    if (!TW.boat || !TW.boat.drawState) return;
    if (TW.multiplayer && TW.multiplayer.isConnected && TW.multiplayer.isConnected()) {
      if (F.active) reset();
      if (TW.multiplayer.draw) TW.multiplayer.draw();
      return;
    }
    if (F.active) {
      for (let i = 0; i < F.bots.length; i++) { const b = F.bots[i]; if (!b.active) continue; TW.boat.drawState(b, { tint: b.tint, belly: (b.sail - 0.5) * 0.35 }); }
    }
    if (TW.multiplayer && TW.multiplayer.draw) TW.multiplayer.draw();
  }
  function results() {
    if (TW.multiplayer && TW.multiplayer.isConnected && TW.multiplayer.isConnected()) return [];
    return F.bots.map((b) => ({ id: b.id, name: b.name, finished: b.finished, time: b.finishTime, rank: b.finishRank, state: b.ai.state, x: b.x, z: b.z, speed: b.speed, checkpointIndex: b.checkpointIndex, passTimes: b.passTimes.slice() }));
  }
  TW.fleet = { start, go, reset, update, draw, results, state: F };
  TW.on('race:start', () => { if (TW.regattaState) start(TW.regattaState); });
  TW.on('race:go', go);
  TW.on('race:abort', reset);
})();
