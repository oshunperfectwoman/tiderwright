// ============================================================================
// TIDEWRIGHT — 30-world.js
// The Guadeloupe Archipelago: heightfield islands, sea stacks, a sea arch, lighthouses,
// keepers' cottages, jetties, kindling rings, storm-glass floats, the world map
// texture and the fast CPU height query.
// OWNER: agent WORLD.
// ============================================================================
(function () {
  'use strict';
  const TW = window.TW;
  const SIZE = 3072, HALF = 1536, GN = 1536, CELL = 2, MAPN = 1024, DEEP = TW.settings.world.deep;
  const WX = 0.5, WZ = 0.866;                       // prevailing wind (blows TOWARD)
  const sstep = TW.smoothstep, lerp = TW.lerp, clamp = TW.clamp;
  function norm3(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  const MOON = norm3([0.30, 0.30, -0.84]), SUN = norm3([0.90, 0.30, -0.40]);
  const RING_N = 12, DOCK_R = 28;
  let G = null;                                     // GN*GN terrain heights (m), cell centres

  // ---------------------------------------------------------------------------
  // Layout (hand-authored). North = -Z, east = +X. Index 0..4 outer beacons, 5 = the Heartlight.
  // ---------------------------------------------------------------------------
  const WD = TW.worldData;
  const { ISLES, ROCKS_HAND, ARCH, SAINTES_CHANNEL, FLOATS_HAND, SPAWN_DIR, SPAWN_DIST, MAW_DIST, MAW_R } = WD;

  const world = (TW.world = {
    size: SIZE, half: HALF, heightAt, mapTex: null, initMs: 0, deferGlows: false,
    islands: [], beacons: [], rocks: [], floats: [], vortex: { x: -218, z: 328, r: MAW_R }, spawn: { x: -632, z: 830, heading: 2.6 },
    init, update, draw, drawGlows, _generate: generate, _meshes: buildMeshes, _isles: ISLES, _shadow: buildShadowMap,
  });

  // ---------------------------------------------------------------------------
  // Height query (bilinear in the 2 m grid). Hot path: physics + wave attenuation.
  // ---------------------------------------------------------------------------
  function heightAt(x, z) {
    if (!(x >= -HALF && x <= HALF && z >= -HALF && z <= HALF)) return -200;
    if (!G) return DEEP;
    let fx = (x + HALF) * 0.5 - 0.5, fz = (z + HALF) * 0.5 - 0.5;
    if (fx < 0) fx = 0; else if (fx > GN - 1.001) fx = GN - 1.001;
    if (fz < 0) fz = 0; else if (fz > GN - 1.001) fz = GN - 1.001;
    const ix = fx | 0, iz = fz | 0, tx = fx - ix, tz = fz - iz, k = iz * GN + ix;
    const a = G[k], b = G[k + 1], c = G[k + GN], d = G[k + GN + 1];
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
  }

  // ---------------------------------------------------------------------------
  // Official coastline raster. The source polygons and the world heightfield use
  // the same RGAF09-derived X/Z coordinates. Scanline filling keeps this cheap.
  // ---------------------------------------------------------------------------
  function buildCoastMask(I, i0, j0, i1, j1) {
    if (!Array.isArray(I.coast) || I.coast.length < 3) return null;
    const w = i1 - i0 + 1, h = j1 - j0 + 1, data = new Uint8Array(w * h), poly = I.coast;
    const intersections = [];
    for (let j = 0; j < h; j++) {
      const z = (j + j0 + 0.5) * CELL - HALF;
      intersections.length = 0;
      for (let k = 0, n = poly.length; k < n; k++) {
        const a = poly[k], b = poly[(k + 1) % n];
        if ((a[1] <= z && b[1] > z) || (b[1] <= z && a[1] > z)) {
          intersections.push(a[0] + (z - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
        }
      }
      intersections.sort((a, b) => a - b);
      for (let k = 0; k + 1 < intersections.length; k += 2) {
        const xa = intersections[k], xb = intersections[k + 1];
        let a = Math.ceil((xa + HALF) / CELL - 0.5);
        let b = Math.ceil((xb + HALF) / CELL - 0.5) - 1;
        a = Math.max(i0, a); b = Math.min(i1, b);
        for (let i = a; i <= b; i++) data[j * w + i - i0] = 1;
      }
    }
    return { i0, j0, w, h, data };
  }
  function coastContains(I, x, z) {
    const M = I.coastMask;
    if (!M) return true;
    const i = Math.floor((x + HALF) / CELL), j = Math.floor((z + HALF) / CELL);
    const a = i - M.i0, b = j - M.j0;
    return a >= 0 && b >= 0 && a < M.w && b < M.h && M.data[b * M.w + a] === 1;
  }
  function applyOfficialCoastBounds(I) {
    if (!Array.isArray(I.coast) || I.coast.length < 3) return;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let k = 0; k < I.coast.length; k++) {
      const p = I.coast[k];
      minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
      minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1]);
    }
    I.x = (minX + maxX) * 0.5; I.z = (minZ + maxZ) * 0.5;
    I.ax = Math.max(8, (maxX - minX) * 0.5); I.az = Math.max(8, (maxZ - minZ) * 0.5);
    I.rot = 0;
  }

  // ---------------------------------------------------------------------------
  // Island shape function
  // ---------------------------------------------------------------------------
  function isleH(I, x, z) {
    const dx = x - I.x, dz = z - I.z, s = I.s;
    if (dx * dx + dz * dz > I.far2) return DEEP;
    const R = I.R, wf = 1 / (R * 0.6);
    const px = dx + (TW.noise2(x * wf, z * wf, s + 1) - 0.5) * 2 * I.warp * R;
    const pz = dz + (TW.noise2(x * wf, z * wf, s + 2) - 0.5) * 2 * I.warp * R;
    const ux = (px * I.cr + pz * I.sr) / I.ax, uz = (-px * I.sr + pz * I.cr) / I.az;
    let d = Math.sqrt(ux * ux + uz * uz);
    if (d > 1.9 && !I.coast) return DEEP;
    d += (TW.fbm2(x / 36, z / 36, 3, s + 7) - 0.5) * 2 * I.rough;
    let m = 1 - d;
    for (let i = 0; i < I.feats.length; i++) { const f = I.feats[i], ex = dx - f.x, ez = dz - f.z; m += f.a * Math.exp(-(ex * ex + ez * ez) / (f.r * f.r)); }
    // The official shoreline is authoritative: no procedural noise or peak may
    // create land outside it, and the entire official polygon remains land inside.
    if (I.coastMask) {
      if (coastContains(I, x, z)) m = Math.max(m, 0.018);
      else if (m > 0) m = -Math.max(0.012, Math.min(0.12, m * 0.12));
    }
    const dl = Math.sqrt(dx * dx + dz * dz) + 1e-3;
    const lee = sstep(-0.25, 0.75, (dx * WX + dz * WZ) / dl);       // 0 windward .. 1 lee
    const Rm = I.Rm;
    if (m <= 0) {                                                   // seabed shelf
      const o = -m * Rm;
      const steep = o * 1.15 + Math.min(o, 4) * 0.5, gentle = o * 0.17 + o * o * 0.0016;
      const dep = lerp(steep, gentle, lee) + Math.max(0, o - 45) * 1.6;
      return Math.max(DEEP, -dep);
    }
    const c = m * Rm;                                               // ~metres inland
    const cn = TW.fbm2(x / 55, z / 55, 2, s + 9);
    let h = I.cliff * (1 - 0.88 * lee) * (0.55 + 0.9 * cn) * sstep(0, lerp(6, 34, lee), c);
    h += lee * Math.min(c, 30) * 0.06;
    const bs = Math.pow(sstep(0.04, I.plateau, m), I.pow);
    const rg = TW.ridged2(x / I.rf, z / I.rf, 4, s + 3);
    // Relief principal plus doux : les crêtes ridged ne dominent plus toute la surface.
    let body = I.H * bs * lerp(1, 0.72 + 0.45 * rg, I.ridge * 0.48);
    if (I.tilt) body *= clamp(0.75 - I.tilt * (dx * WX + dz * WZ) / R, 0.2, 1.6);
    const pm = Math.min(1, m * 5);
    for (let i = 0; i < I.peaks.length; i++) { const p = I.peaks[i], ex = dx - p.x, ez = dz - p.z; body += p.h * Math.exp(-(ex * ex + ez * ez) / (p.r * p.r)) * (0.5 + 0.85 * rg) * pm; }
    // Basse-Terre: a deliberate volcanic mountain spine, rather than a single
    // generic dome. The profile is procedural and deterministic, fitted to the
    // recovered playable island footprint. It creates a southern high massif,
    // several secondary ridges and broad river-valley depressions.
    if (I.name === 'Basse-Terre') {
      const spineX = -8 + 0.105 * (dz - 40) + 13 * Math.sin((dz + 90) / 145);
      const along = Math.exp(-Math.pow((dz - 30) / 365, 4));
      const mainRidge = Math.exp(-Math.pow((dx - spineX) / 66, 2)) * along;
      const westRidge = 0.48 * Math.exp(-Math.pow((dx - (spineX - 82)) / 43, 2)) * Math.exp(-Math.pow((dz - 30) / 300, 4));
      const eastRidge = 0.38 * Math.exp(-Math.pow((dx - (spineX + 76)) / 48, 2)) * Math.exp(-Math.pow((dz + 5) / 315, 4));
      const soufriere = 1.0 * Math.exp(-(((dx + 18) / 68) ** 2 + ((dz - 105) / 92) ** 2));
      const northernMassif = 0.62 * Math.exp(-(((dx + 72) / 82) ** 2 + ((dz + 155) / 105) ** 2));
      const southernMassif = 0.72 * Math.exp(-(((dx - 30) / 76) ** 2 + ((dz - 245) / 88) ** 2));
      const valleys = 13 * Math.exp(-Math.pow((dx - (spineX - 42)) / 19, 2)) * along
                    + 10 * Math.exp(-Math.pow((dx - (spineX + 48)) / 17, 2)) * along;
      const volcanicRelief = (31 * mainRidge + 17 * westRidge + 15 * eastRidge
        + 37 * soufriere + 19 * northernMassif + 23 * southernMassif - valleys) * pm;
      body = Math.max(0, body * 0.58 + volcanicRelief);
    }
    h += body;
    // Les détails rocheux restent présents mais deviennent plus larges et moins pointus.
    if (I.crag) h += I.crag * 0.34 * (TW.ridged2(x / 42, z / 42, 3, s + 11) - 0.28) * sstep(2, 22, h);
    h += (TW.fbm2(x / 34, z / 34, 3, s + 5) - 0.5) * 1.15 * sstep(0, 12, c);
    if (I.terr > 0 && h > 2) {                                      // dipping strata terraces
      const dp = dx * I.dip[0] + dz * I.dip[1] + (cn - 0.5) * I.step * 1.6, u = (h + dp) / I.step, fl = Math.floor(u);
      const ht = (fl + sstep(0.6, 0.92, u - fl)) * I.step - dp;
      h = lerp(h, ht, I.terr * sstep(2, 9, h));
    }
    return h < 0.05 ? 0.05 : h;
  }

  function forCells(x, z, r, fn) {
    const ci = Math.round((x + HALF) / CELL - 0.5), cj = Math.round((z + HALF) / CELL - 0.5), n = Math.ceil(r / CELL) + 1;
    for (let j = Math.max(1, cj - n); j <= Math.min(GN - 2, cj + n); j++) for (let i = Math.max(1, ci - n); i <= Math.min(GN - 2, ci + n); i++) {
      const ex = (i + 0.5) * CELL - HALF - x, ez = (j + 0.5) * CELL - HALF - z, d = Math.sqrt(ex * ex + ez * ez);
      if (d <= r) fn(j * GN + i, d, ex, ez);
    }
  }
  function stampPad(x, z, hgt, r0, r1) {      // flat station yard with a ragged, natural skirt
    forCells(x, z, r1, (k, d, ex, ez) => { const n = TW.fbm2((x + ex) * 0.09, (z + ez) * 0.09, 2, 4711); G[k] = lerp(G[k], hgt + (n - 0.5) * 5 * sstep(r0, r1, d), sstep(r0 + (r1 - r0) * (0.45 + 1.1 * n), r0, d)); });
  }
  function rayCoast(cx, cz, dx, dz, maxT) { let last = 0; for (let t = 0; t < maxT; t += 1) if (heightAt(cx + dx * t, cz + dz * t) > 0.2) last = t; return last; }
  const _nl = { d: 0, x: 0, z: 0 };
  function nearestLand(x, z, maxr) {
    _nl.d = maxr + 1;
    forCells(x, z, maxr, (k, d, ex, ez) => { if (G[k] > 0.2 && d < _nl.d) { _nl.d = d; _nl.x = x + ex; _nl.z = z + ez; } });
    return _nl;
  }
  function stampSeg(ax, az, bx, bz, w, hgt) {
    const L = Math.hypot(bx - ax, bz - az), n = Math.ceil(L / 1.0);
    for (let i = 0; i <= n; i++) { const t = i / n; forCells(lerp(ax, bx, t), lerp(az, bz, t), w, (k) => { if (G[k] < hgt) G[k] = hgt; }); }
  }
  // The Canal des Saintes is open water between southern Basse-Terre and the islands.
  // It is kept deep after procedural island shelves are generated, so noise cannot invent
  // a shoal in the sailing lane. Land remains untouched by the mask.
  function saintesChannelDistance(x, z) {
    const C = SAINTES_CHANNEL, vx = C.bx - C.ax, vz = C.bz - C.az, wx = x - C.ax, wz = z - C.az;
    const q = clamp((wx * vx + wz * vz) / (vx * vx + vz * vz), 0, 1);
    return Math.hypot(x - (C.ax + vx * q), z - (C.az + vz * q));
  }
  function inSaintesChannel(x, z) { return saintesChannelDistance(x, z) <= SAINTES_CHANNEL.w; }
  function clearSaintesChannel() {
    const C = SAINTES_CHANNEL, minX = Math.min(C.ax, C.bx) - C.w, maxX = Math.max(C.ax, C.bx) + C.w;
    const minZ = Math.min(C.az, C.bz) - C.w, maxZ = Math.max(C.az, C.bz) + C.w;
    const i0 = Math.max(1, Math.floor((minX + HALF) / CELL) - 1), i1 = Math.min(GN - 2, Math.ceil((maxX + HALF) / CELL) + 1);
    const j0 = Math.max(1, Math.floor((minZ + HALF) / CELL) - 1), j1 = Math.min(GN - 2, Math.ceil((maxZ + HALF) / CELL) + 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = (i + 0.5) * CELL - HALF, z = (j + 0.5) * CELL - HALF;
      if (inSaintesChannel(x, z) && G[j * GN + i] < 0.2) G[j * GN + i] = Math.min(G[j * GN + i], C.depth);
    }
  }

  // ---------------------------------------------------------------------------
  // generate(): all CPU-side world data (no GL). Deterministic from TW.seed.
  // ---------------------------------------------------------------------------
  function generate() {
    G = new Float32Array(GN * GN).fill(DEEP);
    const rng = TW.rng(TW.seed * 31 + 5);
    // --- islands -------------------------------------------------------------
    ISLES.forEach((I) => {
      applyOfficialCoastBounds(I);
      I.cr = Math.cos(I.rot || 0); I.sr = Math.sin(I.rot || 0); I.R = Math.max(I.ax, I.az); I.Rm = Math.min(I.ax, I.az);
      I.ext = I.R * 1.7 + 24; I.far2 = (I.ext * 1.45) * (I.ext * 1.45); I.dip = I.dip || [0, 0]; I.peaks = I.peaks || []; I.feats = I.feats || []; I.s = TW.seed + I.seed * 1000;
      let i0 = Math.max(2, Math.floor((I.x - I.ext + HALF) / CELL)), j0 = Math.max(2, Math.floor((I.z - I.ext + HALF) / CELL));
      i0 -= i0 & 1; j0 -= j0 & 1;
      const i1 = Math.min(GN - 4, Math.ceil((I.x + I.ext + HALF) / CELL)), j1 = Math.min(GN - 4, Math.ceil((I.z + I.ext + HALF) / CELL));
      I.rect = [i0, j0, i1, j1];
      I.coastMask = buildCoastMask(I, i0, j0, i1, j1);
      const w = i1 - i0 + 1, hh = j1 - j0 + 1, T = new Float32Array(w * hh);
      let mx = -1e9, mk = 0;
      for (let j = 0; j < hh; j++) { const z = (j + j0 + 0.5) * CELL - HALF; for (let i = 0; i < w; i++) { const v = isleH(I, (i + i0 + 0.5) * CELL - HALF, z); T[j * w + i] = v; if (v > mx) { mx = v; mk = j * w + i; } } }
      I.top = [((mk % w) + i0 + 0.5) * CELL - HALF, (((mk / w) | 0) + j0 + 0.5) * CELL - HALF, mx];
      if (I.maxH) { const f = I.maxH / mx, hp = I.hpow || 1; for (let k = 0; k < T.length; k++) if (T[k] > 0) T[k] = hp === 1 ? T[k] * f : I.maxH * Math.pow(T[k] / mx, hp); I.top[2] = I.maxH; }
      const reliefScale = TW.settings.world.reliefScale || 1;
      if (reliefScale !== 1) { for (let k = 0; k < T.length; k++) if (T[k] > 0) T[k] *= reliefScale; I.top[2] *= reliefScale; }
      for (let j = 0; j < hh; j++) for (let i = 0; i < w; i++) { const k = (j + j0) * GN + i + i0; if (T[j * w + i] > G[k]) G[k] = T[j * w + i]; }
    });
    clearSaintesChannel();
    // --- lighthouse pads, docks, jetties ---------------------------------------
    const BI = ISLES.filter((I) => !I.skerry);
    BI.forEach((I) => {
      const l = Math.hypot(I.dockDir[0], I.dockDir[1]), dx = I.dockDir[0] / l, dz = I.dockDir[1] / l;
      I.dd = [dx, dz];
      if (I.lhPos) {
        // Hand-placed navigation lights: offsets are metres from the island centre.
        // This lets the playable chart match known ports and headlands instead of
        // always putting every tower on a procedural radial ray.
        I.lh = [I.x + I.lhPos[0], I.z + I.lhPos[1]];
        I.padH = I.heart ? clamp(heightAt(I.lh[0], I.lh[1]), 18, 42) : clamp(heightAt(I.lh[0], I.lh[1]), I.padMin, I.padMax);
        stampPad(I.lh[0], I.lh[1], I.padH, I.heart ? 13 : 13, I.heart ? 27 : 27);
      } else if (I.heart) { I.lh = [I.top[0], I.top[1]]; I.padH = 100; stampPad(I.lh[0], I.lh[1], I.padH, 9, 21); }
      else {
        const a = I.lhAng, lx = dx * Math.cos(a) - dz * Math.sin(a), lz = dx * Math.sin(a) + dz * Math.cos(a);
        const t = rayCoast(I.x, I.z, lx, lz, I.R * 1.6) - I.lhBack;
        I.lh = [I.x + lx * t, I.z + lz * t];
        I.padH = clamp(heightAt(I.lh[0], I.lh[1]), I.padMin, I.padMax);
        stampPad(I.lh[0], I.lh[1], I.padH, 13, 27);
      }
      // dock: first point along the ray whose nearest shore is >= 38 m away
      const tc = rayCoast(I.x, I.z, dx, dz, I.R * 1.6);
      let t = tc + 30, nl;
      for (;;) { nl = nearestLand(I.x + dx * t, I.z + dz * t, 48); if (nl.d >= 38 || t > tc + 140) break; t += 2; }
      const X = I.x + dx * t, Z = I.z + dz * t;
      I.dock = { x: X, z: Z, r: DOCK_R };
      I.shore = nl.d <= 48 ? [nl.x, nl.z] : [I.x + dx * tc, I.z + dz * tc];
      I.shoreDist = Math.hypot(I.shore[0] - X, I.shore[1] - Z);
      forCells(X, Z, 78, (k, d) => { if (G[k] < -13) G[k] = lerp(-13, G[k], sstep(46, 78, d)); });   // harbour shelf: sheltered water at every landing
      forCells(X, Z, 38, (k, d) => { if (G[k] < 0.2) { const lim = -5.5 * sstep(38, 30, d); if (G[k] > lim) G[k] = lim; } });
      const ux = (X - I.shore[0]) / I.shoreDist, uz = (Z - I.shore[1]) / I.shoreDist;
      if (I.heart) { I.village = [I.shore[0] - ux * 16, I.shore[1] - uz * 16]; stampPad(I.village[0], I.village[1], 5, 9, 19); }
      I.jetty = { ax: I.shore[0] - ux * 9, az: I.shore[1] - uz * 9, bx: X - ux * 23, bz: Z - uz * 23, ux, uz };
      stampSeg(I.jetty.ax, I.jetty.az, I.jetty.bx, I.jetty.bz, 1.9, 1.8);
    });
    // --- spawn + the Maw --------------------------------------------------------
    const d0 = BI[0].dock, dh = BI[5].dock;
    // The official coast can move a procedural dock by several metres. Never
    // trust the old fixed offset blindly: revalidate the candidate against the
    // final heightfield and choose the nearest clear-water point when needed.
    const intended = { x: d0.x + SPAWN_DIR[0] * SPAWN_DIST, z: d0.z + SPAWN_DIR[1] * SPAWN_DIST };
    const spawnSafe = (x, z) => heightAt(x, z) < -4 && !inSaintesChannel(x, z) && nearestLand(x, z, 24).d >= 18;
    let bestSpawn = null, bestScore = Infinity;
    for (let ring = 0; ring <= 260; ring += 8) {
      const count = ring ? 32 : 1;
      for (let k = 0; k < count; k++) {
        const a = count === 1 ? 0 : k * Math.PI * 2 / count;
        const x = intended.x + Math.cos(a) * ring, z = intended.z + Math.sin(a) * ring;
        if (!spawnSafe(x, z)) continue;
        const score = Math.hypot(x - intended.x, z - intended.z) + Math.max(0, -heightAt(x, z) - 55) * 0.015;
        if (score < bestScore) { bestScore = score; bestSpawn = { x, z }; }
      }
      if (bestSpawn && ring >= 24) break;
    }
    if (!bestSpawn) {
      for (let ring = 0; ring <= 320 && !bestSpawn; ring += 10) for (let k = 0; k < 24 && !bestSpawn; k++) {
        const a = k * Math.PI * 2 / 24, x = intended.x + Math.cos(a) * ring, z = intended.z + Math.sin(a) * ring;
        if (heightAt(x, z) < -4 && !inSaintesChannel(x, z)) bestSpawn = { x, z };
      }
    }
    const sp = bestSpawn || intended;
    sp.heading = Math.atan2(d0.x - sp.x, d0.z - sp.z);
    sp.heading = Math.atan2(d0.x - sp.x, d0.z - sp.z);
    const ml = Math.hypot(sp.x - dh.x, sp.z - dh.z);
    const vortex = { x: dh.x + (sp.x - dh.x) / ml * MAW_DIST, z: dh.z + (sp.z - dh.z) / ml * MAW_DIST, r: MAW_R };
    // --- rocks ------------------------------------------------------------------
    const rocks = [];
    const rockOK = (x, z, r) => {
      if (heightAt(x, z) > -2.5 || Math.hypot(x, z) > 1225 || inSaintesChannel(x, z)) return false;
      if (Math.hypot(x - sp.x, z - sp.z) < 85 + r) return false;
      if (Math.hypot(x - vortex.x, z - vortex.z) < vortex.r + 64 + r) return false;
      for (let i = 0; i < BI.length; i++) {
        const D = BI[i].dock, ex = x - D.x, ez = z - D.z, d = Math.hypot(ex, ez);
        if (d < 88 + r) return false;
        if (d < 300 && (ex * BI[i].dd[0] + ez * BI[i].dd[1]) / d > 0.45) return false;
      }
      for (let i = 0; i < rocks.length; i++) if (Math.hypot(x - rocks[i].x, z - rocks[i].z) < r + rocks[i].r + 10) return false;
      return true;
    };
    const addRock = (x, z, r, h, lean, la) => { rocks.push({ x, z, r, h, lean: lean || 0, la: la === undefined ? rng() * 6.283 : la }); };
    // the arch legs first (always kept)
    addRock(ARCH.ax, ARCH.az, ARCH.r, ARCH.h, 0, 0); rocks[0].arch = 1; addRock(ARCH.bx, ARCH.bz, ARCH.r, ARCH.h, 0, 0); rocks[1].arch = 1;
    const rocksOverride = TW.settings.world.rocksOverride;
    if (Array.isArray(rocksOverride)) {
      rocksOverride.slice(0, 200).forEach((q) => {
        if (!q || !Number.isFinite(Number(q.x)) || !Number.isFinite(Number(q.z))) return;
        const x = clamp(Number(q.x), -HALF + 20, HALF - 20), z = clamp(Number(q.z), -HALF + 20, HALF - 20);
        if (Math.hypot(x, z) > 1225) return;
        const r = clamp(Number.isFinite(Number(q.r)) ? Number(q.r) : 6, 3, 20);
        const h = clamp(Number.isFinite(Number(q.h)) ? Number(q.h) : 12, 4, 40);
        const lean = clamp(Number.isFinite(Number(q.lean)) ? Number(q.lean) : 0, 0, 1.5);
        const la = Number.isFinite(Number(q.la)) ? Number(q.la) : undefined;
        addRock(x, z, r, h, lean, la);
      });
    } else {
      ROCKS_HAND.forEach((q) => { if (rockOK(q[0], q[1], q[2])) addRock(q[0], q[1], q[2], q[3], q[4]); });
      const wa = Math.atan2(-WZ, -WX);                                // windward bearing (xz angle)
      ISLES.forEach((I) => {
        const n = I.skerry ? 1 : 3;
        for (let k = 0; k < n; k++) for (let tries = 0; tries < 8; tries++) {
          const a = wa + (I.skerry ? (rng() - 0.5) * 5 : (k - 1) * 1.15 + (rng() - 0.5) * 0.7), cx = Math.cos(a), cz = Math.sin(a);
          const t = rayCoast(I.x, I.z, cx, cz, I.R * 1.7) + 20 + rng() * 42, r = 4.5 + rng() * 4, hgt = 6 + rng() * rng() * 22 + (I.lean ? 8 : 0);
          const x = I.x + cx * t, z = I.z + cz * t;
          if (rockOK(x, z, r)) { addRock(x, z, r, hgt, I.lean ? 0.5 + rng() * 0.6 : (rng() < 0.3 ? rng() * 0.6 : 0)); break; }
        }
      });
    }
    rocks.forEach((q) => {
      forCells(q.x, q.z, q.r + 14, (k, d) => {
        const v = d < q.r ? q.h * sstep(q.r, q.r * 0.45, d) + 0.25 : -lerp(0.4, 14, (d - q.r) / 14);
        if (v > G[k]) G[k] = v;
      });
    });
    // --- floats -----------------------------------------------------------------
    const floats = [];
    const floatOK = (x, z) => { if (inSaintesChannel(x, z) || heightAt(x, z) > -4) return false; for (let i = 0; i < rocks.length; i++) if (!rocks[i].arch && Math.hypot(x - rocks[i].x, z - rocks[i].z) < rocks[i].r + 7) return false; return true; };
    FLOATS_HAND.forEach((f) => {
      let x = f[0], z = f[1];
      for (let k = 0; k < 24 && !floatOK(x, z); k++) { const a = k * 2.4, d = 14 + k * 5; x = f[0] + Math.cos(a) * d; z = f[1] + Math.sin(a) * d; }
      floats.push({ x, z, taken: false });
    });
    // --- public data --------------------------------------------------------------
    world.spawn = sp; world.vortex = vortex; world.rocks = rocks.map((q) => Object.assign({}, q)); world.floats = floats;
    world.islands = ISLES.map((I) => ({ name: I.name, x: I.x, z: I.z, r: I.R }));
    world.beacons = BI.map((I, i) => {
      const T = I.tw; I.lampY = I.padH + T.H + 2.0 + T.gh * 0.5;
      return { id: i, name: I.bname || I.name, x: I.lh[0], z: I.lh[1], lamp: [I.lh[0], I.lampY, I.lh[1]], dock: I.dock, dockDir: { x: I.dd[0], z: I.dd[1] }, isHeart: !!I.heart };
    });
    return { rocks, BI };
  }

  // ---------------------------------------------------------------------------
  // World map texture data: R height, G distance to shore (water), B biome noise
  // ---------------------------------------------------------------------------
  function buildMap() {
    const N = MAPN, ts = SIZE / N, M = new Float32Array(N * N * 4), D = new Float32Array(N * N);
    for (let j = 0, k = 0; j < N; j++) { const z = (j + 0.5) * ts - HALF; for (let i = 0; i < N; i++, k++) { const h = heightAt((i + 0.5) * ts - HALF, z); M[k * 4] = h; D[k] = h > 0 ? 0 : 1e4; } }
    // sub-texel seeding next to the shoreline
    for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
      const k = j * N + i; if (D[k] === 0) continue;
      const hw = M[k * 4]; let best = 1e4;
      const l = M[(k - 1) * 4], r = M[(k + 1) * 4], u = M[(k - N) * 4], d = M[(k + N) * 4];
      if (l > 0) best = Math.min(best, ts * hw / (hw - l)); if (r > 0) best = Math.min(best, ts * hw / (hw - r));
      if (u > 0) best = Math.min(best, ts * hw / (hw - u)); if (d > 0) best = Math.min(best, ts * hw / (hw - d));
      if (best < 1e4) D[k] = Math.max(0.05, best);
    }
    const a = ts, b = ts * 1.41421;
    for (let j = 1; j < N; j++) for (let i = 1; i < N - 1; i++) {
      const k = j * N + i; let v = D[k]; if (v === 0) continue;
      let t = D[k - 1] + a; if (t < v) v = t; t = D[k - N] + a; if (t < v) v = t; t = D[k - N - 1] + b; if (t < v) v = t; t = D[k - N + 1] + b; if (t < v) v = t; D[k] = v;
    }
    for (let j = N - 2; j >= 0; j--) for (let i = N - 2; i >= 1; i--) {
      const k = j * N + i; let v = D[k]; if (v === 0) continue;
      let t = D[k + 1] + a; if (t < v) v = t; t = D[k + N] + a; if (t < v) v = t; t = D[k + N + 1] + b; if (t < v) v = t; t = D[k + N - 1] + b; if (t < v) v = t; D[k] = v;
    }
    // biome noise at quarter res, bilinear upsample
    const Q = 256, Bn = new Float32Array(Q * Q);
    for (let j = 0; j < Q; j++) for (let i = 0; i < Q; i++) Bn[j * Q + i] = TW.saturate((TW.fbm2(i * 0.047, j * 0.047, 3, TW.seed + 77) - 0.5) * 2.4 + 0.5);
    for (let j = 0, k = 0; j < N; j++) {
      const fy = Math.min(Q - 1.001, Math.max(0, (j + 0.5) / 4 - 0.5)), jy = fy | 0, ty = fy - jy;
      for (let i = 0; i < N; i++, k++) {
        const fx = Math.min(Q - 1.001, Math.max(0, (i + 0.5) / 4 - 0.5)), ix = fx | 0, tx = fx - ix, q = jy * Q + ix;
        M[k * 4 + 1] = D[k] > 250 ? 250 : D[k];
        M[k * 4 + 2] = lerp(lerp(Bn[q], Bn[q + 1], tx), lerp(Bn[q + Q], Bn[q + Q + 1], tx), ty);
      }
    }
    return M;
  }

  // ---------------------------------------------------------------------------
  // Mesh builder
  // ---------------------------------------------------------------------------
  function Builder(withInfo) { this.p = []; this.n = []; this.c = []; this.f = withInfo ? [] : null; this.i = []; this.nv = 0; this.col = [1, 1, 1, 1]; this.inf = [7, 0, 0, 0]; this.u = 0; }
  Builder.prototype.rgb = function (r, g, b, a) { this.col = [r, g, b, a === undefined ? 1 : a]; return this; };
  Builder.prototype.info = function (bi, kind, th) { this.inf = [bi, kind, th || 0, 0]; return this; };
  Builder.prototype.v = function (x, y, z, nx, ny, nz) {
    this.p.push(x, y, z); this.n.push(nx, ny, nz); const c = this.col; this.c.push(c[0], c[1], c[2], c[3]);
    if (this.f) { const f = this.inf; this.f.push(f[0], f[1], f[2], this.u); }
    return this.nv++;
  };
  Builder.prototype.tri = function (a, b, c) {              // auto-oriented to agree with the vertex normals
    const p = this.p, n = this.n;
    const ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2];
    const e1x = p[b * 3] - ax, e1y = p[b * 3 + 1] - ay, e1z = p[b * 3 + 2] - az, e2x = p[c * 3] - ax, e2y = p[c * 3 + 1] - ay, e2z = p[c * 3 + 2] - az;
    const fx = e1y * e2z - e1z * e2y, fy = e1z * e2x - e1x * e2z, fz = e1x * e2y - e1y * e2x;
    if (fx * fx + fy * fy + fz * fz < 1e-14) return;
    const d = fx * (n[a * 3] + n[b * 3] + n[c * 3]) + fy * (n[a * 3 + 1] + n[b * 3 + 1] + n[c * 3 + 1]) + fz * (n[a * 3 + 2] + n[b * 3 + 2] + n[c * 3 + 2]);
    if (d < 0) this.i.push(a, c, b); else this.i.push(a, b, c);
  };
  Builder.prototype.quad = function (a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); };
  Builder.prototype.finish = function () {
    const col = new Uint8Array(this.c.length);
    for (let i = 0; i < col.length; i++) { const v = this.c[i]; col[i] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255); }
    return { pos: new Float32Array(this.p), nrm: new Float32Array(this.n), col, info: this.f ? new Float32Array(this.f) : null, idx: new Uint32Array(this.i), nv: this.nv };
  };
  // lathe: prof = [[r, y], ...] traced bottom->top along the outside (each segment gets its own facet normal)
  function lathe(B, cx, cy, cz, prof, segs) {
    for (let s = 0; s < prof.length - 1; s++) {
      const r0 = prof[s][0], y0 = prof[s][1], r1 = prof[s + 1][0], y1 = prof[s + 1][1];
      let nr = y1 - y0, ny = -(r1 - r0); const l = Math.hypot(nr, ny); if (l < 1e-6) continue; nr /= l; ny /= l;
      const base = B.nv;
      for (let k = 0; k <= segs; k++) {
        const a = (k / segs) * 6.2831853, c = Math.cos(a), sn = Math.sin(a);
        B.u = a * (r0 + r1) * 0.5;
        B.v(cx + r0 * c, cy + y0, cz + r0 * sn, nr * c, ny, nr * sn); B.v(cx + r1 * c, cy + y1, cz + r1 * sn, nr * c, ny, nr * sn);
      }
      for (let k = 0; k < segs; k++) { const a = base + k * 2; B.quad(a, a + 1, a + 3, a + 2); }
    }
    B.u = 0;
  }
  function boxV(B, cx, cy, cz, X, Y, Z) {
    const ax = [X, Y, Z];
    for (let f = 0; f < 6; f++) {
      const a = ax[f >> 1], s = f & 1 ? -1 : 1, u = ax[((f >> 1) + 1) % 3], v = ax[((f >> 1) + 2) % 3];
      const l = Math.hypot(a[0], a[1], a[2]) || 1, nx = s * a[0] / l, ny = s * a[1] / l, nz = s * a[2] / l;
      const px = cx + s * a[0], py = cy + s * a[1], pz = cz + s * a[2];
      const hu = Math.hypot(u[0], u[2]), hv = Math.hypot(v[0], v[2]), uo = (cx + cz) * 0.37;
      B.u = uo - hu - hv; const i0 = B.v(px - u[0] - v[0], py - u[1] - v[1], pz - u[2] - v[2], nx, ny, nz);
      B.u = uo + hu - hv; B.v(px + u[0] - v[0], py + u[1] - v[1], pz + u[2] - v[2], nx, ny, nz);
      B.u = uo + hu + hv; B.v(px + u[0] + v[0], py + u[1] + v[1], pz + u[2] + v[2], nx, ny, nz);
      B.u = uo - hu + hv; B.v(px - u[0] + v[0], py - u[1] + v[1], pz - u[2] + v[2], nx, ny, nz);
      B.quad(i0, i0 + 1, i0 + 2, i0 + 3);
    }
    B.u = 0;
  }
  // win = [panesX, panesY]: window quad, pane coordinates ride in the vertex colour
  function quadV(B, cx, cy, cz, U, V, N, win) {
    const sv = B.col, C = (a, b) => { if (win) B.col = [a, b, win[0] / 8, win[1] / 8]; };
    C(0, 0); const i0 = B.v(cx - U[0] - V[0], cy - U[1] - V[1], cz - U[2] - V[2], N[0], N[1], N[2]);
    C(1, 0); B.v(cx + U[0] - V[0], cy + U[1] - V[1], cz + U[2] - V[2], N[0], N[1], N[2]);
    C(1, 1); B.v(cx + U[0] + V[0], cy + U[1] + V[1], cz + U[2] + V[2], N[0], N[1], N[2]);
    C(0, 1); B.v(cx - U[0] + V[0], cy - U[1] + V[1], cz - U[2] + V[2], N[0], N[1], N[2]);
    B.col = sv;
    B.quad(i0, i0 + 1, i0 + 2, i0 + 3);
  }
  const sc3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  // closed-ish tube through ring centres; pts = nr*segs*3, cen = nr*3; colFn sets B.col per vertex
  function tubeMesh(B, cen, pts, nr, segs, colFn) {
    const base = B.nv;
    for (let j = 0; j < nr; j++) for (let k = 0; k < segs; k++) {
      const q = (j * segs + k) * 3, k1 = (j * segs + ((k + 1) % segs)) * 3, k0 = (j * segs + ((k + segs - 1) % segs)) * 3;
      const j1 = (Math.min(nr - 1, j + 1) * segs + k) * 3, j0 = (Math.max(0, j - 1) * segs + k) * 3;
      const ux = pts[k1] - pts[k0], uy = pts[k1 + 1] - pts[k0 + 1], uz = pts[k1 + 2] - pts[k0 + 2];
      const vx = pts[j1] - pts[j0], vy = pts[j1 + 1] - pts[j0 + 1], vz = pts[j1 + 2] - pts[j0 + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const ox = pts[q] - cen[j * 3], oy = pts[q + 1] - cen[j * 3 + 1], oz = pts[q + 2] - cen[j * 3 + 2];
      let l = Math.hypot(nx, ny, nz);
      if (l < 1e-5) { const jm = Math.max(1, j); nx = cen[jm * 3] - cen[jm * 3 - 3]; ny = cen[jm * 3 + 1] - cen[jm * 3 - 2]; nz = cen[jm * 3 + 2] - cen[jm * 3 - 1]; l = Math.hypot(nx, ny, nz) || 1; }
      else if (nx * ox + ny * oy + nz * oz < 0) { nx = -nx; ny = -ny; nz = -nz; }
      nx /= l; ny /= l; nz /= l;
      colFn(j, k, pts[q], pts[q + 1], pts[q + 2], nx, ny, nz);
      B.v(pts[q], pts[q + 1], pts[q + 2], nx, ny, nz);
    }
    for (let j = 0; j < nr - 1; j++) for (let k = 0; k < segs; k++) {
      const a = base + j * segs + k, b = base + j * segs + ((k + 1) % segs);
      B.quad(a, b, b + segs, a + segs);
    }
  }

  // ---------------------------------------------------------------------------
  // Rendered ground. The collision grid G is never altered; above the tide line the DRAWN surface
  // gains rock character (cliff bands, ribs and gullies, tors). RG = rendered height on the 2 m grid.
  // ---------------------------------------------------------------------------
  let RG = null;
  function rAt(x, z) {
    if (!RG) return heightAt(x, z);
    let fx = (x + HALF) * 0.5 - 0.5, fz = (z + HALF) * 0.5 - 0.5;
    if (fx < 0) fx = 0; else if (fx > GN - 1.001) fx = GN - 1.001;
    if (fz < 0) fz = 0; else if (fz > GN - 1.001) fz = GN - 1.001;
    const ix = fx | 0, iz = fz | 0, tx = fx - ix, tz = fz - iz, k = iz * GN + ix;
    const a = RG[k], b = RG[k + 1], c = RG[k + GN], d = RG[k + GN + 1];
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
  }
  let _u = 0, _rk = 0;                              // bed coordinate + rockiness of the last renderH() call
  function torH(I, x, z) {
    const C = 30, ci = Math.floor(x / C), cj = Math.floor(z / C), s = I.s;
    if (TW.hash2(ci, cj, s + 41) > I.torP) return 0;
    const tx = (ci + 0.3 + 0.4 * TW.hash2(ci, cj, s + 42)) * C, tz = (cj + 0.3 + 0.4 * TW.hash2(ci, cj, s + 43)) * C;
    const tr = 3.5 + 4.5 * TW.hash2(ci, cj, s + 44), el = 0.55 + 0.9 * TW.hash2(ci, cj, s + 48), ta = TW.hash2(ci, cj, s + 49) * 3.14, ca = Math.cos(ta), sa = Math.sin(ta);
    const ex = x - tx, ez = z - tz, dx = (ex * ca + ez * sa) * el, dz = (ez * ca - ex * sa) / el, d2 = dx * dx + dz * dz;
    if (d2 > tr * tr * 1.7 || heightAt(tx, tz) < I.torMin) return 0;
    const d = (Math.sqrt(d2) / tr) * (0.8 + 0.4 * TW.noise2(x / 3.3, z / 3.3, s + 46));
    const hh = TW.hash2(ci, cj, s + 45);
    return (2.5 + 12 * hh * hh) * I.torS * (1 - sstep(0.5, 1.0, d)) * (0.7 + 0.3 * TW.noise2(x / 5, z / 5, s + 47));
  }
  // Basse-Terre only: the collision grid's 13 m terraces are melted on the upper peak (render only; G is untouched)
  let GS = null, GSr = null;
  function softG(I, x, z, g) {
    if (!I.heart || !GS || g < 16) return g;
    const r = GSr, w = r[2] - r[0] + 1, fx = (x + HALF) / CELL - 0.5 - r[0], fz = (z + HALF) / CELL - 0.5 - r[1];
    const i = Math.max(0, Math.min(w - 2, Math.floor(fx))), j = Math.max(0, Math.min(r[3] - r[1] - 1, Math.floor(fz)));
    const tx = clamp(fx - i, 0, 1), tz = clamp(fz - j, 0, 1), k = j * w + i;
    const b = lerp(lerp(GS[k], GS[k + 1], tx), lerp(GS[k + w], GS[k + w + 1], tx), tz);
    const ex = x - I.lh[0], ez = z - I.lh[1];
    return lerp(g, b, 0.9 * sstep(16, 38, g) * sstep(15, 27, Math.sqrt(ex * ex + ez * ez)));
  }
  function renderH(I, x, z, g) {
    const s = I.s, dx = x - I.x, dz = z - I.z, st = I.cstep;
    g = softG(I, x, z, g);
    const dp = dx * I.dip[0] + dz * I.dip[1] + (TW.noise2(x / 45, z / 45, s + 33) - 0.5) * st * 1.5
      + (I.heart ? (TW.noise2(x / 13, z / 13, s + 57) - 0.5) * st * 1.7 + (TW.noise2(x / 5, z / 5, s + 59) - 0.5) * st * 0.6 : 0);   // no level rings
    const u = (g + dp) / st;
    _u = u; _rk = 0;
    if (g < 1.2) return g;
    let f = sstep(1.2, 6, g);
    for (let i = 0; i < I.masks.length; i++) { const m = I.masks[i], ex = x - m[0], ez = z - m[1], d2 = ex * ex + ez * ez; if (d2 < (m[3] + 3) * (m[3] + 3)) f *= sstep(m[2], m[3], Math.sqrt(d2) + (TW.noise2(x / 5.5, z / 5.5, s + 51) - 0.5) * 5); }   // ragged edge
    const rock = clamp((TW.fbm2(x / 105, z / 105, 2, s + 31) - 0.5) * 1.8 + I.rocky, 0.06, 0.78);
    _rk = rock * (0.2 + 0.8 * Math.min(1, f / sstep(1.2, 6, g)));
    if (f <= 0) return g;
    const fl = Math.floor(u);
    let h = lerp(g, (fl + sstep(0.70, 0.94, u - fl)) * st - dp, I.band * rock);              // ledge, then a wall
    h += I.rib * (TW.ridged2(x / 36, z / 36, 3, s + 35) - 0.32) * (0.22 + 0.42 * rock);    // broad, soft ribs and gullies
    h += torH(I, x, z);
    h += (TW.noise2(x / 8, z / 8, s + 37) - 0.5) * 0.48 * rock;
    h = g + (h - g) * f;
    return h < g * 0.4 ? g * 0.4 : h;
  }
  // Shadow-horizon sweep: for every cell the height above which a point is lit from direction L
  // (upstream terrain only, so a surface never shadows itself). Written into channel ch of out (stride 2).
  function sweepShadow(L, out, ch) {
    const N = GN, zdom = Math.abs(L[2]) >= Math.abs(L[0]), major = zdom ? L[2] : L[0], minor = zdom ? L[0] : L[2];
    const sh = minor / Math.abs(major), as = Math.abs(sh), dn = sh >= 0 ? 1 : -1;
    const drop = (L[1] / Math.hypot(L[0], L[2])) * CELL * Math.hypot(1, sh);
    let prev = new Float32Array(N), cur = new Float32Array(N);
    const a0 = major < 0 ? 0 : N - 1, step = major < 0 ? 1 : -1;      // start on the light side, walk away from it
    for (let n = 0, a = a0; n < N; n++, a += step) {
      for (let b = 0; b < N; b++) {
        const k = zdom ? a * N + b : b * N + a, r = RG[k];
        if (n === 0) { out[k * 2 + ch] = -200; cur[b] = r; continue; }
        let b2 = b + dn; if (b2 < 0) b2 = 0; else if (b2 >= N) b2 = N - 1;
        const up = prev[b] + (prev[b2] - prev[b]) * as - drop;
        out[k * 2 + ch] = up; cur[b] = r > up ? r : up;
      }
      const t = prev; prev = cur; cur = t;
    }
  }
  function buildShadowMap(q) {
    const full = new Float32Array(GN * GN * 2);
    sweepShadow(MOON, full, 0); sweepShadow(SUN, full, 1);
    { const N = GN, tmp = new Float32Array(N * 2), st = N * 2, col = new Float32Array(N);
      let i0 = N, i1 = 0, j0 = N, j1 = 0;
      ISLES.forEach((I) => { const r = I.rect; i0 = Math.min(i0, r[0]); j0 = Math.min(j0, r[1]); i1 = Math.max(i1, r[2]); j1 = Math.max(j1, r[3]); });
      i0 = Math.max(2, i0 - 160); j0 = Math.max(2, j0 - 160); i1 = Math.min(N - 3, i1 + 160); j1 = Math.min(N - 3, j1 + 160);
      for (let j = j0; j <= j1; j++) { const o = j * st; for (let i = i0 * 2; i <= i1 * 2 + 1; i++) tmp[i] = (full[o + i - 2] + 2 * full[o + i] + full[o + i + 2]) * 0.25; for (let i = i0 * 2; i <= i1 * 2 + 1; i++) full[o + i] = tmp[i]; }
      for (let c = i0 * 2; c <= i1 * 2 + 1; c++) { for (let j = j0; j <= j1; j++) col[j] = (full[(j - 1) * st + c] + 2 * full[j * st + c] + full[(j + 1) * st + c]) * 0.25; for (let j = j0; j <= j1; j++) full[j * st + c] = col[j]; } }
    if (q > 0) return { data: full, n: GN };
    const n = GN >> 1, half = new Float32Array(n * n * 2);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const k = (j * 2 * GN + i * 2) * 2, o = (j * n + i) * 2; half[o] = Math.max(full[k], full[k + 2], full[k + GN * 2], full[k + GN * 2 + 2]); half[o + 1] = Math.max(full[k + 1], full[k + 3], full[k + GN * 2 + 1], full[k + GN * 2 + 3]); }
    return { data: half, n };
  }

  // ---------------------------------------------------------------------------
  // Terrain (+ rocks + boulders + arch) mesh.
  // colour = (AO, cavity, scree, guano); bed = (bedding coordinate, rockiness)
  // ---------------------------------------------------------------------------
  function buildTerrain(gen, stride) {
    const B = new Builder(false), bed = [];
    let cu = 0, crk = 1;
    { const v0 = B.v.bind(B); B.v = (x, y, z, nx, ny, nz) => { bed.push(cu, crk); return v0(x, y, z, nx, ny, nz); }; }
    const ROCKY = { 3: 0.74, 5: 0.65, 7: 0.75, 9: 0.8, 13: 0.95, 17: 2.0 };
    const UB = new Float32Array(GN * GN), RK = new Uint8Array(GN * GN);
    RG = new Float32Array(G);
    // --- rendered heights on the grid ---
    ISLES.forEach((I) => {
      I.cstep = Math.max(4.5, Math.min(9, (I.step || 6) * 0.7));
      // Signature paysagere par ile : roche rare dans les interieurs, relief
      // volcanique plus marque a Basse-Terre, falaises cotieres conservees.
      const terrainStyle = {
        'Grande-Terre': { rocky: 0.20, rib: 0.65, band: 0.10 },
        'La Désirade': { rocky: 0.34, rib: 0.90, band: 0.16 },
        'Marie-Galante': { rocky: 0.16, rib: 0.48, band: 0.08 },
        'Terre-de-Haut': { rocky: 0.24, rib: 0.72, band: 0.12 },
        'Terre-de-Bas': { rocky: 0.22, rib: 0.68, band: 0.12 },
        'Basse-Terre': { rocky: 0.42, rib: 1.15, band: 0.12 }
      };
      const style = terrainStyle[I.name] || { rocky: 0.24, rib: 0.68, band: 0.12 };
      I.rocky = style.rocky; I.rib = style.rib; I.band = style.band;
      I.torP = I.skerry ? 0.35 : 0.46; I.torS = Math.min(1, I.top[2] / 45); I.torMin = I.top[2] * 0.4;
      I.masks = [];
      if (I.lh) I.masks.push([I.lh[0], I.lh[1], I.heart ? 11 : 15.5, I.heart ? 17 : 22]);
      if (I.village) I.masks.push([I.village[0], I.village[1], 14, 20]);
      if (I.shore) I.masks.push([I.shore[0], I.shore[1], 9, 16]);
      const r = I.rect;
      if (I.heart) {                                   // blurred copy of the collision heights (two 7-wide box passes)
        const w = r[2] - r[0] + 1, hh = r[3] - r[1] + 1; let a = new Float32Array(w * hh), b = new Float32Array(w * hh);
        for (let j = 0; j < hh; j++) for (let i = 0; i < w; i++) a[j * w + i] = G[(j + r[1]) * GN + i + r[0]];
        for (let pass = 0; pass < 2; pass++) {
          for (let j = 0; j < hh; j++) for (let i = 0; i < w; i++) { let t = 0; for (let o = -3; o <= 3; o++) t += a[j * w + Math.max(0, Math.min(w - 1, i + o))]; b[j * w + i] = t / 7; }
          for (let j = 0; j < hh; j++) for (let i = 0; i < w; i++) { let t = 0; for (let o = -3; o <= 3; o++) t += b[Math.max(0, Math.min(hh - 1, j + o)) * w + i]; a[j * w + i] = t / 7; }
        }
        GS = a; GSr = r;
      }
      for (let j = r[1]; j <= r[3]; j++) for (let i = r[0]; i <= r[2]; i++) {
        const k = j * GN + i, g = G[k]; if (g < -3.6) continue;
        RG[k] = renderH(I, (i + 0.5) * CELL - HALF, (j + 0.5) * CELL - HALF, g); UB[k] = _u; RK[k] = Math.round(_rk * 255);
      }
    });
    // --- per-vertex baked terms ---
    const AO_R = [2, 5, 11, 22], aoOff = new Int32Array(32), aoLen = new Float32Array(32);
    for (let d = 0; d < 8; d++) for (let r = 0; r < 4; r++) {
      const a = d * 0.7853982, ox = Math.round(Math.cos(a) * AO_R[r]), oz = Math.round(Math.sin(a) * AO_R[r]);
      aoOff[d * 4 + r] = oz * GN + ox; aoLen[d * 4 + r] = Math.hypot(ox, oz) * CELL;
    }
    const bake = (k, h, x, z) => {
      if (h < -1.5) { B.col = [1, 0.5, 0, 0]; return; }
      let occ = 0, up = 0;
      for (let d = 0; d < 8; d++) {
        let mt = 0;
        for (let r = 0; r < 4; r++) { const dh = RG[k + aoOff[d * 4 + r]] - h, t = dh / aoLen[d * 4 + r]; if (t > mt) mt = t; if (r === 1 && dh > up) up = dh; }
        occ += mt / Math.sqrt(1 + mt * mt);
      }
      const gx = (RG[k + 1] - RG[k - 1]) / (2 * CELL), gz = (RG[k + GN] - RG[k - GN]) / (2 * CELL), sl = Math.sqrt(gx * gx + gz * gz);
      const cav = clamp(0.5 - ((RG[k - 1] + RG[k + 1] + RG[k - GN] + RG[k + GN]) * 0.25 - RG[k]) * 0.4, 0, 1);
      const scree = h > 2.5 ? sstep(4, 10, up) * sstep(0.1, 0.3, sl) * (1 - sstep(0.75, 1.2, sl)) : 0;
      const guano = sstep(0.9, 2.0, sl) * sstep(0.5, 0.72, TW.noise2(x / 34, z / 34, 555));
      B.col = [Math.pow(Math.max(0, 1 - occ / 8), 1.4), cav, scree, guano];
    };
    const vid = new Int32Array(GN * GN).fill(-1);
    const vert = (i, j) => {
      const k = j * GN + i; let id = vid[k]; if (id >= 0) return id;
      const x = (i + 0.5) * CELL - HALF, z = (j + 0.5) * CELL - HALF;
      bake(k, RG[k], x, z); cu = UB[k]; crk = RK[k] / 255;
      return (vid[k] = B.v(x, RG[k], z, 0, 0, 0));
    };
    const quad = (a, b, c, d) => {                  // a=(x0,z0) b=(x1,z0) c=(x0,z1) d=(x1,z1); split on the flatter diagonal
      const p = B.p;
      if (Math.abs(p[a * 3 + 1] - p[d * 3 + 1]) < Math.abs(p[b * 3 + 1] - p[c * 3 + 1])) B.i.push(a, c, d, a, d, b); else B.i.push(a, c, b, b, c, d);
    };
    // --- choose the cells to draw, and the craggiest ones to tessellate at 1 m ---
    const cells = [], score = [];
    ISLES.forEach((I, n) => {
      const r = I.rect;
      for (let j = r[1]; j < r[3]; j += stride) for (let i = r[0]; i < r[2]; i += stride) {
        const k = j * GN + i, a = RG[k], b = RG[k + stride], c = RG[k + stride * GN], d = RG[k + stride * GN + stride], m = Math.max(a, b, c, d);
        if (m < -3.5) continue;
        cells.push(k, n); score.push(m > 1.5 ? m - Math.min(a, b, c, d) : 0);
      }
    });
    const fine = new Uint8Array(GN * GN);
    if (stride === 1) {
      const sorted = Float32Array.from(score).sort(), want = Math.min(10000, sorted.length >> 2), thr = Math.max(1.6, sorted[sorted.length - 1 - want]);
      for (let c = 0; c < score.length; c++) if (score[c] >= thr) fine[cells[c * 2]] = 1;
    }
    const fmap = new Map(), KW = GN * 2 + 4;
    const fvert = (I, fi, fj) => {                  // vertex on the half-cell lattice (grid i <-> fi = 2i)
      const key = fj * KW + fi; let id = fmap.get(key); if (id !== undefined) return id;
      const x = (fi * 0.5 + 0.5) * CELL - HALF, z = (fj * 0.5 + 0.5) * CELL - HALF, i = fi >> 1, j = fj >> 1, k = j * GN + i;
      let exact = true, k2 = k;
      if (!(fi & 1)) { exact = fine[k - 1] && fine[k]; k2 = k + GN; } else if (!(fj & 1)) { exact = fine[k - GN] && fine[k]; k2 = k + 1; }
      let h;
      if (exact) { h = renderH(I, x, z, heightAt(x, z)); cu = _u; crk = _rk; }
      else { h = (RG[k] + RG[k2]) * 0.5; cu = (UB[k] + UB[k2]) * 0.5; crk = (RK[k] + RK[k2]) / 510; }   // stays on the coarse edge: no crack
      bake(k, h, x, z);
      id = B.v(x, h, z, 0, 0, 0); fmap.set(key, id); return id;
    };
    for (let c = 0; c < score.length; c++) {
      const k = cells[c * 2], I = ISLES[cells[c * 2 + 1]], i = k % GN, j = (k / GN) | 0;
      if (!fine[k]) {
        const fw = fine[k - 1], fs = fine[k + GN], fe = fine[k + 1], fn = fine[k - GN];
        if (stride !== 1 || !(fw || fs || fe || fn)) { quad(vert(i, j), vert(i + stride, j), vert(i, j + stride), vert(i + stride, j + stride)); continue; }
        // watertight seam: fan from the cell centre through the corners and the neighbours' edge midpoints (no T-junction pinholes)
        const ring = [vert(i, j)];
        if (fw) ring.push(fvert(I, i * 2, j * 2 + 1));
        ring.push(vert(i, j + 1)); if (fs) ring.push(fvert(I, i * 2 + 1, j * 2 + 2));
        ring.push(vert(i + 1, j + 1)); if (fe) ring.push(fvert(I, i * 2 + 2, j * 2 + 1));
        ring.push(vert(i + 1, j)); if (fn) ring.push(fvert(I, i * 2 + 1, j * 2));
        const c = fvert(I, i * 2 + 1, j * 2 + 1);
        for (let q = 0; q < ring.length; q++) B.i.push(c, ring[q], ring[(q + 1) % ring.length]);
        continue;
      }
      const P = [];
      for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) P.push((a & 1) || (b & 1) ? fvert(I, i * 2 + a, j * 2 + b) : vert(i + (a >> 1), j + (b >> 1)));
      quad(P[0], P[1], P[3], P[4]); quad(P[1], P[2], P[4], P[5]); quad(P[3], P[4], P[6], P[7]); quad(P[4], P[5], P[7], P[8]);
    }
    // area-weighted vertex normals for the ground
    {
      const p = B.p, n = B.n, ix = B.i;
      for (let t = 0; t < ix.length; t += 3) {
        const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;
        const e1x = p[b] - p[a], e1y = p[b + 1] - p[a + 1], e1z = p[b + 2] - p[a + 2], e2x = p[c] - p[a], e2y = p[c + 1] - p[a + 1], e2z = p[c + 2] - p[a + 2];
        const fx = e1y * e2z - e1z * e2y, fy = e1z * e2x - e1x * e2z, fz = e1x * e2y - e1y * e2x;
        n[a] += fx; n[a + 1] += fy; n[a + 2] += fz; n[b] += fx; n[b + 1] += fy; n[b + 2] += fz; n[c] += fx; n[c + 1] += fy; n[c + 2] += fz;
      }
      for (let v = 0; v < n.length; v += 3) { const l = Math.hypot(n[v], n[v + 1], n[v + 2]); if (l > 1e-9) { n[v] /= l; n[v + 1] /= l; n[v + 2] /= l; } else n[v + 1] = 1; }
    }
    world._terrainVerts = B.nv;
    crk = 1;
    // --- sea stacks: fluted, ledged, fractured columns ---
    const rockCol = (hTop, seed) => (j, k, x, y, z) => {
      cu = y / 2.3 + seed + 0.25 * TW.hash2(k >> 1, seed | 0, 3);
      B.col = [0.38 + 0.62 * TW.saturate(y / (hTop * 0.7 + 1)), 0.3 + 0.5 * TW.hash2(j, k, 5), 0, sstep(0.4, 0.95, y / hTop)];
    };
    gen.rocks.forEach((q, idx) => {
      if (q.arch) return;
      const segs = 14, nr = 13, base = -5, cen = new Float32Array(nr * 3), pts = new Float32Array(nr * segs * 3);
      const lx = Math.cos(q.la), lz = Math.sin(q.la);
      for (let j = 0; j < nr; j++) {
        const t = j / (nr - 1), y = base + (q.h - base) * Math.pow(t, 0.8), yy = Math.max(0, y / q.h);
        const prof = y <= 0 ? 1 + 0.3 * (-y / 5) : (1 - 0.36 * yy) * Math.sqrt(Math.max(0, 1 - Math.pow(yy, 6)));
        const ln = Math.pow(yy, 1.5) * q.h * 0.32 * q.lean, band = Math.floor(yy * 5 + TW.hash2(idx, 1, 7));
        const ledge = y <= 0 ? 1 : 0.88 + 0.24 * TW.hash2(band, idx, 3);
        cen[j * 3] = q.x + lx * ln; cen[j * 3 + 1] = y; cen[j * 3 + 2] = q.z + lz * ln;
        for (let k = 0; k < segs; k++) {
          const a = (k / segs) * 6.2831853, ca = Math.cos(a), sa = Math.sin(a);
          const plate = y <= 0 ? 1 : 0.90 + 0.2 * TW.hash2(k >> 1, band, idx + 11);
          const rad = j === nr - 1 ? 0 : q.r * prof * ledge * plate * (0.52 + 0.9 * TW.fbm2(ca * 1.1 + idx * 3.7, sa * 1.1 + y * 0.16 + idx * 1.3, 3, 900 + idx));
          const o = (j * segs + k) * 3; pts[o] = cen[j * 3] + ca * rad; pts[o + 1] = y; pts[o + 2] = cen[j * 3 + 2] + sa * rad;
        }
      }
      tubeMesh(B, cen, pts, nr, segs, rockCol(q.h, idx * 1.37));
    });
    // --- shore boulders by each landing (decorative; on land, outside the ring) ---
    {
      const brng = TW.rng(TW.seed * 7 + 41);
      gen.BI.forEach((I) => {
        const J = I.jetty; let made = 0;
        for (let tries = 0; tries < 260 && made < 10; tries++) {
          const a = brng() * 6.2831853, d = 5 + brng() * 48, x = I.shore[0] + Math.cos(a) * d, z = I.shore[1] + Math.sin(a) * d, hc = heightAt(x, z);
          const r = 0.55 + brng() * brng() * 1.5, sx = 0.75 + brng() * 0.6, sz = 0.75 + brng() * 0.6, rot = brng() * 3.14, sd = brng() * 50;
          if (hc < 0.5 || hc > 4.5 || Math.hypot(x - I.dock.x, z - I.dock.z) < 35 || Math.hypot(x - I.lh[0], z - I.lh[1]) < 18) continue;
          const px = x - J.ax, pz = z - J.az; if (px * J.ux + pz * J.uz > -7 && Math.abs(pz * J.ux - px * J.uz) < 4.5) continue;
          if (I.village && Math.hypot(x - I.village[0], z - I.village[1]) < 14) continue;
          const h = rAt(x, z), nr = 5, segs = 7, cen = new Float32Array(nr * 3), pts = new Float32Array(nr * segs * 3), cr = Math.cos(rot), sr = Math.sin(rot);
          for (let j = 0; j < nr; j++) {
            const t = j / (nr - 1), y = h + r * (-0.35 + 1.2 * t), prof = j === nr - 1 ? 0 : Math.pow(Math.cos(t * 1.5707963), 0.6);
            cen[j * 3] = x; cen[j * 3 + 1] = y; cen[j * 3 + 2] = z;
            for (let k = 0; k < segs; k++) {
              const an = (k / segs) * 6.2831853, ca = Math.cos(an), sa = Math.sin(an), rad = r * prof * (0.62 + 0.76 * TW.fbm2(ca * 1.3 + sd, sa * 1.3 + t * 2 + sd, 2, 333));
              const lx = ca * rad * sx, lz = sa * rad * sz, o = (j * segs + k) * 3;
              pts[o] = x + lx * cr - lz * sr; pts[o + 1] = y; pts[o + 2] = z + lx * sr + lz * cr;
            }
          }
          tubeMesh(B, cen, pts, nr, segs, (j, k, vx, vy) => { cu = vy / 1.4 + sd; B.col = [0.5 + 0.5 * TW.saturate((vy - h) / r), 0.4 + 0.3 * TW.hash2(j, k, 11), 0, 0]; });
          made++;
        }
      });
    }
    // --- the Needle's Eye (sea arch) ---
    {
      const A = ARCH, nr = 26, segs = 12, cen = new Float32Array(nr * 3), pts = new Float32Array(nr * segs * 3);
      const dx = A.bx - A.ax, dz = A.bz - A.az, L = Math.hypot(dx, dz), wx = -dz / L, wz = dx / L;
      const cAt = (s) => [A.ax + dx * s, -5 + (A.h + 5 - 3) * Math.pow(Math.sin(Math.PI * clamp(s, 0, 1)), 0.5), A.az + dz * s];
      for (let j = 0; j < nr; j++) {
        const s = j / (nr - 1), c = cAt(s), c0 = cAt(Math.max(0, s - 0.02)), c1 = cAt(Math.min(1, s + 0.02));
        let tx = c1[0] - c0[0], ty = c1[1] - c0[1], tz = c1[2] - c0[2]; const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
        // in-plane normal Q = T x W  (W horizontal, perpendicular to the arch plane)
        const qx = ty * wz - tz * 0, qy = tz * wx - tx * wz, qz = tx * 0 - ty * wx;
        cen[j * 3] = c[0]; cen[j * 3 + 1] = c[1]; cen[j * 3 + 2] = c[2];
        for (let k = 0; k < segs; k++) {
          const a = (k / segs) * 6.2831853, ca = Math.cos(a), sa = Math.sin(a);
          const rad = (3.0 + 3.3 * Math.pow(Math.abs(Math.cos(Math.PI * s)), 1.3)) * (0.78 + 0.46 * TW.fbm2(ca * 1.2 + s * 9, sa * 1.2 + s * 5, 3, 777)) * (0.9 + 0.2 * TW.hash2(k >> 1, j >> 1, 31));
          const o = (j * segs + k) * 3;
          pts[o] = c[0] + (wx * ca + qx * sa) * rad; pts[o + 1] = c[1] + qy * sa * rad; pts[o + 2] = c[2] + (wz * ca + qz * sa) * rad;
        }
      }
      tubeMesh(B, cen, pts, nr, segs, rockCol(A.h, 5.5));
    }
    const out = B.finish(); out.bed = new Float32Array(bed);
    return out;
  }

  // ---------------------------------------------------------------------------
  // Props: lighthouses, cottages, jetties, standing stones, the wreck
  // info = (beacon index, kind, threshold, 0). kind 0 masonry, 1 window, 2 lamp glazing, 3 metal/slate
  // ---------------------------------------------------------------------------
  function ringBar(B, x, y, z, r, yy, w, hgt, segs) { lathe(B, x, y, z, [[r - w, yy], [r + w, yy], [r + w, yy + hgt], [r - w, yy + hgt], [r - w, yy]], segs); }
  // iron lamp post with a square glazed lantern head (glows with the beacon)
  function lampPost(B, bi, x, y, z, th) {
    B.info(bi, 3, 0).rgb(0.03, 0.034, 0.034, 1);
    lathe(B, x, y, z, [[0.17, 0], [0.17, 0.3], [0.10, 0.36], [0.07, 2.5], [0.2, 2.56], [0.2, 2.63]], 8);
    for (let k = 0; k < 4; k++) { const a = k * 1.5707963, c = Math.cos(a), s = Math.sin(a); boxV(B, x + c * 0.205, y + 2.92, z + s * 0.205, [0.024, 0, 0], [c * 0.05, 0.29, s * 0.05], [0, 0, 0.024]); }
    lathe(B, x, y, z, [[0.32, 3.2], [0.32, 3.25], [0.07, 3.52], [0.07, 3.6], [0, 3.7]], 4);
    B.info(bi, 1, th).rgb(0.02, 0.02, 0.03, 1); lathe(B, x, y, z, [[0.15, 2.63], [0.25, 3.2]], 4);
  }
  // dry-stone wall that follows the ground
  function dryWall(B, bi, x0, z0, x1, z1, base) {
    const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(L / 1.5)), ux = (x1 - x0) / L, uz = (z1 - z0) / L;
    for (let i = 0; i < n; i++) {
      const ta = i / n, tb = (i + 1) / n, ha = rAt(lerp(x0, x1, ta), lerp(z0, z1, ta)), hb = rAt(lerp(x0, x1, tb), lerp(z0, z1, tb));
      const mx = lerp(x0, x1, (ta + tb) * 0.5), mz = lerp(z0, z1, (ta + tb) * 0.5), h = (ha + hb) * 0.5;
      if (Math.min(ha, hb) < 0.9 || (base !== undefined && Math.abs(h - base) > 1.6)) continue;
      const hh = 0.9 + 0.12 * TW.hash2(i, (mx * 3) | 0, 9), hl = (L / n) * 0.5 + 0.04;
      B.info(bi, 6, 0).rgb(0.17, 0.165, 0.155, 0.9);
      boxV(B, mx, h + hh - 1.6, mz, [ux * hl, (hb - ha) * 0.5, uz * hl], [0, 1.6, 0], [-uz * 0.24, 0, ux * 0.24]);
    }
  }
  function wallRing(B, bi, cx, cz, r, gateAng, gateHalf, n, base) {
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * 6.2831853, a1 = ((k + 1) / n) * 6.2831853;
      if (Math.abs(TW.wrapAngle((a0 + a1) * 0.5 - gateAng)) < gateHalf) continue;
      dryWall(B, bi, cx + Math.cos(a0) * r, cz + Math.sin(a0) * r, cx + Math.cos(a1) * r, cz + Math.sin(a1) * r, base);
    }
  }
  function faceQ(B, p0, p1, p2, p3, n, u0, u1, u2, u3) {
    const l = Math.hypot(n[0], n[1], n[2]) || 1, nx = n[0] / l, ny = n[1] / l, nz = n[2] / l;
    B.u = u0; const i0 = B.v(p0[0], p0[1], p0[2], nx, ny, nz); B.u = u1; B.v(p1[0], p1[1], p1[2], nx, ny, nz);
    B.u = u2; B.v(p2[0], p2[1], p2[2], nx, ny, nz); B.u = u3; B.v(p3[0], p3[1], p3[2], nx, ny, nz); B.u = 0;
    B.quad(i0, i0 + 1, i0 + 2, i0 + 3);
  }

  function tower(B, bi, x, y, z, T, fa) {
    const segs = T.segs, sg = segs < 12 ? segs : Math.max(segs, 24), H = T.H, rB = T.rB, rT = T.rT, rL = rT * 0.74, gh = T.gh;
    const pale = [0.60, 0.585, 0.55], dark = [0.075, 0.066, 0.07];
    const rad = (t) => rT + (rB - rT) * Math.pow(1 - t, 1.7);
    B.info(bi, 4, 0);
    B.rgb(0.17, 0.165, 0.155, 0.8); lathe(B, x, y, z, [[rB * 1.34, -6], [rB * 1.34, 0.9], [rB * 1.08, 1.5]], sg);
    for (let k = 0; k < T.bands; k++) {
      const t0 = k / T.bands, t1 = (k + 1) / T.bands, y0 = 1.5 + (H - 1.7) * t0, y1 = 1.5 + (H - 1.7) * t1;
      const c = T.pattern[k % T.pattern.length] ? dark : pale;
      B.rgb(c[0], c[1], c[2], 0.82 + 0.18 * t0); lathe(B, x, y, z, [[rad(t0), y0], [rad(t1), y1]], sg);
    }
    // gallery deck on a corbel ring with stone brackets
    B.info(bi, 0, 0).rgb(0.13, 0.125, 0.12, 0.55); lathe(B, x, y, z, [[rT, H - 0.2], [rT * 1.5, H + 0.7]], sg);
    B.rgb(0.19, 0.185, 0.175, 1); lathe(B, x, y, z, [[rT * 1.5, H + 0.7], [rT * 1.62, H + 0.7], [rT * 1.62, H + 1.05], [rL, H + 1.05]], sg);
    const nbk = T.heart ? 16 : 10;
    B.rgb(0.16, 0.155, 0.15, 0.7);
    for (let k = 0; k < nbk; k++) { const a = ((k + 0.5) / nbk) * 6.2831853, c = Math.cos(a), s = Math.sin(a), rr = rT * 1.28; boxV(B, x + c * rr, y + H + 0.22, z + s * rr, [c * rT * 0.27, 0, s * rT * 0.27], [0, 0.42, 0], [-s * 0.11, 0, c * 0.11]); }
    B.info(bi, 4, 0).rgb(0.34, 0.33, 0.30, 0.9); lathe(B, x, y, z, [[rL, H + 1.05], [rL, H + 2.0]], sg);
    // gallery rail: balusters, mid rail, hand rail
    const rg = rT * 1.55, yr = H + 1.05;
    B.info(bi, 3, 0).rgb(0.035, 0.04, 0.04, 1);
    const np = T.heart ? 26 : 16;
    for (let k = 0; k < np; k++) { const a = (k / np) * 6.2831853; boxV(B, x + Math.cos(a) * rg, y + yr + 0.55, z + Math.sin(a) * rg, [0.04, 0, 0], [0, 0.55, 0], [0, 0, 0.04]); }
    ringBar(B, x, y, z, rg, yr + 1.08, 0.06, 0.1, sg); ringBar(B, x, y, z, rg, yr + 0.55, 0.035, 0.06, sg);
    // lantern room: glazing, astragals, cornice, cap, finial
    const g0 = H + 2.0, top = g0 + gh;
    B.info(bi, 2, 0).rgb(0.02, 0.025, 0.03, 1); lathe(B, x, y, z, [[rL * 0.95, g0], [rL * 0.95, top]], Math.max(sg, 16));
    B.info(bi, 3, 0).rgb(0.03, 0.035, 0.035, 1);
    const nm = T.heart ? 12 : 8;
    for (let k = 0; k < nm; k++) { const a = ((k + 0.5) / nm) * 6.2831853, c = Math.cos(a), s = Math.sin(a); boxV(B, x + c * rL * 0.97, y + g0 + gh * 0.5, z + s * rL * 0.97, [c * 0.06, 0, s * 0.06], [0, gh * 0.5, 0], [-s * 0.06, 0, c * 0.06]); }
    ringBar(B, x, y, z, rL * 0.97, g0 + gh * 0.34, 0.045, 0.08, sg); ringBar(B, x, y, z, rL * 0.97, g0 + gh * 0.67, 0.045, 0.08, sg);
    ringBar(B, x, y, z, rL * 0.98, g0 - 0.02, 0.07, 0.14, sg);
    B.rgb(0.045, 0.07, 0.062, 1);
    lathe(B, x, y, z, [[rL * 0.95, top], [rL * 1.16, top], [rL * 1.16, top + 0.3], [rL * 0.55, top + 0.3 + rL * 0.55], [0.16, top + 0.3 + rL * 1.05], [0.16, top + 0.9 + rL * 1.05], [0.34, top + 1.1 + rL * 1.05], [0.34, top + 1.5 + rL * 1.05], [0, top + 2.3 + rL * 1.05]], sg);
    // small-paned windows spiralling up the shaft, each with a stone sill
    for (let k = 0; k < T.win; k++) {
      const t = 0.16 + 0.68 * (k / Math.max(1, T.win - 1)), yy = 1.5 + (H - 1.7) * t, a = fa + (k % 2 ? 0.62 : -0.55) + k * 0.22, c = Math.cos(a), s = Math.sin(a), r = rad(t) + 0.06;
      const wh = T.heart ? 0.95 : 0.68, ww = T.heart ? 0.5 : 0.36;
      B.info(bi, 1, 0.45 + 0.42 * (k / T.win)).rgb(0.02, 0.02, 0.03, 1);
      quadV(B, x + c * r, y + yy, z + s * r, [-s * ww, 0, c * ww], [0, wh, 0], [c, 0, s], [2, 3]);
      B.info(bi, 4, 0).rgb(0.30, 0.29, 0.27, 1);
      boxV(B, x + c * r, y + yy - wh - 0.07, z + s * r, [-s * (ww + 0.12), 0, c * (ww + 0.12)], [0, 0.07, 0], [c * 0.13, 0, s * 0.13]);
      boxV(B, x + c * (r - 0.05), y + yy + wh + 0.09, z + s * (r - 0.05), [-s * (ww + 0.1), 0, c * (ww + 0.1)], [0, 0.09, 0], [c * 0.1, 0, s * 0.1]);
    }
    // doorway toward the landing: stone porch, plank door, steps down the plinth
    {
      const c = Math.cos(fa), s = Math.sin(fa), k = T.heart ? 1.5 : 1, r0 = rB - 0.1;
      B.info(bi, 4, 0).rgb(0.33, 0.32, 0.295, 0.95);
      boxV(B, x + c * r0, y + 1.5 + 1.2 * k, z + s * r0, [-s * 0.85 * k, 0, c * 0.85 * k], [0, 1.25 * k, 0], [c * 0.5, 0, s * 0.5]);
      B.info(bi, 3, 0).rgb(0.05, 0.055, 0.065, 1);
      boxV(B, x + c * r0, y + 1.5 + 2.5 * k, z + s * r0, [-s * 1.0 * k, 0, c * 1.0 * k], [0, 0.08, 0], [c * 0.62, 0, s * 0.62]);
      B.info(bi, 0, 0).rgb(0.045, 0.032, 0.022, 1);
      quadV(B, x + c * (r0 + 0.52), y + 1.5 + 0.98 * k, z + s * (r0 + 0.52), [-s * 0.5 * k, 0, c * 0.5 * k], [0, 0.98 * k, 0], [c, 0, s]);
      B.info(bi, 4, 0).rgb(0.20, 0.195, 0.185, 0.9);
      for (let q = 0; q < 3; q++) { const rr = rB * 1.34 + 0.3 + q * 0.5, hgt = 1.5 - q * 0.5; boxV(B, x + c * rr, y + (hgt - 2) * 0.5, z + s * rr, [-s * 1.0 * k, 0, c * 1.0 * k], [0, (hgt + 2) * 0.5, 0], [c * 0.3, 0, s * 0.3]); }
      if (T.heart) boxV(B, x + c * (rB * 1.34 - 0.6), y + 0.75 - 1, z + s * (rB * 1.34 - 0.6), [-s * 1.5, 0, c * 1.5], [0, 1.75, 0], [c * 1.0, 0, s * 1.0]);
    }
    if (T.heart) {                                                  // octagonal keepers' hall around the foot
      B.info(bi, 4, 0).rgb(0.40, 0.385, 0.35, 0.85); lathe(B, x, y, z, [[10.2, -7], [10.2, 5.4]], 8);
      B.info(bi, 0, 0).rgb(0.16, 0.155, 0.15, 1); lathe(B, x, y, z, [[10.2, 5.4], [10.9, 5.4], [10.9, 5.9]], 8);
      B.info(bi, 5, 0).rgb(0.07, 0.075, 0.09, 1); lathe(B, x, y, z, [[10.9, 5.9], [rad(0.17) + 0.1, 8.6]], 8);
      for (let k = 0; k < 8; k++) {
        const a = ((k + 0.5) / 8) * 6.2831853, c = Math.cos(a), s = Math.sin(a), r = 10.2 * Math.cos(Math.PI / 8) + 0.06;
        if (Math.abs(TW.wrapAngle(a - fa)) < 0.4) continue;
        B.info(bi, 1, 0.12 + 0.05 * ((k * 3) % 8)).rgb(0.02, 0.02, 0.03, 1);
        quadV(B, x + c * r, y + 3.0, z + s * r, [-s * 0.7, 0, c * 0.7], [0, 0.95, 0], [c, 0, s], [3, 3]);
        B.info(bi, 4, 0).rgb(0.30, 0.29, 0.27, 1);
        boxV(B, x + c * r, y + 1.97, z + s * r, [-s * 0.85, 0, c * 0.85], [0, 0.07, 0], [c * 0.12, 0, s * 0.12]);
      }
    }
  }
  function cottage(B, bi, x, y, z, yaw, w, d, hw, ths) {
    const X = [Math.cos(yaw), 0, Math.sin(yaw)], Z = [-Math.sin(yaw), 0, Math.cos(yaw)];
    const P = (lx, ly, lz) => [x + X[0] * lx + Z[0] * lz, y + ly, z + X[2] * lx + Z[2] * lz];
    const bx = (lx, ly, lz, hx, hy, hz) => { const c = P(lx, ly, lz); boxV(B, c[0], c[1], c[2], sc3(X, hx), [0, hy, 0], sc3(Z, hz)); };
    B.info(bi, 4, 0).rgb(0.40, 0.385, 0.35, 0.92);
    boxV(B, x, y + (hw - 2.5) * 0.5, z, sc3(X, w * 0.5), [0, (hw + 2.5) * 0.5, 0], sc3(Z, d * 0.5));
    const rise = d * 0.5, xe = w * 0.5 + 0.38, ze = d * 0.5 + 0.45, yR = hw + rise, yE = hw - rise * (ze - d * 0.5) / (d * 0.5);
    for (let s = -1; s <= 1; s += 2) {                               // gable ends
      const n = sc3(X, s), a = P(s * w * 0.5, hw, -d * 0.5), b = P(s * w * 0.5, hw, d * 0.5), c = P(s * w * 0.5, yR - 0.06, 0);
      B.u = -d * 0.5; const i0 = B.v(a[0], a[1], a[2], n[0], n[1], n[2]); B.u = d * 0.5; B.v(b[0], b[1], b[2], n[0], n[1], n[2]); B.u = 0; B.v(c[0], c[1], c[2], n[0], n[1], n[2]); B.tri(i0, i0 + 1, i0 + 2);
    }
    for (let s = -1; s <= 1; s += 2) {                               // slate roof slopes with open eaves (top + soffit)
      const n = [Z[0] * s * rise, d * 0.5, Z[2] * s * rise];
      const a = P(-xe, yE, s * ze), b = P(xe, yE, s * ze), c = P(xe, yR, 0), e = P(-xe, yR, 0);
      B.info(bi, 5, 0).rgb(0.075, 0.08, 0.095, 1); faceQ(B, a, b, c, e, n, -xe, xe, xe, -xe);
      const dn = (p) => [p[0], p[1] - 0.12, p[2]];
      B.info(bi, 0, 0).rgb(0.05, 0.045, 0.04, 0.7); faceQ(B, dn(a), dn(b), dn(c), dn(e), [-n[0], -n[1], -n[2]], 0, 0, 0, 0);
      bx(0, yE - 0.02, s * ze, xe, 0.07, 0.05);                      // fascia / gutter
    }
    B.info(bi, 3, 0).rgb(0.05, 0.055, 0.06, 1); bx(0, yR + 0.02, 0, xe + 0.02, 0.08, 0.16);   // ridge
    // chimney stack, cap and pot on the gable
    B.info(bi, 4, 0).rgb(0.30, 0.29, 0.27, 1); bx(w * 0.5 - 0.5, yR + 0.1, 0, 0.4, 0.95, 0.4);
    B.info(bi, 0, 0).rgb(0.17, 0.165, 0.16, 1); bx(w * 0.5 - 0.5, yR + 1.1, 0, 0.5, 0.07, 0.5);
    { const c = P(w * 0.5 - 0.5, yR + 1.17, 0); B.rgb(0.26, 0.12, 0.07, 1); lathe(B, c[0], c[1], c[2], [[0.16, 0], [0.13, 0.38], [0.09, 0.38]], 7); }
    // small-paned windows with sills (front and gable), plank door with lintel and step
    const wins = [[-w * 0.28, 1.62, d * 0.5 + 0.05, 0], [w * 0.28, 1.62, d * 0.5 + 0.05, 0], [-w * 0.5 - 0.05, 1.7, 0, 1]];
    wins.forEach((q, i) => {
      const c = P(q[0], q[1], q[2]); B.info(bi, 1, ths[i % ths.length]).rgb(0.02, 0.02, 0.03, 1);
      if (q[3]) quadV(B, c[0], c[1], c[2], sc3(Z, 0.52), [0, 0.58, 0], sc3(X, -1), [3, 2]); else quadV(B, c[0], c[1], c[2], sc3(X, 0.56), [0, 0.58, 0], Z, [3, 2]);
      B.info(bi, 4, 0).rgb(0.30, 0.29, 0.27, 1);
      if (q[3]) bx(q[0] - 0.03, q[1] - 0.66, 0, 0.1, 0.06, 0.66); else bx(q[0], q[1] - 0.66, q[2] + 0.03, 0.68, 0.06, 0.1);
    });
    { const c = P(0, 0.98, d * 0.5 + 0.05); B.info(bi, 0, 0).rgb(0.05, 0.035, 0.024, 1); quadV(B, c[0], c[1], c[2], sc3(X, 0.48), [0, 0.98, 0], Z); }
    B.info(bi, 4, 0).rgb(0.30, 0.29, 0.27, 1); bx(0, 2.08, d * 0.5 + 0.04, 0.66, 0.12, 0.09); bx(0, 0.02, d * 0.5 + 0.42, 0.7, 0.12, 0.34);
  }

  // little stone quay: battered coursed walls, capstones, steps to the water, bollards, rings, two lanterns
  const quayLamps = [];
  function quay(B, bi, J) {
    const L = Math.hypot(J.bx - J.ax, J.bz - J.az), tx = J.ux, tz = J.uz, nx = -J.uz, nz = J.ux, top = 2.05, yb = -5, wt = 1.72, wb = 2.35;
    const at = (al, lat, yy) => [J.ax + tx * al + nx * lat, yy, J.az + tz * al + nz * lat];
    B.info(bi, 4, 0).rgb(0.215, 0.21, 0.20, 0.9);
    for (let s = -1; s <= 1; s += 2) faceQ(B, at(0, s * wt, top), at(L, s * wt, top), at(L + 0.6, s * wb, yb), at(0, s * wb, yb), [nx * s * (top - yb), wb - wt, nz * s * (top - yb)], 0, L, L + 0.6, 0);
    faceQ(B, at(L, -wt, top), at(L, wt, top), at(L + 0.6, wb, yb), at(L + 0.6, -wb, yb), [tx * (top - yb), 0.6, tz * (top - yb)], -wt, wt, wb, -wb);
    faceQ(B, at(0, -wt, top), at(0, wt, top), at(0, wb, yb), at(0, -wb, yb), [-tx, 0, -tz], -wt, wt, wb, -wb);
    B.rgb(0.27, 0.26, 0.245, 1);
    { const c = at(L * 0.5, 0, top + 0.12); boxV(B, c[0], c[1], c[2], [tx * (L * 0.5 + 0.14), 0, tz * (L * 0.5 + 0.14)], [0, 0.12, 0], [nx * 1.9, 0, nz * 1.9]); }
    const cap = top + 0.24;
    // steps down to the water on one side, near the head
    B.rgb(0.20, 0.195, 0.185, 0.85);
    for (let k = 0; k < 6; k++) { const yt = top - (k + 1) * 0.42, c = at(L * 0.48 + k * 0.62, wt + 0.6, (yt - 4) * 0.5); boxV(B, c[0], c[1], c[2], [tx * 0.31, 0, tz * 0.31], [0, (yt + 4) * 0.5, 0], [nx * 0.62, 0, nz * 0.62]); }
    // iron bollards and mooring rings
    B.info(bi, 3, 0).rgb(0.035, 0.036, 0.04, 1);
    [[0.62, -1.3], [0.93, 1.25], [0.93, -1.25]].forEach((q) => { const c = at(L * q[0], q[1], cap); lathe(B, c[0], c[1], c[2], [[0.21, 0], [0.21, 0.1], [0.14, 0.15], [0.14, 0.5], [0.25, 0.57], [0.25, 0.7], [0.1, 0.77], [0, 0.77]], 8); });
    [[0.3, -1.45], [0.78, -1.5]].forEach((q) => { const c = at(L * q[0], q[1], cap), rr = []; for (let k = 0; k <= 6; k++) { const a = (k / 6) * 6.2831853; rr.push([0.2 + Math.cos(a) * 0.04, 0.04 + Math.sin(a) * 0.04]); } lathe(B, c[0], c[1], c[2], rr, 10); });
    { const c = at(L * 0.42, 1.4, cap); lampPost(B, bi, c[0], c[1], c[2], 0.03); quayLamps.push(c[0], c[1] + 2.9, c[2], bi); }
    { const c = at(L - 0.7, -1.35 + 2.7 * 0, cap); lampPost(B, bi, c[0], c[1], c[2], 0.08); quayLamps.push(c[0], c[1] + 2.9, c[2], bi); }
  }

  function buildProps(gen) {
    quayLamps.length = 0;
    const B = new Builder(true), rng = TW.rng(TW.seed * 13 + 9);
    gen.BI.forEach((I, bi) => {
      const fa = Math.atan2(I.dock.z - I.lh[1], I.dock.x - I.lh[0]);
      tower(B, bi, I.lh[0], I.padH, I.lh[1], I.tw, fa);
      const px = -Math.sin(fa), pz = Math.cos(fa), yaw = fa - Math.PI / 2;
      if (!I.heart) {
        const sgn = bi % 2 ? 1 : -1;
        cottage(B, bi, I.lh[0] + px * 10.2 * sgn - Math.cos(fa) * 1.5, I.padH, I.lh[1] + pz * 10.2 * sgn - Math.sin(fa) * 1.5, yaw, 7.2, 4.6, 3.0, [0.10, 0.22, 0.34]);
        if (bi === 1 || bi === 3) cottage(B, bi, I.lh[0] - px * 9.6 * sgn - Math.cos(fa) * 2.5, I.padH, I.lh[1] - pz * 9.6 * sgn - Math.sin(fa) * 2.5, yaw + 1.5708, 4.6, 3.6, 2.5, [0.28, 0.4, 0.4]);
        wallRing(B, bi, I.lh[0], I.lh[1], 14.8, fa, 0.24, 31);
      } else {
        const J = I.jetty, ja = Math.atan2(J.uz, J.ux), jy = ja - Math.PI / 2, qx = -J.uz, qz = J.ux;
        cottage(B, bi, I.village[0] + qx * 5.6, 5, I.village[1] + qz * 5.6, jy, 7.4, 4.8, 3.1, [0.06, 0.10, 0.16]);
        cottage(B, bi, I.village[0] - qx * 5.2 - J.ux * 2, 5, I.village[1] - qz * 5.2 - J.uz * 2, jy + 0.5, 6.0, 4.4, 2.8, [0.08, 0.14, 0.2]);
        wallRing(B, bi, I.village[0], I.village[1], 12.5, ja, 0.4, 26, 5);
      }
      quay(B, bi, I.jetty);
    });
    // standing stones on the crown of Grande-Terre
    {
      const I = ISLES[0], cx = I.top[0], cz = I.top[1];
      B.info(7, 0, 0);
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * 6.2831853 + 0.3, x = cx + Math.cos(a) * 7.5, z = cz + Math.sin(a) * 7.5, y = rAt(x, z);
        const hgt = 1.3 + rng() * 1.1, yaw = a + 1.57 + (rng() - 0.5) * 0.6, tx = (rng() - 0.5) * 0.3, tz = (rng() - 0.5) * 0.3;
        B.rgb(0.10, 0.10, 0.105, 0.9);
        boxV(B, x + tx * hgt, y + hgt - 0.6, z + tz * hgt, [Math.cos(yaw) * 0.6, 0, Math.sin(yaw) * 0.6], [tx * hgt, hgt, tz * hgt], [-Math.sin(yaw) * 0.26, 0, Math.cos(yaw) * 0.26]);
      }
    }
    // the wreck: ribs of a hull on the Hag Stones shoal
    {
      const I = ISLES[8]; let wx = 0, wz = 0, found = false;
      for (let d = 8; d < 80 && !found; d += 2) for (let a = 0; a < 6.28 && !found; a += 0.35) {
        const x = I.x + Math.cos(a + 1.0) * d, z = I.z + Math.sin(a + 1.0) * d, h = heightAt(x, z);
        if (h < -0.5 && h > -1.3 && heightAt(x + 6, z) < 0 && heightAt(x - 6, z) < 0) { wx = x; wz = z; found = true; }
      }
      if (found) {
        const yaw = 0.7, roll = 0.33, cy = Math.cos(yaw), sy = Math.sin(yaw), cr = Math.cos(roll), sr = Math.sin(roll), S = 1.5;
        // local (x along keel, y up, z abeam) -> world, heeled over
        const xf = (lx, ly, lz) => { const y2 = ly * cr - lz * sr, z2 = ly * sr + lz * cr; return [(lx * cy - z2 * sy) * S, y2 * S, (lx * sy + z2 * cy) * S]; };
        const seg = (a, b, th) => {
          const A = xf(a[0], a[1], a[2]), Bp = xf(b[0], b[1], b[2]), hx = (Bp[0] - A[0]) * 0.5, hy = (Bp[1] - A[1]) * 0.5, hz = (Bp[2] - A[2]) * 0.5;
          const l = Math.hypot(hx, hy, hz) || 1; let ux = hy * 0 - hz * 1, uy = hz * 0 - hx * 0, uz = hx * 1 - hy * 0;   // h x (0,1,0)
          let ul = Math.hypot(ux, uy, uz); if (ul < 1e-4) { ux = 1; uy = 0; uz = 0; ul = 1; }
          ux /= ul; uy /= ul; uz /= ul;
          const vx = (hy * uz - hz * uy) / l, vy = (hz * ux - hx * uz) / l, vz = (hx * uy - hy * ux) / l;
          boxV(B, wx + A[0] + hx, -1.0 + A[1] + hy, wz + A[2] + hz, [ux * th, uy * th, uz * th], [hx, hy, hz], [vx * th, vy * th, vz * th]);
        };
        B.info(7, 0, 0).rgb(0.05, 0.04, 0.032, 0.8);
        seg([-6.5, 0.1, 0], [6.5, 0, 0], 0.2); seg([6.3, 0, 0], [7.9, 2.9, 0], 0.18); seg([-6.4, 0.1, 0], [-7.2, 2.2, 0], 0.18);
        const rib = [[0, 0], [0.95, 0.22], [1.7, 0.9], [2.05, 1.85], [2.0, 2.75]];
        for (let s = -4; s <= 4; s++) for (let side = -1; side <= 1; side += 2) {
          if (rng() < 0.18) continue;
          const sc = 1 - 0.035 * s * s, cut = rng() < 0.3 ? 3 : 4;
          for (let q = 0; q < cut; q++) seg([s * 1.4, rib[q][1] * sc, side * rib[q][0] * sc], [s * 1.4, rib[q + 1][1] * sc, side * rib[q + 1][0] * sc], 0.085);
        }
      }
      world._wreck = found ? [wx, wz] : null;
    }
    return B.finish();
  }

  function buildBuoy() {
    const B = new Builder(true);
    B.rgb(0.045, 0.04, 0.036, 0); lathe(B, 0, 0, 0, [[0, -0.75], [0.7, -0.62], [0.95, -0.15], [0.95, 0.12]], 12);
    B.rgb(0.40, 0.37, 0.31, 0); lathe(B, 0, 0, 0, [[0.95, 0.12], [0.95, 0.36]], 12);                       // pale band above the waterline
    B.rgb(0.045, 0.04, 0.036, 0); lathe(B, 0, 0, 0, [[0.95, 0.36], [0.66, 0.58], [0.12, 0.66]], 12);
    B.rgb(0.03, 0.03, 0.03, 0); lathe(B, 0, 0, 0, [[0.09, 0.6], [0.065, 1.24]], 6);
    lathe(B, 0, 0, 0, [[0.08, 1.22], [0.25, 1.33], [0.29, 1.5], [0.25, 1.52], [0.21, 1.38], [0.0, 1.3]], 9);   // brazier bowl
    for (let k = 0; k < 5; k++) { const a = k * 1.2566, c = Math.cos(a), s = Math.sin(a); boxV(B, c * 0.21, 1.74, s * 0.21, [0.018, 0, 0], [-c * 0.07, 0.23, -s * 0.07], [0, 0, 0.018]); }   // cage
    lathe(B, 0, 0, 0, [[0.11, 1.95], [0.16, 1.95], [0.16, 2.0], [0.0, 2.06]], 8);
    B.rgb(1, 1, 1, 1); lathe(B, 0, 0, 0, [[0.0, 1.36], [0.13, 1.46], [0.12, 1.62], [0.05, 1.82], [0, 1.94]], 8);  // small flame core
    return B.finish();
  }
  function buildFloat() {
    const B = new Builder(false), R = 0.45, prof = [];
    for (let k = 0; k <= 9; k++) { const a = -Math.PI / 2 + (Math.PI * k) / 9; prof.push([Math.cos(a) * R, Math.sin(a) * R]); }
    B.rgb(1, 1, 1, 1); lathe(B, 0, 0, 0, prof, 16);
    const loop = [];
    for (let k = 0; k <= 6; k++) { const a = (k / 6) * 6.2831853; loop.push([0.11 + Math.cos(a) * 0.03, R + 0.02 + Math.sin(a) * 0.03]); }
    B.rgb(0, 0, 0, 0); lathe(B, 0, 0, 0, loop, 10);
    return B.finish();
  }

  function buildMeshes(gen, stride) {
    const out = { terrain: buildTerrain(gen, stride), props: buildProps(gen), buoy: buildBuoy(), float: buildFloat() };
    // kindling ring instances: x, z, beacon index, k (0..1 around the ring, starting beside the jetty)
    // a buoy never sits in the shallows, on the beach or against the quay: nudge it round the ring, else leave it out
    const ring = [];
    gen.BI.forEach((I, bi) => {
      const aj = Math.atan2(I.shore[1] - I.dock.z, I.shore[0] - I.dock.x);
      for (let k = 0; k < RING_N; k++) {
        const a0 = aj + ((k + 0.5) / RING_N) * 6.2831853;
        for (const da of [0, 0.09, -0.09, 0.17, -0.17]) {
          const x = I.dock.x + Math.cos(a0 + da) * DOCK_R, z = I.dock.z + Math.sin(a0 + da) * DOCK_R;
          if (heightAt(x, z) < -1.5 && nearestLand(x, z, 7).d > 6.5) { ring.push(x, z, bi, k / RING_N); break; }
        }
      }
    });
    const inst = new Float32Array(ring);
    out.ringInst = inst;
    return out;
  }

  // ---------------------------------------------------------------------------
  // Shaders
  // ---------------------------------------------------------------------------
  // shared by terrain and props: shadow-horizon lookup, bleached + soft-clipped warm light, capped lightning key
  const W_LIGHT = `uniform sampler2D uShadowMap;   // r,g = height above which a point is lit by the moon / the dawn sun
float wLum(vec3 c){ return dot(c, vec3(0.30, 0.55, 0.15)); }
vec2 wShadow(vec3 P){ return smoothstep(vec2(-0.75), vec2(0.60), vec2(P.y) - texture(uShadowMap, P.xz/3072.0 + 0.5).rg); }
uniform float uHeartIdx; uniform float uDbg;
uniform vec4 uHeartK;   // the Heartlight: x = lamp on 0..1, y = ignition flash envelope, z = seconds since ignition (-1 before), w = hush
float wIgnite(float lit){ return smoothstep(0.0, 0.22, lit)*(1.0 - smoothstep(0.30, 0.95, lit)); }   // a lamp taking the flame
// skiff lantern + beacons on a surface. As it gets strong the colour bleaches toward pale warm white and soft-clips,
// so lit stone stays stone (never saturated orange or pink) and keeps its form.
vec3 wWarm(vec3 P, vec3 N, vec3 Nh, float gain){   // Nh: a smoother normal for the great lamp's key, so its cone grades evenly
  vec3 w = twLanternAt(P)*twWrap(dot(N, normalize(uLantern.xyz - P)), 0.45);
  vec3 flash = vec3(0.0);
  int nb = int(uMisc.x);
  for (int i = 0; i < 8; i++) {
    if (i >= nb) break;
    vec4 B = uBeacons[i];
    if (B.w > 0.001) {
      vec3 L = B.xyz - P; float d2 = dot(L, L); float nl = twWrap(dot(N, L*inversesqrt(d2 + 1e-4)), 0.5);
      if (abs(float(i) - uHeartIdx) < 0.5) {           // the great lamp: dark until it catches, a flash over the whole upper peak, then a steady key
        float dd = sqrt(d2);
        w += uBeaconCol[i].rgb*(uHeartK.x*(3.2/(1.0 + d2/(22.0*22.0)))*nl);                       // the lamp room's own omni glow (no swept stripe down the rock)
        w += uBeaconCol[i].rgb*(uHeartK.x*2.2*twWrap(dot(Nh, L/dd), 0.70)*(1.0 - 0.90*smoothstep(45.0, 150.0, dd))/(1.0 + d2/(46.0*46.0)));
        // the flash: deep gold, directional, falling off down the peak; added after the bleach so it stays gold and keeps form
        flash = vec3(1.0, 0.60, 0.22)*min(uHeartK.y*15.0*twWrap(dot(Nh, L/dd), 0.30)*(1.0 - 0.96*smoothstep(48.0, 165.0, dd))/(1.0 + d2/(50.0*50.0)), 9.0)
              + vec3(1.0, 0.63, 0.27)*(uHeartK.x*4.4*twWrap(dot(Nh, L/dd), 0.38)*(1.0 - 0.95*smoothstep(50.0, 160.0, dd))/(1.0 + d2/(54.0*54.0)));   // ...and the steady gold key on the upper peak
      } else
        w += twBeaconAt(i, P)*nl + uBeaconCol[i].rgb*(wIgnite(B.w)*5.0*nl/(1.0 + d2/(34.0*34.0)));
    }
  }
  w *= gain;
  float l = wLum(w);
  w = mix(w, vec3(l)*vec3(1.0, 0.90, 0.74), smoothstep(0.15, 1.6, l)*0.8);
  return w/(1.0 + l*0.55) + flash*gain;
}
// lightning: a hard, cold, directional key from the bolt's side. No ambient lift; peak well below white.
vec3 wFlash(vec3 P, vec3 N){
  vec3 Lf = normalize(uLightningPos.xyz - P);
  return vec3(0.60, 0.72, 1.0)*(min(uFlash, 1.3)*0.55*smoothstep(0.02, 0.30, dot(N, Lf)));
}
`;
  const VS_TERRAIN = `#include <env>
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm; layout(location=2) in vec2 aBed; layout(location=3) in vec4 aCol;
out vec3 vP; out vec3 vN; out vec4 vC; out vec2 vBed;
void main(){ vP = aPos; vN = aNrm; vC = aCol; vBed = aBed; gl_Position = uViewProj*vec4(aPos, 1.0); }`;
  const FS_TERRAIN = `#include <noise>
#include <light>
#include <fog>
` + W_LIGHT + `in vec3 vP; in vec3 vN; in vec4 vC; in vec2 vBed; out vec4 o;
void main(){
  vec3 Ns = normalize(vN);
  vec3 Vv = uCamPos.xyz - vP; float dist = length(Vv); vec3 V = Vv/max(dist, 1e-3);
  float nd = 1.0 - smoothstep(60.0, 230.0, dist);                 // close-range detail weight
  float df = 1.0 - 0.6*smoothstep(450.0, 1500.0, dist);           // mid-range detail weight
  float rockM = vBed.y;
  vec3 Nf = normalize(cross(dFdx(vP), dFdy(vP)) + Ns*1e-9);
  float steepS = 1.0 - smoothstep(0.58, 0.86, Ns.y);
  vec3 Ng = normalize(mix(Ns, Nf, clamp((0.15 + 0.5*steepS)*(0.08 + 0.92*rockM) + 0.25*rockM, 0.0, 0.55)*(1.0 - smoothstep(90.0, 420.0, dist))));   // hard planes on rock, soft turf
  float steep = 1.0 - smoothstep(0.52, 0.84, Ng.y);
  float wy = Ng.y*Ng.y; wy *= wy;
  vec4 nT = texture(uNoiseTex, vP.xz*0.031);
  vec4 nS = texture(uNoiseTex, vec2((vP.x - vP.z)*0.024, vP.y*0.075));
  vec4 n1 = mix(nS, nT, wy);
  vec4 n2 = texture(uNoiseTex, vP.xz*0.17 + vP.y*0.13);
  vec4 n3 = texture(uNoiseTex, mix(vec2((vP.x - vP.z)*0.31, vP.y*0.45), vP.xz*0.47, wy));
  float y = vP.y - uWind.w;
  // --- bedding: the beds are the geometric ledges (vBed.x), each with its own tone; staggered joints cut them into blocks
  float along = abs(Ng.z) > abs(Ng.x) ? vP.x : vP.z;
  float fault = twHash(vec2(floor((vP.x + vP.z*0.6)*0.024 + nT.g*1.6), 5.1));                 // faults offset the beds
  float bu = vBed.x + (nT.r - 0.5)*1.5 + (n1.r - 0.5)*0.35 + (fault - 0.5)*0.9;   // beds wander with the ground
  bu += 0.42*sin(bu*1.7 + nT.g*5.0) + (n2.r - 0.5)*0.4;                                             // ...thicken and pinch out
  float bedId = floor(bu), bf = bu - bedId;
  float tone = twHash(vec2(bedId, 7.3));
  float tone2 = twHash(vec2(floor(bu*3.0 + n1.g*0.8), 2.1));
  float gul = 0.3 + 0.7*smoothstep(0.34, 0.52, vC.g);                             // beds break up in the gullies
  float jx = along*0.17 + vP.y*0.03 + tone*9.0 + (n1.g - 0.5)*0.9;
  float jf = fract(jx), blockId = twHash(vec2(floor(jx), bedId));
  float joint = (1.0 - smoothstep(0.012, 0.055, min(jf, 1.0 - jf)))*steep*step(0.38, twHash(vec2(floor(jx + 0.5), bedId + 3.0)))*(0.55 + 0.45*n2.r)*(0.25 + 0.75*rockM);
  float bedLine = (1.0 - smoothstep(0.0, 0.07, min(bf, 1.0 - bf)))*steep*(0.3 + 0.7*rockM)*gul;
  float hNear = 1.0 - smoothstep(40.0, 170.0, distance(vP, uBeacons[int(uHeartIdx + 0.5)].xyz));          // under the great lamp the beds must not read as bands
  float ls = hNear*uHeartK.x*min(0.6 + uHeartK.y, 1.0);                                   // the lamp's share of this pixel's light: there the rock is broad planes, not tiles
  vec3 rock = mix(vec3(0.084, 0.087, 0.098), vec3(0.122, 0.115, 0.105), smoothstep(0.2, 0.8, tone)*gul*0.22*(1.0 - 0.75*hNear));
  rock *= 0.98 + 0.04*tone2;
  rock *= 1.0 + (blockId - 0.5)*0.07*steep*rockM*(1.0 - ls);
  rock *= 0.84 + 0.32*n1.r;
  rock *= 1.0 - 0.5*max(joint*0.6, bedLine*0.08)*df*(1.0 - 0.85*ls);
  rock *= mix(1.0, 0.72 + 0.6*n3.g, nd);
  float lich = (1.0 - smoothstep(0.10, 0.30, n2.b))*smoothstep(5.0, 14.0, y)*(0.35 + 0.65*n1.g);
  rock = mix(rock, vec3(0.26, 0.25, 0.15), lich*0.5);
  float streak = smoothstep(0.56, 0.72, texture(uNoiseTex, vec2(along*0.31 + tone*3.0, vP.y*0.022 + 0.3)).r)*(1.0 - bf)*(0.4 + 0.6*n1.g);
  rock = mix(rock, vec3(0.27, 0.27, 0.24), vC.a*streak*steep*0.55);                     // guano / pale lichen streaks
  // normal detail so the light, not just the paint, carries the rock: tilted blocks, ledge lips, crack walls, grain
  vec3 T = normalize(cross(vec3(0.0, 1.0, 0.0), Ng) + vec3(1e-4, 0.0, 0.0));
  vec3 dn = vec3(n1.r - 0.5, 0.0, n1.g - 0.5)*0.7 + vec3(n2.r - 0.5, 0.0, n2.g - 0.5)*0.5 + vec3(n3.r - 0.5, 0.0, n3.g - 0.5)*(0.7*nd);
  dn += T*((blockId - 0.5)*0.15*steep);
  dn += T*((0.5 - jf)*2.0*joint);
  dn.y += (0.5 - bf)*0.12*bedLine;
  // angular fracture facets, anchored in the world so they hold still at any range
  vec3 fp = vec3(vP.x*0.83 - vP.z*0.56, vP.y*1.35, vP.x*0.56 + vP.z*0.83)/5.5 + (n1.rgb - 0.5)*1.1 + (n2.gbr - 0.5)*0.35;
  vec3 fc = floor(fp), ff = fract(fp);
  vec3 fv = vec3(twHash3(fc), twHash3(fc + 17.13), twHash3(fc + 31.71)) - 0.5;
  float fe = min(min(min(ff.x, 1.0 - ff.x), min(ff.y, 1.0 - ff.y)), min(ff.z, 1.0 - ff.z));
  float fw = (0.30 + 0.70*steepS)*smoothstep(0.12, 0.60, rockM)*(1.0 - 0.7*smoothstep(700.0, 1500.0, dist));
  dn += fv*(1.15*fw);
  float crack = (1.0 - smoothstep(0.0, 0.06, fe))*fw;
  float sand = smoothstep(0.78, 0.92, Ns.y)*(1.0 - smoothstep(2.6, 5.0, y + (n1.r - 0.5)*2.5));
  float rip = sin(dot(vP.xz, vec2(0.866, -0.5))*2.6 + n1.g*14.0 + n2.r*5.0)*smoothstep(0.35, 0.6, nT.r);                         // wind ripples across the sand
  dn = mix(dn, vec3(0.866, 0.0, -0.5)*(rip*0.22) + vec3(n2.r - 0.5, 0.0, n2.g - 0.5)*0.5, sand);
  vec3 N = normalize(Ng + dn*(0.55*df));
  // --- storm-grass and heather caps with a ragged edge
  float biome = twWorld(vP.xz).b;
  float turf = smoothstep(0.70, 0.88, Ns.y + (n1.g - 0.5)*0.25 + (n2.g - 0.5)*0.14)*smoothstep(3.0, 6.5, y + (n1.r - 0.5)*4.0);
  turf *= 1.0 - 0.6*rockM*smoothstep(0.45, 0.60, nT.g);
  turf *= 1.0 - 0.85*nd*smoothstep(0.52, 0.62, nT.g*0.55 + n2.r*0.45);
  vec3 grass = mix(vec3(0.034, 0.060, 0.026), vec3(0.092, 0.098, 0.040), min(1.0, n1.g*n1.g*1.6));
  vec3 heath = mix(vec3(0.050, 0.043, 0.034), vec3(0.082, 0.064, 0.036), n2.r);
  vec3 veg = mix(grass, heath, smoothstep(0.40, 0.62, biome + (n2.g - 0.5)*0.35));
  veg *= 0.75 + 0.5*n2.g;
  veg *= mix(1.0, 0.62 + 0.8*n3.r, nd);
  veg *= mix(1.0, 0.50 + 1.0*n2.g, nd*0.8);
  veg = mix(veg, vec3(0.115, 0.105, 0.045), nd*0.55*smoothstep(0.56, 0.74, n3.r));
  // --- scree fans under the cliffs
  float scree = vC.b*smoothstep(0.45, 0.80, Ns.y)*smoothstep(0.30, 0.55, n1.g + 0.15*n2.r)*0.8;
  vec3 screeC = mix(vec3(0.115, 0.112, 0.110), vec3(0.25, 0.235, 0.21), n2.g)*(0.75 + 0.5*step(0.5, n2.a));
  // --- pale sand and shingle low in the lee
  vec3 sandC = mix(vec3(0.105, 0.096, 0.080), vec3(0.165, 0.152, 0.128), n2.g);
  sandC *= 1.0 - 0.4*step(0.80, n2.a);
  float peb = (1.0 - smoothstep(0.12, 0.40, n3.b))*nd*smoothstep(0.30, 0.55, n1.g + (y - 1.5)*0.12);
  sandC = mix(sandC, mix(vec3(0.09, 0.095, 0.105), vec3(0.42, 0.40, 0.36), n3.g), peb*0.85);
  sandC *= mix(1.0, 0.82 + 0.36*n3.r, nd);
  sandC *= 1.0 + 0.04*rip;
  sandC *= mix(0.34, 1.0, smoothstep(0.1, 2.4, y + (n1.g - 0.5)*1.2));                              // damp, dark sand toward the water
  float wrack = (1.0 - smoothstep(0.0, 0.28, abs(y - (1.35 + n1.r*0.9))))*smoothstep(0.42, 0.55, n2.r);
  sandC = mix(sandC, vec3(0.035, 0.030, 0.020), wrack*0.8);                                        // wrack line of weed and pebbles
  rock *= (1.0 - 0.38*crack*(1.0 - 0.7*ls))*(1.0 + fv.y*0.26*fw*(1.0 - ls));
  vec3 albedo = mix(rock, screeC, scree*0.85);
  albedo = mix(albedo, veg, turf);
  float tedge = turf*(1.0 - turf)*4.0;
  albedo *= 1.0 - 0.45*tedge*(1.0 - nd*0.5);                                             // dark peat lip under the turf
  albedo = mix(albedo, vec3(0.125, 0.112, 0.048), tedge*step(0.50, n3.r)*nd*0.85);
  albedo = mix(albedo, sandC, sand);
  // cobbled station yard at each lighthouse foot
  float yard = 0.0;
  for (int i = 0; i < 6; i++) {
    vec4 Bc = uBeacons[i]; float hb = Bc.y - vP.y;
    yard = max(yard, (1.0 - smoothstep(11.0, 14.0, distance(vP.xz, Bc.xz) + (n1.r - 0.5)*3.0))*step(15.0, hb)*step(hb, 30.0));
  }
  yard *= smoothstep(0.86, 0.95, Ns.y);
  vec3 yardC = mix(vec3(0.21, 0.20, 0.18), vec3(0.09, 0.088, 0.085), smoothstep(0.40, 0.75, n2.b))*(0.78 + 0.44*n3.g);
  albedo = mix(albedo, yardC, yard*0.92);
  // --- the tide line: black wet rock and weed, with a salt-and-barnacle stain above it
  float run = 0.2 + 1.3*nT.g + (0.15 + 0.2*uStorm)*sin(uTime*0.6 + vP.x*0.06 + vP.z*0.045) + (n2.r - 0.5)*0.5;   // top of the damp zone, 0.2-1.5 m
  float wet = 1.0 - smoothstep(run*0.35, run + 0.25, y);
  float stain = smoothstep(run*0.5, run + 0.2, y)*(1.0 - smoothstep(run + 0.9, run + 2.4 + nT.r*1.6, y))*(1.0 - sand);
  albedo = mix(albedo, mix(vec3(0.20, 0.20, 0.18), vec3(0.34, 0.33, 0.30), n2.g), stain*(0.30 + 0.45*n2.b));          // barnacle / salt stain
  float weed = (1.0 - smoothstep(run*0.4, run + 0.5, y))*(1.0 - sand);
  albedo = mix(albedo, mix(vec3(0.060, 0.066, 0.022), vec3(0.105, 0.075, 0.030), n2.g), weed*(0.15 + 0.35*n2.r));
  albedo *= mix(1.0, 0.70, wet);
  float surf = (1.0 - smoothstep(-0.3, 0.35 + 0.4*n2.g, y))*(0.4 + 0.6*n2.b)*(1.0 - sand);                           // foam-stained foot
  albedo = mix(albedo, vec3(0.27, 0.29, 0.30), surf*0.35);
  albedo = mix(albedo, vec3(0.045, 0.060, 0.066), 1.0 - smoothstep(-3.0, -0.8, y));                                  // under water: wet rock, not black
  float damp = max(wet, uRain*0.22);
  float rough = mix(0.90, 0.22, damp);
  float spec = mix(0.02, 0.60, damp)*(1.0 - 0.6*turf)*(0.35 + 0.65*n2.g)*(1.0 - 0.8*sand);
  // --- light: the moon (or the dawn sun) carves a lit side and a shadow side; ambient keeps form in the dark
  float ao = vC.r, cav = vC.g;
  vec2 sh = wShadow(vP);
  float ndm = dot(N, uMoonDir.xyz), nds = dot(N, uSunDir.xyz);
  vec3 amb = twAmbient(N);
  float aoT = mix(0.30, 1.0, ao);
  vec3 key = uMoonColor.rgb*((sh.x*twWrap(ndm, 0.10)*0.95 + 0.17*twWrap(ndm, 0.80)*mix(0.45, 1.0, sh.x)*(1.0 - uDawn))*(1.0 - 0.65*uHeartK.w)) + uSunColor.rgb*(sh.y*twWrap(nds, 0.22)*0.62);
  vec3 fill = amb*(mix(1.75, 1.10, uDawn)*mix(vec3(1.0), vec3(0.92, 0.88, 1.10), uDawn))            // violet-blue shadow side at dawn
            + uMoonColor.rgb*(0.045*(0.4 + 0.6*N.y)) + uSunColor.rgb*(0.02*(0.5 + 0.5*N.y))
            + uSunColor.rgb*(0.05*twWrap(dot(N, normalize(vec3(uSunDir.x, 0.3, uSunDir.z))), 1.0));   // warm sky bounce from the sun's side
  vec3 warm = wWarm(vP, N, normalize(mix(N, Ns, 0.93)), 1.0);
  vec3 albW = mix(albedo, vec3(wLum(albedo))*vec3(1.05, 0.98, 0.86), 0.32)*(0.62 + 0.76*n1.r)*(0.80 + 0.40*n2.g);                         // warm light sees stone, not pigment
  float form = mix(0.55, 1.0, ao);
  float cool = 1.0 - 0.88*smoothstep(0.06, 0.50, wLum(warm));                                        // the eye adapts: no blue + orange = pink
  vec3 cCold = albedo*(key*(cool*form) + fill*(aoT*aoT*cool)), cWarm = albW*warm*form;
  vec3 col = cCold + cWarm;
  { float wl = wLum(cWarm), cl = wLum(cCold), eq = 4.0*wl*cl/((wl + cl)*(wl + cl) + 1e-6);          // where orange meets blue, go to warm grey, not pink
    col = mix(col, vec3(wLum(col))*mix(vec3(0.90, 1.00, 1.16), vec3(1.22, 1.00, 0.68), smoothstep(0.10, 0.45, wLum(warm))), 0.9*eq); }   // (kept clearly warm: a neutral grey here grades to mauve)
  col = (col + albedo*wFlash(vP, N)*(aoT*form))*(0.74 + 0.52*cav);
  col += min(twSpecular(vP, N, V, rough), vec3(1.4))*(spec*aoT*mix(0.3, 1.0, sh.x));
  float fres = pow(clamp(1.0 - dot(Ns, V), 0.0, 1.0), 4.0)*(0.18 + 0.82*smoothstep(0.52, 0.78, cav))*(0.35 + 0.65*steepS);   // crests and edges only, not whole slopes
  float backM = pow(max(dot(-V, uMoonDir.xyz), 0.0), 2.0), backS = pow(max(dot(-V, uSunDir.xyz), 0.0), 2.0);
  vec3 Lf = normalize(uLightningPos.xyz - vP);
  vec3 rimL = uMoonColor.rgb*((0.07 + 0.80*backM)*sh.x*twWrap(dot(Ns, uMoonDir.xyz), 0.9))      // silver along the ridgelines
            + uSunColor.rgb*((0.06 + 0.85*backS)*sh.y*twWrap(dot(Ns, uSunDir.xyz), 0.9))
            + vec3(0.62, 0.74, 1.0)*(min(uFlash, 1.3)*0.45*twWrap(dot(N, Lf), 0.5))
            + amb*0.30;
  col += rimL*(fres*aoT*(0.55 + 0.45*damp));
  { vec4 Hb = uBeacons[int(uHeartIdx + 0.5)]; vec3 Lh = Hb.xyz - vP; float dh = length(Lh);        // warm rim on ridges and edges that face the great lamp
    float fl = uHeartK.y, Rr = mix(60.0, 120.0, fl);
    col += uBeaconCol[int(uHeartIdx + 0.5)].rgb*albW*(uHeartK.x*(5.0 + 6.0*fl)*fres*twWrap(dot(Ns, Lh/max(dh, 1e-3)), 0.20)*aoT/(1.0 + dh*dh/(Rr*Rr))*(1.0 - smoothstep(60.0, mix(175.0, 250.0, fl), dh))*(1.0 - 0.5*uDawn)); }
  col += uSunColor.rgb*(pow(clamp(1.0 - dot(N, V), 0.0, 1.0), 2.5)*0.11*sh.y*twWrap(dot(Ns, uSunDir.xyz), 0.35)*aoT);
  col += uSunColor.rgb*(0.010*pow(max(dot(-V, uSunDir.xyz), 0.0), 4.0)*smoothstep(80.0, 700.0, dist));          // a little warm in-scatter toward the sun   // warm fresnel on sun-facing slopes
  vec3 fogC = twFogColor(-V) - vec3(0.50, 0.62, 0.95)*(uFlash*0.22*0.65);     // land stays a dark mass against the flash-lit haze
  o = vec4(mix(col, fogC, twFogAmount(vP)), 1.0);
  if (uDbg > 0.5) o = vec4(0.0, 0.25, 0.0, 1.0);
}`;

  const VS_PROPS = `#include <env>
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm; layout(location=3) in vec4 aCol; layout(location=4) in vec4 aInfo;
uniform float uHeartIdx;
out vec3 vP; out vec3 vN; out vec4 vC; out float vU; flat out vec4 vI; flat out vec4 vB;
void main(){
  vP = aPos; vN = aNrm; vC = aCol; vU = aInfo.w;
  int bi = int(aInfo.x + 0.5);
  vI = vec4(aInfo.y, aInfo.z, uBeaconCol[bi].w, abs(aInfo.x - uHeartIdx) < 0.5 ? 1.0 : 0.0);
  vB = vec4(uBeaconCol[bi].rgb, uBeacons[bi].w);
  gl_Position = uViewProj*vec4(aPos, 1.0);
}`;
  const FS_PROPS = `#include <noise>
#include <light>
#include <fog>
` + W_LIGHT + `uniform vec4 uQuay[12];
in vec3 vP; in vec3 vN; in vec4 vC; in float vU; flat in vec4 vI; flat in vec4 vB; out vec4 o;
void main(){
  vec3 N = normalize(vN);
  vec3 Vv = uCamPos.xyz - vP; float dist = length(Vv); vec3 V = Vv/max(dist, 1e-3);
  float nd = 1.0 - smoothstep(55.0, 190.0, dist);
  float kind = vI.x, th = vI.y, lit = vB.a;
  vec3 hL = uBeacons[int(uHeartIdx + 0.5)].xyz;
  if (vI.w > 0.5) {                                      // Basse-Terre: dark until the lamp catches, then the light ripples down to the village and the quay
    float dl = distance(vP, hL); dl = dl < 12.0 ? 0.0 : 0.3 + 1.2*clamp((dl - 25.0)/140.0, 0.0, 1.0);
    lit = uHeartK.z < 0.0 ? 0.0 : smoothstep(dl, dl + 0.16, uHeartK.z);
  }
  vec4 n1 = texture(uNoiseTex, vec2(vP.x + vP.z, vP.y)*0.11);
  vec4 n2 = texture(uNoiseTex, vec2((vP.x - vP.z)*0.9, vP.y*0.06));
  vec3 albedo = vC.rgb; float rough = 0.8; float spec = 0.05; vec3 em = vec3(0.0); float ao = vC.a;
  bool stone = false;
  if (kind < 0.5) {
    albedo *= 0.70 + 0.55*n1.r;
    albedo *= 1.0 - 0.38*smoothstep(0.50, 0.74, n2.g);
    N = normalize(N + (n1.rgb - 0.5)*0.22);
    spec = 0.05 + 0.18*uRain; rough = mix(0.85, 0.45, uRain); stone = true;
  } else if (kind < 1.5) {
    float on = smoothstep(th, th + 0.10, lit);
    albedo = vec3(0.012, 0.016, 0.024); rough = 0.12; spec = 0.6; ao = 1.0;
    vec3 glow = vec3(1.0, 0.58, 0.22)*(on*(3.4 + 0.6*sin(uTime*7.0 + th*60.0)*n1.r));
    if (vC.b > 0.06) {                                   // small panes: glazing bars + painted frame
      vec2 np = floor(vC.ba*8.0 + 0.5);
      vec2 f = abs(fract(vC.xy*np) - 0.5), e = abs(vC.xy - 0.5);
      float frame = max(smoothstep(0.40, 0.43, e.x), smoothstep(0.42, 0.45, e.y));
      float bar = max(max(smoothstep(0.40, 0.46, f.x), smoothstep(0.42, 0.47, f.y)), frame);
      glow *= (1.0 - bar)*(0.7 + 0.6*n1.g);
      albedo = mix(albedo, mix(vec3(0.045, 0.04, 0.035), vec3(0.30, 0.29, 0.26), frame), bar);
      rough = mix(rough, 0.8, bar); spec = mix(spec, 0.05, bar);
    }
    em = glow;
  } else if (kind < 2.5) {
    float ang = vI.z; vec2 bd = vec2(cos(ang), sin(ang)); vec2 nd2 = normalize(N.xz + vec2(1e-4));
    float lens = pow(max(dot(nd2, bd), 0.0), 6.0) + 0.6*pow(max(dot(nd2, -bd), 0.0), 6.0);
    albedo = vec3(0.015, 0.02, 0.028); rough = 0.10; spec = 0.8;
    if (vI.w > 0.5) em = vB.rgb*(uHeartK.x*(1.0 + 3.0*uHeartK.y)*(3.2 + 13.0*lens)*2.8) + vec3(1.0, 0.42, 0.12)*(0.10*uHeartK.w*(1.0 - uHeartK.x));   // an ember in the hush, then the catch
    else em = vB.rgb*(smoothstep(0.0, 0.2, lit)*(1.0 + 2.6*wIgnite(lit))*(3.2 + 13.0*lens));   // flares as it takes the flame, then settles
  } else if (kind < 3.5) { rough = 0.42; spec = 0.35 + 0.2*uRain; }
  else if (kind < 4.5) {                                 // dressed stone in courses
    float yy = vP.y/0.44; float row = floor(yy), fy = fract(yy);
    float uu = vU/0.92 + 0.5*mod(row, 2.0) + twHash(vec2(row, 3.7))*0.35;
    float fx = fract(uu); float id = twHash(vec2(floor(uu), row));
    float joint = max(smoothstep(0.80, 0.96, abs(fy*2.0 - 1.0)), smoothstep(0.90, 0.975, abs(fx*2.0 - 1.0)));
    if (N.y > 0.7) {                                     // flagged tops
      vec2 g = vP.xz/0.95; g.y += 0.5*mod(floor(g.x), 2.0);
      vec2 fg = abs(fract(g)*2.0 - 1.0); joint = max(smoothstep(0.88, 0.97, fg.x), smoothstep(0.88, 0.97, fg.y)); id = twHash(floor(g)); fy = 0.5;
    }
    albedo *= mix(0.94, (0.86 + 0.24*id)*(1.0 - 0.38*joint), nd);
    albedo *= 0.76 + 0.44*n1.r; albedo *= 1.0 - 0.30*smoothstep(0.50, 0.74, n2.g);
    N = normalize(N + (n1.rgb - 0.5)*0.2 + vec3(0.0, (0.5 - fy)*0.6*joint*nd, 0.0));
    spec = 0.05 + 0.18*uRain; rough = mix(0.85, 0.45, uRain); stone = true;
  } else if (kind < 5.5) {                               // slates
    float yy = vP.y/0.30; float row = floor(yy), fy = fract(yy);
    float uu = vU/0.42 + 0.5*mod(row, 2.0); float fx = fract(uu); float id = twHash(vec2(floor(uu), row));
    float edge = max(1.0 - smoothstep(0.0, 0.16, fy), smoothstep(0.90, 0.98, abs(fx*2.0 - 1.0)));
    albedo *= mix(0.9, (0.68 + 0.64*id)*(1.0 - 0.5*edge), nd); albedo *= 0.8 + 0.4*n1.r;
    rough = 0.42; spec = 0.22 + 0.3*uRain;
  } else {                                               // dry-stone rubble
    vec4 nr = texture(uNoiseTex, vec2(vU, vP.y)*0.12);
    albedo *= mix(0.9, (0.55 + 0.9*nr.r)*(1.0 - 0.6*smoothstep(0.55, 0.85, nr.b)), nd); albedo *= 0.8 + 0.4*n1.r;
    N = normalize(N + (nr.rgb - 0.5)*(0.5*nd));
    spec = 0.04 + 0.12*uRain; stone = true;
  }
  if (stone) {                                           // tide-stained foot: wet dark band, weed, a pale barnacle line
    float ty = vP.y - uWind.w + (n1.g - 0.5)*0.7;
    float wet = 1.0 - smoothstep(0.6, 1.4, ty);
    float weed = (1.0 - smoothstep(0.9, 1.9, ty))*(1.0 - wet);
    albedo = mix(albedo, vec3(0.05, 0.06, 0.022), weed*0.75);
    float barn = smoothstep(0.95, 1.2, ty)*(1.0 - smoothstep(1.4, 1.75, ty))*step(0.3, n2.b);
    albedo = mix(albedo, vec3(0.21, 0.21, 0.18), barn*0.5);
    albedo *= mix(1.0, 0.35, wet); rough = mix(rough, 0.55, wet); spec = mix(spec, 0.12, wet);
  }
  vec2 sh = wShadow(vP);
  float ndm = dot(N, uMoonDir.xyz), nds = dot(N, uSunDir.xyz);
  vec3 warm = wWarm(vP, N, N, 0.36);
  for (int i = 0; i < 12; i++) {                                   // the quay lanterns light the stone around them
    vec4 Q = uQuay[i]; float on = smoothstep(0.03, 0.2, uBeacons[int(Q.w + 0.5)].w);
    if (abs(Q.w - uHeartIdx) < 0.5) { float dq0 = 0.3 + 1.2*clamp((distance(Q.xyz, hL) - 25.0)/140.0, 0.0, 1.0); on = uHeartK.z < 0.0 ? 0.0 : smoothstep(dq0, dq0 + 0.16, uHeartK.z); }
    vec3 Lq = Q.xyz - vP; float dq = dot(Lq, Lq);
    warm += vec3(1.0, 0.60, 0.26)*(on*3.2*twWrap(dot(N, Lq*inversesqrt(dq + 1e-3)), 1.0)/(1.0 + dq/55.0));
  }
  float cool = 1.0 - 0.8*smoothstep(0.02, 0.3, wLum(warm));
  vec3 e = (uMoonColor.rgb*(sh.x*twWrap(ndm, 0.30)*0.46) + uSunColor.rgb*(sh.y*twWrap(nds, 0.20)*0.60)       // firm lit side / shadow side
         + twAmbient(N)*(mix(1.4, 0.85, uDawn)*mix(vec3(1.0), vec3(0.86, 0.84, 1.16), uDawn)))*cool
         + wFlash(vP, N) + warm;
  vec3 col = albedo*e*ao;
  { float wl = wLum(warm), cl = max(wLum(e) - wl, 0.0), eq = 4.0*wl*cl/((wl + cl)*(wl + cl) + 1e-6);
    col = mix(col, vec3(wLum(col))*vec3(1.20, 1.00, 0.70), 0.8*eq); }
  col += min(twSpecular(vP, N, V, rough), vec3(1.4))*(spec*mix(0.35, 1.0, sh.x));
  float rim = pow(clamp(1.0 - dot(N, V), 0.0, 1.0), 3.0);
  float backM = pow(max(dot(-V, uMoonDir.xyz), 0.0), 2.0);
  col += (uMoonColor.rgb*((0.06 + 0.4*backM)*sh.x*twWrap(ndm, 0.8)) + vec3(0.62, 0.74, 1.0)*(min(uFlash, 1.3)*0.35))*rim;
  float fa = twFogAmount(vP); vec3 fc = twFogColor(-V) - vec3(0.50, 0.62, 0.95)*(uFlash*0.22*0.65);
  col = mix(col, fc, fa) + em*(1.0 - 0.6*fa);
  o = vec4(col, 1.0);
  if (uDbg > 0.5) o = vec4(0.25, 0.0, 0.0, 1.0);
}`;

  const VS_BUOY = `#include <waves>
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm; layout(location=3) in vec4 aCol; layout(location=4) in vec4 aInst; layout(location=5) in vec4 aInfo;
uniform vec4 uRing[8];
out vec3 vP; out vec3 vN; out vec4 vC; out float vH; out vec2 vUV; flat out vec4 vG; flat out float vRaceType;
void main(){
  vec3 n; float crest; vec3 d = twWave(aInst.xy, n, crest);
  int bi = int(aInst.z + 0.5); vec4 R = uRing[bi]; float k = aInst.w;
  float prog = max(R.z, R.w);
  float on = smoothstep(k - 0.03, k + 0.05, prog*1.12);
  float pulse = 0.5 + 0.5*sin(uTime*5.0 - k*12.566);
  bool raceBuoy = k < -0.5;
  float g = R.x*(0.75 + 0.25*sin(uTime*1.7 + k*40.0)) + on*mix(3.2 + 2.8*pulse, 3.4, R.w);
  if (raceBuoy) g = max(g, 1.0) * 2.0;
  vec3 ec = raceBuoy ? (k > -1.5 ? vec3(1.0, 0.72, 0.16) : k > -2.5 ? vec3(0.55, 1.0, 0.30) : vec3(0.12, 0.88, 1.0)) : mix(vec3(0.30, 0.52, 0.85), vec3(1.0, 0.50, 0.16), max(R.y, on));
  vG = vec4(ec, g);
  vec3 up = normalize(mix(vec3(0.0, 1.0, 0.0), n, 0.7));
  vec3 tz = normalize(cross(vec3(1.0, 0.0, 0.0), up)); vec3 tx = cross(up, tz);
  vec3 lp = aPos;
  vec3 c = vec3(aInst.x, 0.0, aInst.y) + d;
  if (aCol.a > 0.5) {
    float fl = 0.62 + 0.13*min(g, 3.0);
    float dc = distance(c, uCamPos.xyz);
    fl *= 1.0 + min(dc*0.0015, 0.45);
    float hh = lp.y - 1.36;
    lp.xz *= fl*(0.85 + 0.25*sin(uTime*11.0 + k*50.0 + hh*4.0));
    lp.y = 1.36 + hh*fl;
    lp.xz += uWind.xy*(hh*hh*0.12)*(0.7 + 0.5*sin(uTime*8.0 + k*31.0));
  }
  lp *= raceBuoy ? 1.8 : 0.45;                              // race buoys x4; ordinary markers unchanged
  if (aCol.a > 0.5) { lp.xz *= 1.7; lp.y = 0.61 + (lp.y - 0.61)*1.8; }   // ...but the flame stays readable
  vec3 wp = c + tx*lp.x + up*(lp.y + 0.02) + tz*lp.z;
  vP = wp; vN = tx*aNrm.x + up*aNrm.y + tz*aNrm.z; vC = aCol; vH = aPos.y;
  vUV = vec2(fract(aInfo.w / 5.969026 * 2.0 + 0.5), (aPos.y - 0.12) / 0.24); vRaceType = aInst.w;
  gl_Position = uViewProj*vec4(wp, 1.0);
}`;
  const FS_BUOY = `#include <light>
#include <fog>
in vec3 vP; in vec3 vN; in vec4 vC; in float vH; in vec2 vUV; flat in vec4 vG; flat in float vRaceType;
uniform sampler2D uRaceDecalStart; uniform sampler2D uRaceDecalMark; uniform sampler2D uRaceDecalFinish;
uniform float uRaceDecalStartOn; uniform float uRaceDecalMarkOn; uniform float uRaceDecalFinishOn;
out vec4 o;
void main(){
  vec3 N = normalize(vN); vec3 V = normalize(uCamPos.xyz - vP);
  float fa = twFogAmount(vP); vec3 fc = twFogColor(-V);
  vec3 col;
  if (vC.a > 0.5) {
    float hh = clamp((vH - 1.36)/0.58, 0.0, 1.0);
    vec3 fcol = mix(vG.rgb*vec3(1.0, 1.25, 1.3), vG.rgb*vec3(1.0, 0.5, 0.3), hh)*(0.10 + 0.52*vG.a)*(1.0 - 0.4*hh);
    col = mix(fc, fcol, 1.0 - 0.5*fa);
  } else {
    col = vC.rgb*twIrradiance(vP, N) + twSpecular(vP, N, V, 0.5)*0.15;
    col += vC.rgb*vG.rgb*(vG.a*0.7*smoothstep(-0.3, 1.5, vH)*(0.4 + 0.6*max(N.y, 0.0)));
    col = mix(col, fc, fa);
  }
  if (vRaceType < -0.5 && vH >= 0.12 && vH <= 0.36) {
    vec4 decal = vec4(0.0);
    if (vRaceType > -1.5 && uRaceDecalStartOn > 0.5) decal = texture(uRaceDecalStart, vUV);
    else if (vRaceType > -2.5 && uRaceDecalMarkOn > 0.5) decal = texture(uRaceDecalMark, vUV);
    else if (uRaceDecalFinishOn > 0.5) decal = texture(uRaceDecalFinish, vUV);
    col = mix(col, decal.rgb, decal.a);
  }
  o = vec4(col, 1.0);
}`;

  const VS_FLOAT = `#include <waves>
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm; layout(location=3) in vec4 aCol; layout(location=4) in vec4 aInst;
out vec3 vP; out vec3 vN; out vec3 vL; out float vGlass; out float vPh; out float vDim;
void main(){
  vec3 n; float crest; vec3 d = twWave(aInst.xy, n, crest);
  vec3 up = normalize(mix(vec3(0.0, 1.0, 0.0), n, 0.5));
  float a = uTime*0.35 + aInst.z*6.2831853; float ca = cos(a), sa = sin(a);
  vec3 tz = normalize(cross(vec3(1.0, 0.0, 0.0), up)); vec3 tx = cross(up, tz);
  vec3 rx = tx*ca + tz*sa, rz = tz*ca - tx*sa;
  vec3 c = vec3(aInst.x, 0.0, aInst.y) + d;
  float dc = distance(c, uCamPos.xyz);
  float sc = aInst.w*(1.0 + clamp((dc - 50.0)*0.003, 0.0, 0.6));
  vDim = mix(1.0, 0.25, smoothstep(35.0, 220.0, dc));
  vec3 nl = aCol.a > 0.5 ? normalize(aPos) : aNrm;
  vec3 wp = c + (rx*aPos.x + up*(aPos.y + 0.13 + 0.05*sin(uTime*1.9 + aInst.z*20.0)) + rz*aPos.z)*sc;
  vP = wp; vN = rx*nl.x + up*nl.y + rz*nl.z; vL = aPos; vGlass = aCol.a; vPh = aInst.z;
  gl_Position = uViewProj*vec4(wp, 1.0);
}`;
  const FS_FLOAT = `#include <light>
#include <fog>
in vec3 vP; in vec3 vN; in vec3 vL; in float vGlass; in float vPh; in float vDim; out vec4 o;
void main(){
  vec3 N = normalize(vN); vec3 V = normalize(uCamPos.xyz - vP); float nv = max(dot(N, V), 0.0);
  float pulse = 0.85 + 0.15*sin(uTime*1.3 + vPh*6.2831853);
  vec3 teal = vec3(0.012, 0.46, 0.24);
  vec3 rope = vec3(0.20, 0.15, 0.09)*twIrradiance(vP, N) + teal*(0.10*pulse);
  vec3 col = rope;
  if (vGlass > 0.5) {
    vec3 d = normalize(vL);
    float lon = atan(d.z, d.x), lat = asin(clamp(d.y, -1.0, 1.0));
    float a = lon*(8.0/6.2831853), b = lat*2.4;
    float ln = min(abs(fract(a + b) - 0.5), abs(fract(a - b) - 0.5));
    float net = 1.0 - smoothstep(0.035, 0.08, ln);
    net = max(net, smoothstep(0.88, 0.93, d.y));
    vec3 glass = (teal*((0.45 + 1.9*pow(nv, 1.6))*pulse) + vec3(0.30, 1.0, 0.62)*(0.9*pow(nv, 10.0)*pulse))*vDim;
    glass += twSpecular(vP, N, V, 0.08)*0.9;
    col = mix(glass, rope, net);
  }
  col = mix(col, twFogColor(-V), twFogAmount(vP)*0.6);
  o = vec4(col, 1.0);
}`;

  const VS_FGLOW = `#include <waves>
layout(location=0) in vec2 aPos; layout(location=4) in vec4 aInst;
out vec2 vUV; out float vI;
void main(){
  vec3 n; float crest; vec3 d = twWave(aInst.xy, n, crest);
  vec3 C = vec3(aInst.x, 0.35, aInst.y) + d;
  vec3 toC = uCamPos.xyz - C; float dist = length(toC); vec3 dir = toC/max(dist, 1e-3);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), dir)); vec3 up = cross(dir, right);
  float size = aInst.w*(1.0 + min(dist*0.0042, 1.5));               // on-screen size is clamped with distance
  vec3 P = C + dir*0.6 + (right*aPos.x + up*aPos.y)*size;
  float pulse = 0.55 + 0.45*sin(uTime*0.8 + aInst.z*6.2831853);
  vI = pulse*smoothstep(8.0, 30.0, dist)*mix(0.85, 0.42, smoothstep(60.0, 420.0, dist))*(1.0 - 0.55*uDawn);
  vUV = aPos; gl_Position = uViewProj*vec4(P, 1.0);
}`;
  const FS_FGLOW = `in vec2 vUV; in float vI; out vec4 o;
void main(){
  float r2 = dot(vUV, vUV);
  float g = (exp(-r2*46.0) + exp(-r2*7.0)*0.10)*max(0.0, 1.0 - r2);
  o = vec4(vec3(0.05, 0.80, 0.48)*(g*vI), 1.0);
}`;

  const VS_BGLOW = `#include <waves>
layout(location=0) in vec2 aPos; layout(location=4) in vec4 aInst;
uniform vec4 uRing[8];
out vec2 vUV; out vec3 vCol;
void main(){
  vec3 n; float crest; vec3 d = twWave(aInst.xy, n, crest);
  int bi = int(aInst.z + 0.5); vec4 R = uRing[bi]; float k = aInst.w;
  float on = smoothstep(k - 0.03, k + 0.05, max(R.z, R.w)*1.12);
  bool raceBuoy = k < -0.5;
  float g = R.x*(0.75 + 0.25*sin(uTime*1.7 + k*40.0)) + on*mix(3.2 + 2.8*(0.5 + 0.5*sin(uTime*5.0 - k*12.566)), 3.4, R.w);
  if (raceBuoy) g = max(g, 1.0) * 2.0;
  vec3 C = vec3(aInst.x, 0.85, aInst.y) + d;
  vec3 toC = uCamPos.xyz - C; float dist = length(toC); vec3 dir = toC/max(dist, 1e-3);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), dir)); vec3 up = cross(dir, right);
  vec3 P = C + dir*0.5 + (right*aPos.x + up*aPos.y)*(0.6*(1.0 + min(dist*0.004, 1.5)));
  vUV = aPos; vec3 glowCol = raceBuoy ? (k > -1.5 ? vec3(1.0, 0.68, 0.12) : k > -2.5 ? vec3(0.45, 0.95, 0.22) : vec3(0.08, 0.78, 1.0)) : mix(vec3(0.30, 0.52, 0.85), vec3(1.0, 0.50, 0.16), max(R.y, on));
  vCol = glowCol*(0.075*g*(1.0 - 0.5*uDawn));
  gl_Position = uViewProj*vec4(P, 1.0);
}`;
  const FS_BGLOW = `in vec2 vUV; in vec3 vCol; out vec4 o;
void main(){ float r2 = dot(vUV, vUV); o = vec4(vCol*((exp(-r2*26.0)*1.6 + exp(-r2*5.0)*0.25)*max(0.0, 1.0 - r2)), 1.0); }`;

  const VS_BEAM = `#include <env>
layout(location=0) in vec3 aPos;
uniform vec4 uBeamA;   // beacon index, direction sign, hull length, tan(half angle)
uniform vec4 uBeamB;   // r0, tilt, gain, 1 = the Heartlight's broad volumetric cone
out vec3 vP; flat out vec3 vA0; flat out vec3 vAx; flat out vec4 vPar; flat out vec3 vCol; flat out float vH;
void main(){
  int bi = int(uBeamA.x + 0.5); vH = uBeamB.w;
  vec4 Bc = uBeacons[bi];
  float ang = uBeaconCol[bi].w + (uBeamA.y < 0.0 ? 3.14159265 : 0.0);
  vec3 ax = normalize(vec3(cos(ang), -uBeamB.y, sin(ang)));
  vec3 side = normalize(cross(ax, vec3(0.0, 1.0, 0.0))); vec3 upv = cross(side, ax);
  float t = aPos.x; float r = (uBeamB.x + t*uBeamA.z*uBeamA.w)*2.3 + 0.6 + distance(Bc.xyz, uCamPos.xyz)*0.012;      // loose hull around the beam
  vec3 P = Bc.xyz + ax*(t*uBeamA.z*1.02) + (side*aPos.y + upv*aPos.z)*r;
  vP = P; vA0 = Bc.xyz; vAx = ax; vPar = vec4(uBeamA.z, uBeamB.x, uBeamA.w, uBeamB.z*(uBeamB.w > 0.5 ? 1.0 : smoothstep(0.2, 1.0, Bc.w)));
  vCol = mix(uBeaconCol[bi].rgb, vec3(1.0, 0.96, 0.88), 0.72);                 // pale warm white, not tan
  gl_Position = uViewProj*vec4(P, 1.0);
}`;
  // Analytic soft beam, purely additive. For each eye ray: closest approach to the beam axis -> gaussian cross-section,
  // exponential falloff along the beam, and the fragment depth is set to the beam CORE on that ray, so terrain, props,
  // the skiff and the sea occlude it where they really stand in front of it.
  const FS_BEAM = `#include <noise>
#include <fog>
in vec3 vP; flat in vec3 vA0; flat in vec3 vAx; flat in vec4 vPar; flat in vec3 vCol; flat in float vH; out vec4 o;
void main(){
  vec3 O = uCamPos.xyz; vec3 D = normalize(vP - O); vec3 w = O - vA0;
  float b = dot(D, vAx), d = dot(D, w), e = dot(vAx, w);
  float den = max(1.0 - b*b, 2e-5), sinT = sqrt(den);        // near-exact even when the ray runs along the axis, so the depth is right
  float s0 = (b*e - d)/den, t0 = e + b*s0;
  float t = clamp(t0, 0.0, vPar.x);
  float r = max(vPar.y + t*vPar.z, max(s0, 0.0)*0.0065);        // never thinner than ~3 px: no ragged far end
  float dm = length(w + D*s0 - vAx*t0);
  float q = dm/r; q *= q;
  float hot = exp(-q*12.0);                                   // narrow white-hot core on the axis
  float core = 0.42*exp(-q*1.7) + 0.10*exp(-q*0.7);         // gold shaft with a gaussian skirt
  float gate = smoothstep(-1.7, 1.7, s0*sinT/r)*smoothstep(-3.0*r, 0.0, t0);   // only the column in front of the eye
  float Lf = vPar.x*mix(0.30, 0.24, uDawn);
  float fall = exp(-t/Lf)*(1.0 + 4.0*exp(-t/26.0))*smoothstep(0.0, 2.5, t)*(1.0 - smoothstep(0.22, 0.97, t/vPar.x));   // HDR near the lamp so it blooms
  vec3 shaft = vCol*vec3(1.0, 0.72, 0.38)*core + vec3(1.0, 0.95, 0.84)*(hot*4.0);   // gold only in the falloff; the axis is near white
  if (vH > 0.5) {                                             // the Heartlight: a broad soft cone of light in weather, no core line, no end
    float u = t/vPar.x;
    fall = exp(-t/(vPar.x*0.17))*(1.0 + 3.5*exp(-t/28.0))*smoothstep(0.0, 6.0, t)*(1.0 - smoothstep(0.08, 0.80, u))*(1.0 - smoothstep(0.08, 0.80, u));
    vec3 Pm = vA0 + vAx*t;
    float air = texture(uNoiseTex, Pm.xz*0.0035 + vec2(uTime*0.006, 0.0)).r*0.75 + texture(uNoiseTex, Pm.xz*0.009 - vec2(0.0, uTime*0.011)).g*0.25;
    fall *= (0.72 + 0.56*air)*(1.0 + 0.35*uRain + 0.25*uStorm);                       // brighter where it crosses rain and low cloud
    fall *= 1.0 - 0.75*smoothstep(0.70, 0.96, abs(dot(vAx, normalize(O - vA0))));          // swinging at the eye it thins out: never a pillar
    shaft = mix(vec3(1.0, 0.70, 0.36), vec3(1.0, 0.90, 0.70), exp(-t/90.0))*(0.50*exp(-q*1.5) + 0.14*exp(-q*0.6)) + vec3(1.0, 0.95, 0.84)*(0.7*exp(-q*4.0)*exp(-t/70.0));
  }
  float thick = min(1.0/sinT, 1.4);
  float I = gate*fall*thick*(1.0 + 0.7*uDawn)*(1.0 - 0.45*smoothstep(0.8, 1.0, uDawn))*(0.75 + 0.35*uRain)*(1.0 - 0.5*twFogAmount(vA0 + vAx*t))*smoothstep(3.0, 48.0, s0);   // air right at the eye scatters almost nothing
  vec4 cp = uViewProj*vec4(O + D*max(s0, 0.3), 1.0);
  gl_FragDepth = clamp(cp.z/max(cp.w, 1e-4)*0.5 + 0.5, 0.0, 1.0);
  o = vec4(shaft*(I*vPar.w), 1.0);
}`;

  const VS_FLARE = `#include <fog>
layout(location=0) in vec2 aPos;
uniform vec4 uFl;   // beacon index, base size, camera offset, 0
uniform vec4 uFlH;  // the Heartlight glare: lamp on, flash, hush ember, 1 = heart
out vec2 vUV; out vec3 vCol; flat out vec4 vG; out vec2 vS;
void main(){
  int bi = int(uFl.x + 0.5);
  vec4 Bc = uBeacons[bi];
  vec3 toC = uCamPos.xyz - Bc.xyz; float d = length(toC); vec3 dir = toC/max(d, 1e-3);
  vec3 C = Bc.xyz + dir*min(uFl.z, d*0.5);
  float size = uFl.y*(1.0 + d*0.007);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), dir)); vec3 up = cross(dir, right);
  vec3 P = C + (right*aPos.x + up*aPos.y)*size;
  float ang = uBeaconCol[bi].w; vec2 bd = vec2(cos(ang), sin(ang)); vec2 tc = normalize(toC.xz + vec2(1e-4));
  float sweep = pow(max(dot(tc, bd), 0.0), 60.0) + 0.6*pow(max(dot(tc, -bd), 0.0), 60.0);
  float ign = smoothstep(0.0, 0.22, Bc.w)*(1.0 - smoothstep(0.30, 0.95, Bc.w));
  float I = smoothstep(0.0, 0.2, Bc.w)*(0.9 + 5.0*sweep + 5.0*ign)*(1.0 - 0.6*twFogAmount(Bc.xyz))*(1.0 - 0.4*uDawn)*uFl.w;
  vUV = aPos; vCol = uBeaconCol[bi].rgb*I; vG = vec4(0.0); vS = vec2(0.0);
  if (uFlH.w > 0.5) {
    float k = (1.0 + 2.0*uFlH.y)/3.0;                         // halo radius: steady = a third of the quad, x3 at the flash
    float amp = uFlH.x*(1.0 + 2.4*uFlH.y)*(1.0 + 0.9*sweep)*(1.0 - 0.5*twFogAmount(Bc.xyz))*(1.0 - 0.35*uDawn);
    vG = vec4(k, amp, uFlH.z*(1.0 - uFlH.x), 1.0);
    vec4 c0 = uViewProj*vec4(Bc.xyz, 1.0), c1 = uViewProj*vec4(Bc.xyz + (right*aPos.x + up*aPos.y)*(uFl.y*(1.0 + d*0.006)), 1.0);
    vS = c1.xy/max(c1.w, 1e-3) - c0.xy/max(c0.w, 1e-3);          // screen offset from the lamp (NDC: 2 = full height)
    P = Bc.xyz + (right*aPos.x + up*aPos.y)*(uFl.y*(1.0 + d*0.006));
  }
  gl_Position = uViewProj*vec4(P, 1.0);
}`;
  const FS_FLARE = `in vec2 vUV; in vec3 vCol; flat in vec4 vG; in vec2 vS; out vec4 o;
void main(){
  float r2 = dot(vUV, vUV);
  if (vG.w > 0.5) {                                           // photographic glare: hot core, edgeless multi-stop halo, anamorphic streak, faint rays
    float k = vG.x, rs = r2/(k*k), r = sqrt(r2);
    float win = 1.0 - smoothstep(0.45, 1.0, r); win *= win;
    float core = exp(-rs*2600.0)*9.0 + exp(-rs*520.0)*1.6;
    float hs = length(vS*vec2(1.7, 1.0));
    float conf = (1.0 - smoothstep(0.16, 0.70, hs))*mix(0.12, 1.0, smoothstep(-0.20, 0.02, vS.y));   // gone by ~35 % of the screen height; never a veil over the island below the lamp
    float halo = (0.50/pow(1.0 + rs*650.0, 1.5) + exp(-rs*16.0)*0.004)*conf;      // heavy-tailed near the lamp, no radius at which the paint filter can find an edge
    float streak = exp(-vUV.y*vUV.y*5000.0/(k*k))*(exp(-vUV.x*vUV.x*7.0/(k*k))*0.20 + exp(-vUV.x*vUV.x*60.0/(k*k))*0.35);
    float a = atan(vUV.y, vUV.x);
    float rays = (pow(abs(cos(a*3.5 + 0.4)), 46.0) + 0.5*pow(abs(cos(a*3.5 + 1.3)), 80.0))*exp(-sqrt(rs)*7.0)*0.09;
    vec3 gold = vec3(1.0, 0.74, 0.40), white = vec3(1.0, 0.95, 0.84);
    vec3 c = white*core + gold*(halo + rays*mix(0.3, 1.0, conf)) + mix(gold, white, 0.5)*streak;
    c = c*vG.y + vec3(1.0, 0.40, 0.10)*(vG.z*exp(-r2*14000.0)*0.8);   // the ember in the hush
    o = vec4(c*win, 1.0); return;
  }
  float core = exp(-r2*380.0)*1.3 + exp(-r2*90.0)*0.25;
  float below = mix(0.12, 1.0, smoothstep(-0.22, 0.03, vUV.y));     // never veil the shaft beneath the lantern
  float halo = (exp(-r2*34.0)*0.15 + exp(-r2*7.0)*0.03)*below;
  float streak = exp(-vUV.y*vUV.y*2200.0)*exp(-vUV.x*vUV.x*12.0)*0.06;
  float g = (core*7.0 + halo + streak*below)*max(0.0, 1.0 - r2);
  o = vec4(vCol*g, 1.0);
}`;

  // ---------------------------------------------------------------------------
  // GL state
  // ---------------------------------------------------------------------------
  let heartIdx = 5, mBuoyGlow = null, progBG = null;
  let shadowTex = null, mFloatGlow = null, progFG = null, hideFloats = false;
  let ready = false, progT, progP, progB, progF, progBeam, progFlare;
  let mTerrain, mProps, mBuoy, mFloat, mBeam, mFlare, nRing = 0, nFloat = 0, floatInst = null, floatSig = '';
  let baseRingInst = null, baseRingCount = 0;
  const ringU = new Float32Array(32);
  const raceDecalSlots = ['buoy_start', 'buoy_mark', 'buoy_finish'];
  const raceDecalTextures = { buoy_start: null, buoy_mark: null, buoy_finish: null };
  let raceDecalRevision = 0;
  let beaconIsles = [];

  function makeRaceDecalTexture(source) {
    if (!source || !source.width || !source.height || !TW.gl) return null;
    const gl = TW.gl, canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 128;
    const ctx = canvas.getContext('2d'); if (!ctx) return null;
    const scale = Math.min(236 / source.width, 108 / source.height), w = source.width * scale, h = source.height * scale;
    ctx.drawImage(source, (256 - w) * 0.5, (128 - h) * 0.5, w, h);
    const texture = gl.createTexture(); if (!texture) return null;
    const active = gl.getParameter(gl.ACTIVE_TEXTURE), flip = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL), premultiply = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flip); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiply);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null); gl.activeTexture(active); return texture;
  }
  function refreshRaceDecals() {
    if (!TW.sponsors || typeof TW.sponsors.getPlacementImage !== 'function' || !TW.gl) return;
    const revision = ++raceDecalRevision;
    Promise.all(raceDecalSlots.map(async (id) => [id, await TW.sponsors.getPlacementImage(id)]))
      .then((entries) => {
        const gl = TW.gl; if (revision !== raceDecalRevision || !gl || gl.isContextLost()) return;
        entries.forEach(([id, source]) => {
          const next = source ? makeRaceDecalTexture(source) : null, old = raceDecalTextures[id];
          raceDecalTextures[id] = next; if (old && old !== next) gl.deleteTexture(old);
        });
      }).catch((e) => console.warn('[TW] sponsor buoy texture failed:', e));
  }

  function init() {
    const t0 = performance.now(), gl = TW.gl, glx = TW.glx;
    const gen = generate();
    beaconIsles = gen.BI; heartIdx = Math.max(0, world.beacons.findIndex((b) => b.isHeart));
    const mapData = buildMap();
    world.mapTex = glx.texture({ w: MAPN, h: MAPN, data: mapData, internal: 'RGBA16F', format: 'RGBA', type: 'FLOAT', filter: 'LINEAR', wrap: 'CLAMP_TO_EDGE' });
    gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, world.mapTex); gl.activeTexture(gl.TEXTURE0);
    const q = TW.quality ? TW.quality.level : 1;
    const ms = buildMeshes(gen, q <= 0 ? 2 : 1);
    mTerrain = glx.mesh({ attribs: [{ loc: 0, size: 3, data: ms.terrain.pos }, { loc: 1, size: 3, data: ms.terrain.nrm }, { loc: 3, size: 4, data: ms.terrain.col }, { loc: 2, size: 2, data: ms.terrain.bed }], indices: ms.terrain.idx });
    { const sm = buildShadowMap(q); shadowTex = glx.texture({ w: sm.n, h: sm.n, data: sm.data, internal: 'RG16F', format: 'RG', type: 'FLOAT', filter: 'LINEAR', wrap: 'CLAMP_TO_EDGE' }); }
    mProps = glx.mesh({ attribs: [{ loc: 0, size: 3, data: ms.props.pos }, { loc: 1, size: 3, data: ms.props.nrm }, { loc: 3, size: 4, data: ms.props.col }, { loc: 4, size: 4, data: ms.props.info }], indices: ms.props.idx });
    baseRingInst = ms.ringInst.slice();
    baseRingCount = baseRingInst.length / 4;
    nRing = baseRingCount;
    mBuoy = glx.mesh({ attribs: [{ loc: 0, size: 3, data: ms.buoy.pos }, { loc: 1, size: 3, data: ms.buoy.nrm }, { loc: 3, size: 4, data: ms.buoy.col }, { loc: 4, size: 4, data: ms.ringInst, divisor: 1 }, { loc: 5, size: 4, data: ms.buoy.info }], indices: ms.buoy.idx });
    nFloat = world.floats.length; floatInst = new Float32Array(nFloat * 4);
    mFloat = glx.mesh({ attribs: [{ loc: 0, size: 3, data: ms.float.pos }, { loc: 1, size: 3, data: ms.float.nrm }, { loc: 3, size: 4, data: ms.float.col }, { loc: 4, size: 4, data: floatInst, divisor: 1, usage: gl.DYNAMIC_DRAW }], indices: ms.float.idx });
    // beam cone: (t, cos, sin)
    { const NS = 18, NR = 10, p = [], ix = [];
      for (let j = 0; j <= NR; j++) for (let k = 0; k < NS; k++) { const a = (k / NS) * 6.2831853, t = Math.pow(j / NR, 1.6); p.push(t, Math.cos(a), Math.sin(a)); }
      for (let j = 0; j < NR; j++) for (let k = 0; k < NS; k++) { const a = j * NS + k, b = j * NS + ((k + 1) % NS); ix.push(a, b, b + NS, a, b + NS, a + NS); }
      mBeam = glx.mesh({ attribs: [{ loc: 0, size: 3, data: new Float32Array(p) }], indices: new Uint16Array(ix) }); }
    mFloatGlow = glx.mesh({ attribs: [{ loc: 0, size: 2, data: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]) }, { loc: 4, size: 4, data: new Float32Array(floatInst), divisor: 1, usage: gl.DYNAMIC_DRAW }], indices: new Uint16Array([0, 1, 2, 2, 1, 3]) });
    progFG = glx.program(VS_FGLOW, FS_FGLOW, 'world-floatglow');
    mBuoyGlow = glx.mesh({ attribs: [{ loc: 0, size: 2, data: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]) }, { loc: 4, size: 4, data: ms.ringInst, divisor: 1 }], indices: new Uint16Array([0, 1, 2, 2, 1, 3]) });
    // Regatta layer: temporary start, intermediate-gate and finish buoys.
    // points = [{x,z}, ...]; first pair is gold, last pair cyan, middle pairs green.
    // The shader reads aInst.w as the race/type sentinel; aInst.z remains the ring slot.
    world.setRaceBuoys = function (points) {
      if (!mBuoy || !mBuoyGlow || !baseRingInst) return false;
      const pts = Array.isArray(points) ? points : [];
      const extra = new Float32Array(pts.length * 4);
      for (let i = 0; i < pts.length; i++) {
        extra[i * 4] = pts[i].x;
        extra[i * 4 + 1] = pts[i].z;
        extra[i * 4 + 2] = 0;                  // race buoys share the neutral ring slot
        extra[i * 4 + 3] = i < 2 ? -1 : i >= pts.length - 2 ? -3 : -2; // start / mark / finish
      }
      const merged = new Float32Array(baseRingInst.length + extra.length);
      merged.set(baseRingInst);
      merged.set(extra, baseRingInst.length);
      mBuoy.update(3, merged);
      mBuoyGlow.update(1, merged);
      nRing = baseRingCount + pts.length;
      world.raceBuoys = pts.map((p) => ({ x: p.x, z: p.z }));
      return true;
    };
    world.clearRaceBuoys = function () { return world.setRaceBuoys([]); };
    progBG = glx.program(VS_BGLOW, FS_BGLOW, 'world-buoyglow');
    mFlare = glx.mesh({ attribs: [{ loc: 0, size: 2, data: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]) }], indices: new Uint16Array([0, 1, 2, 2, 1, 3]) });
    progT = glx.program(VS_TERRAIN, FS_TERRAIN, 'world-terrain');
    progP = glx.program(VS_PROPS, FS_PROPS, 'world-props');
    { const qu = new Float32Array(48); for (let i = 0; i < 12; i++) { qu[i * 4 + 1] = -1000; qu[i * 4 + 3] = 7; } qu.set(quayLamps.slice(0, 48)); progP.use(); gl.uniform4fv(progP.loc('uQuay'), qu); }
    progB = glx.program(VS_BUOY, FS_BUOY, 'world-buoy');
    if (TW.sponsors) {
      if (progB.ok) raceDecalSlots.forEach((id) => TW.sponsors.setConnected(id, true));
      TW.sponsors.onChange(refreshRaceDecals);
      refreshRaceDecals();
    }
    progF = glx.program(VS_FLOAT, FS_FLOAT, 'world-float');
    progBeam = glx.program(VS_BEAM, FS_BEAM, 'world-beam');
    progFlare = glx.program(VS_FLARE, FS_FLARE, 'world-flare');
    world.stats = { terrainVerts: ms.terrain.nv, terrainTris: ms.terrain.idx.length / 3, propVerts: ms.props.nv, rocks: world.rocks.length, floats: nFloat };
    ready = true;
    update(0);
    world.initMs = Math.round(performance.now() - t0);
  }

  function update() {
    if (!ready) return;
    const S = TW.state, n = world.beacons.length;
    const heartOpen = (S.litCount | 0) >= n - 1;
    hideFloats = S.phase === 'title' || S.phase === 'ending';
    for (let i = 0; i < 8; i++) {
      const b = world.beacons[i], sb = S.beacons && S.beacons[i];
      if (!b) { ringU[i * 4] = ringU[i * 4 + 1] = ringU[i * 4 + 2] = ringU[i * 4 + 3] = 0; continue; }
      const lit = sb ? TW.saturate(sb.lit || 0) : 0, prog = sb ? TW.saturate(sb.progress || 0) : 0;
      const open = !b.isHeart || heartOpen || lit > 0.01 || prog > 0.01;
      ringU[i * 4] = open ? 0.5 : 0.4; ringU[i * 4 + 1] = open ? 1 : 0; ringU[i * 4 + 2] = prog; ringU[i * 4 + 3] = lit;
    }
    // storm-glass floats: re-read the taken flags every frame, re-upload only on change
    const F = world.floats; let sig = '';
    for (let i = 0; i < nFloat; i++) sig += F[i] && !F[i].taken ? '1' : '0';
    if (sig !== floatSig) {
      floatSig = sig;
      for (let i = 0; i < nFloat; i++) { const f = F[i] || { x: 0, z: 0, taken: true }; floatInst[i * 4] = f.x; floatInst[i * 4 + 1] = f.z; floatInst[i * 4 + 2] = TW.hash2(i, 7, 3); floatInst[i * 4 + 3] = f.taken ? 0 : 1; }
      mFloat.update(3, floatInst); mFloatGlow.update(1, floatInst);
    }
  }

  // The Heartlight's own clock (CONTRACT addendum v12): nothing before T0, a flash at T0, steady after ~2 s.
  const heartK = [0, 0, -1, 0];
  function heartState() {
    const S = TW.state, H = S.heart, sb = S.beacons && S.beacons[heartIdx], lit = sb ? TW.saturate(sb.lit || 0) : 0;
    let t = H && H.t >= 0 ? H.t : -1; const hush = H ? TW.saturate(H.hush || 0) : 0;
    if (t < 0 && lit > 0.5 && hush < 0.01) t = 99;          // lit with no clock running (debug views): steady
    heartK[0] = t < 0 ? 0 : TW.saturate(t / 0.1);
    heartK[1] = t < 0 ? 0 : Math.min(1, t / 0.12) * Math.exp(-Math.max(0, t - 0.12) / 0.62);
    heartK[2] = t; heartK[3] = hush;
  }
  function draw() {
    if (!ready) return;
    const gl = TW.gl;
    heartState();
    progT.use().setTex('uShadowMap', 5, shadowTex).set1f('uHeartIdx', heartIdx).set1f('uDbg', world._dbg === 1 ? 1 : 0); gl.uniform4f(progT.loc('uHeartK'), heartK[0], heartK[1], heartK[2], heartK[3]); mTerrain.draw();
    progP.use().setTex('uShadowMap', 5, shadowTex).set1f('uHeartIdx', heartIdx).set1f('uDbg', world._dbg === 2 ? 1 : 0); gl.uniform4f(progP.loc('uHeartK'), heartK[0], heartK[1], heartK[2], heartK[3]); mProps.draw();
    gl.activeTexture(gl.TEXTURE0);
    progB.use()
      .setTex('uRaceDecalStart', 0, raceDecalTextures.buoy_start).setTex('uRaceDecalMark', 1, raceDecalTextures.buoy_mark).setTex('uRaceDecalFinish', 2, raceDecalTextures.buoy_finish)
      .set1f('uRaceDecalStartOn', raceDecalTextures.buoy_start ? 1 : 0).set1f('uRaceDecalMarkOn', raceDecalTextures.buoy_mark ? 1 : 0).set1f('uRaceDecalFinishOn', raceDecalTextures.buoy_finish ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0); gl.uniform4fv(progB.loc('uRing'), ringU); mBuoy.draw(nRing);
    if ((!hideFloats || TW.state.frame <= 2) && floatSig.indexOf('1') >= 0) { progF.use(); mFloat.draw(nFloat); }
    if (!world.deferGlows) drawGlows();
  }

  // Additive light: beam cones + lamp flares. Normally called from draw(); a host may set
  // TW.world.deferGlows = true and call this after the ocean for perfect compositing over water.
  function drawGlows() {
    if (!ready) return;
    const gl = TW.gl, S = TW.state;
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthMask(false); gl.disable(gl.CULL_FACE);
    if ((!hideFloats || TW.state.frame <= 2) && floatSig.indexOf('1') >= 0) { progFG.use(); mFloatGlow.draw(nFloat); }
    progBG.use(); gl.uniform4fv(progBG.loc('uRing'), ringU); mBuoyGlow.draw(nRing);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    progBeam.use();
    for (let i = 0; i < world.beacons.length; i++) {
      const h = world.beacons[i].isHeart;
      const hg = h ? TW.smoothstep(1.2, 3.0, heartK[2]) : 0;                 // the two great cones begin to turn after the flash
      if (h ? hg <= 0.001 : !(S.beacons[i] && S.beacons[i].lit > 0.01)) continue;
      // the hull is wound inward: BACK-culling keeps its far faces, which exist whether the eye is inside or outside
      for (let s = 1; s >= -1; s -= 2) {
        gl.uniform4f(progBeam.loc('uBeamA'), i, s, h ? 620 : 300, h ? 0.055 : 0.028);
        gl.uniform4f(progBeam.loc('uBeamB'), h ? 4.5 : 0.8, h ? 0.04 : 0.03, h ? 0.19 * hg * (s > 0 ? 1 : 0.8) : 0.13 * (s > 0 ? 1 : 0.6), h ? 1 : 0);
        mBeam.draw();
      }
    }
    gl.disable(gl.CULL_FACE);
    progFlare.use();
    for (let i = 0; i < world.beacons.length; i++) {
      const h = world.beacons[i].isHeart;
      if (h) {                                                             // lens glare: over everything, never cut by the peak
        if (heartK[0] <= 0 && heartK[3] <= 0.01) continue;
        gl.disable(gl.DEPTH_TEST);
        gl.uniform4f(progFlare.loc('uFl'), i, 95, 0, 1); gl.uniform4f(progFlare.loc('uFlH'), heartK[0], heartK[1], heartK[3], 1);
        mFlare.draw(); gl.enable(gl.DEPTH_TEST); continue;
      }
      if (!(S.beacons[i] && S.beacons[i].lit > 0.01)) continue;
      gl.uniform4f(progFlare.loc('uFl'), i, 6.5, 2.9, 1.0); gl.uniform4f(progFlare.loc('uFlH'), 0, 0, 0, 0);
      mFlare.draw();
    }
    gl.disable(gl.BLEND); gl.depthMask(true); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
  }
})();
